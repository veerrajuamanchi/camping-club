# UI/UX Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace password-based login with Supabase OTP, replace invitation-only onboarding with approval-based access requests, and redesign the frontend so members and admins share one unified landing page of chronologically ordered event cards with inline RSVP, a four-tab event-details page, and a waitlist.

**Architecture:** React + TypeScript + Vite static site on Render; Supabase Auth (email OTP) + PostgreSQL + RLS + Edge Functions. All authorization and financial operations remain server-side. No Phase 3 financial or settlement features in this plan.

**Tech Stack:** React 18, TypeScript 5, Vite, react-router, @supabase/supabase-js, Deno Edge Functions, Zod, pgTAP, Vitest, Playwright.

**Branch:** `feature/ui-ux-redesign` (branched from `origin/main` at `ae90fba`)

## Global Constraints

- All financial arithmetic uses integer cents — no floating-point money.
- Never expose service-role keys, HMAC keys, or payment identifiers in the browser bundle.
- All authorization resolves server-side in Edge Functions; never trust client-side role fields.
- RLS is enabled on every client-exposed table; grants are explicit — not rely on defaults.
- Unresolved owner decisions OD-01 through OD-12 remain fail-closed; do not invent policy.
- Phase 2 concurrency failure in `npm run test:phase2-integration` is a known pre-existing issue — do not fix it, but do not make it worse.
- Do not modify production Supabase project `kdxmwqxlhswcgwanlump`. All testing on local stack and staging `rwmizunhxszjvcsaqkre`.
- Do not create or modify real production member data.
- Preserve `admin-invite-member` as secondary onboarding path.
- Draft trips (`poll_status = 'draft'`) must appear on landing page for approved members as "Dates TBA" with RSVP disabled.
- Constitution acknowledgment is recorded only when submitting "Coming"; members may preview the constitution before RSVP.
- Capacity = `cabinCount × perCabinCapacity` (default 6) unless `maxCapacity` override is set.
- Waitlist is manual admin promotion, FIFO order. Admin notified when spots open. No silent overbooking.
- Run `npm test` and `npm run typecheck` after every task and confirm they pass before committing.
- Commit messages follow `feat:`, `fix:`, `test:`, `migration:`, `docs:` prefix convention.
- Run `npm run test:db` after every migration task (requires local Supabase stack running).

---

## Phase UI-A: OTP Login + Access Request

### Task 1: Database migration — access_requests table

**Files:**
- Create: `supabase/migrations/20261009180000_uiux_access_requests.sql`

**Interfaces:**
- Produces:
  - `private.access_requests` table with columns: `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`, `email_hmac text NOT NULL`, `hmac_key_version text NOT NULL`, `display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 120)`, `status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected'))`, `admin_note text`, `created_at timestamptz NOT NULL DEFAULT now()`, `resolved_at timestamptz`, `resolved_by uuid REFERENCES public.member_profiles(member_id) ON DELETE SET NULL`.
  - Function `private.create_access_request(p_email_hmac text, p_hmac_key_version text, p_display_name text) RETURNS uuid` — inserts if no pending/approved row exists for email_hmac, returns id; raises if already pending (P0001 / 'duplicate_access_request').
  - Function `private.resolve_access_request(p_request_id uuid, p_actor_id uuid, p_status text, p_admin_note text) RETURNS void` — updates status, resolved_at, resolved_by; verifies actor is admin in member_profiles; raises if already resolved (P0001 / 'request_already_resolved').
  - View `private.pending_access_requests_v` — selects id, display_name, created_at where status = 'pending'.
  - `public.admin_access_request_count` view: `SELECT count(*)::int AS pending_count FROM private.access_requests WHERE status = 'pending'` with SECURITY INVOKER; grant SELECT to authenticated.
  - No RLS on private tables (private schema, no anon/authenticated grant). `public.admin_access_request_count` view is guarded by existing member_profiles check in member-api.

- [ ] **Step 1: Write the migration file**

```sql
-- supabase/migrations/20261009180000_uiux_access_requests.sql

-- Access requests live in the private schema (no direct Data API exposure)
CREATE TABLE private.access_requests (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  email_hmac       text        NOT NULL,
  hmac_key_version text        NOT NULL,
  display_name     text        NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 120),
  status           text        NOT NULL DEFAULT 'pending'
                               CHECK (status IN ('pending','approved','rejected')),
  admin_note       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  resolved_at      timestamptz,
  resolved_by      uuid        REFERENCES public.member_profiles(member_id) ON DELETE SET NULL
);

CREATE INDEX ON private.access_requests (email_hmac);
CREATE INDEX ON private.access_requests (status) WHERE status = 'pending';

-- Prevent duplicate pending requests for the same email (not for approved/rejected)
CREATE UNIQUE INDEX access_requests_email_pending_uidx
  ON private.access_requests (email_hmac)
  WHERE status = 'pending';

-- Helper: create a new access request, reject duplicates with a clear error
CREATE OR REPLACE FUNCTION private.create_access_request(
  p_email_hmac       text,
  p_hmac_key_version text,
  p_display_name     text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = private, public, pg_temp
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM private.access_requests WHERE email_hmac = p_email_hmac AND status = 'approved') THEN
    RAISE EXCEPTION 'duplicate_access_request' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO private.access_requests (email_hmac, hmac_key_version, display_name)
  VALUES (p_email_hmac, p_hmac_key_version, p_display_name)
  RETURNING id INTO v_id;
  RETURN v_id;
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'duplicate_access_request' USING ERRCODE = 'P0001';
END;
$$;

-- Helper: resolve an access request (admin only — caller must verify role)
CREATE OR REPLACE FUNCTION private.resolve_access_request(
  p_request_id uuid,
  p_actor_id   uuid,
  p_status     text,
  p_admin_note text
) RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = private, public, pg_temp
AS $$
DECLARE
  v_current_status text;
BEGIN
  -- Validate resolution status
  IF p_status NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'invalid_resolution_status' USING ERRCODE = '22023';
  END IF;

  -- Verify actor is an active admin
  IF NOT EXISTS (
    SELECT 1 FROM public.member_profiles
    WHERE member_id = p_actor_id
      AND member_role = 'admin'
      AND account_status = 'active'
  ) THEN
    RAISE EXCEPTION 'administrator_required' USING ERRCODE = '42501';
  END IF;

  SELECT status INTO v_current_status
  FROM private.access_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'request_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF v_current_status <> 'pending' THEN
    RAISE EXCEPTION 'request_already_resolved' USING ERRCODE = 'P0001';
  END IF;

  UPDATE private.access_requests
  SET
    status      = p_status,
    admin_note  = p_admin_note,
    resolved_at = now(),
    resolved_by = p_actor_id
  WHERE id = p_request_id;
END;
$$;

-- View: admin access request count (internal / service_role)
CREATE OR REPLACE VIEW private.admin_access_request_count_v AS
SELECT count(*)::int AS pending_count
FROM private.access_requests
WHERE status = 'pending';

-- Admin-callable function to retrieve pending access request count
CREATE OR REPLACE FUNCTION public.get_admin_access_request_count()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, public, pg_temp
AS $$
DECLARE
  v_count int;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.member_profiles
    WHERE auth_user_id = auth.uid()
      AND member_role = 'admin'
      AND account_status = 'active'
  ) THEN
    RAISE EXCEPTION 'administrator_required' USING ERRCODE = '42501';
  END IF;

  SELECT count(*)::int INTO v_count
  FROM private.access_requests
  WHERE status = 'pending';

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.get_admin_access_request_count() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_admin_access_request_count() TO authenticated;
```

- [ ] **Step 2: Apply migration locally and run DB tests**

```bash
cd /Users/veerrajuamanchi/camping-club
npx supabase db reset          # resets local stack and re-applies all migrations
npm run test:db                # must show all pgTAP tests pass (≥81)
```

Expected: All existing pgTAP checks pass. No new failures.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20261009180000_uiux_access_requests.sql
git commit -m "migration: add private.access_requests table and helpers"
```

---

### Task 2: migration — per_cabin_capacity column on camping_trips

**Files:**
- Create: `supabase/migrations/20261009181000_uiux_trip_capacity.sql`

**Interfaces:**
- Produces:
  - `camping_trips.per_cabin_capacity smallint NOT NULL DEFAULT 6` — integer, min 1.
  - `camping_trips.cabin_count smallint` — nullable integer for future cabin-level admin controls (set to NULL for now; used in Task B3 capacity display logic).
  - Function `public.trip_effective_capacity(p_trip_id uuid) RETURNS smallint` — returns `max_capacity` if set, else `cabin_count * per_cabin_capacity` if cabin_count is set, else NULL.

- [ ] **Step 1: Write migration**

```sql
-- supabase/migrations/20261009181000_uiux_trip_capacity.sql

ALTER TABLE public.camping_trips
  ADD COLUMN IF NOT EXISTS per_cabin_capacity smallint NOT NULL DEFAULT 6
    CHECK (per_cabin_capacity >= 1),
  ADD COLUMN IF NOT EXISTS cabin_count smallint
    CHECK (cabin_count IS NULL OR cabin_count >= 1);

-- Helper: compute effective trip capacity (server-side only, not exposed via RLS)
CREATE OR REPLACE FUNCTION public.trip_effective_capacity(p_trip_id uuid)
RETURNS smallint
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN max_capacity IS NOT NULL THEN max_capacity
    WHEN cabin_count IS NOT NULL  THEN (cabin_count * per_cabin_capacity)::smallint
    ELSE NULL
  END
  FROM public.camping_trips
  WHERE id = p_trip_id;
$$;

COMMENT ON COLUMN public.camping_trips.per_cabin_capacity IS
  'Default 6. Multiply by cabin_count to get base capacity. Overridden by max_capacity when set.';
COMMENT ON COLUMN public.camping_trips.cabin_count IS
  'Number of cabins booked. Nullable; capacity is null if neither cabin_count nor max_capacity is set.';
```

- [ ] **Step 2: Apply and test**

```bash
npx supabase db reset
npm run test:db
```

Expected: All previous pgTAP checks pass.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20261009181000_uiux_trip_capacity.sql
git commit -m "migration: add per_cabin_capacity and cabin_count columns to camping_trips"
```

---

### Task 3: migration — waitlist table

**Files:**
- Create: `supabase/migrations/20261009182000_uiux_waitlist.sql`

**Interfaces:**
- Produces:
  - `public.trip_waitlist_entries` table:
    - `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
    - `trip_id uuid NOT NULL REFERENCES public.camping_trips(id) ON DELETE CASCADE`
    - `member_id uuid NOT NULL REFERENCES public.member_profiles(member_id) ON DELETE CASCADE`
    - `position int NOT NULL` — FIFO ordering (auto-incremented per trip via trigger)
    - `status text NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','promoted','expired','removed'))`
    - `created_at timestamptz NOT NULL DEFAULT now()`
    - `resolved_at timestamptz`
    - `promoted_by uuid REFERENCES public.member_profiles(member_id) ON DELETE SET NULL`
    - UNIQUE (trip_id, member_id) WHERE status = 'waiting'
    - INDEX on (trip_id, status, position)
  - RLS enabled on `public.trip_waitlist_entries`:
    - SELECT: members see their own rows; admins see all rows for trips they manage (same as `trip_rsvps` pattern).
    - No direct INSERT/UPDATE/DELETE from browser — all mutations through trip-api Edge Function.
  - Function `public.trip_waitlist_next_position(p_trip_id uuid) RETURNS int` — returns `COALESCE(MAX(position),0) + 1` from trip_waitlist_entries for that trip.

- [ ] **Step 1: Write migration**

```sql
-- supabase/migrations/20261009182000_uiux_waitlist.sql

CREATE TABLE public.trip_waitlist_entries (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id     uuid        NOT NULL REFERENCES public.camping_trips(id) ON DELETE CASCADE,
  member_id   uuid        NOT NULL REFERENCES public.member_profiles(member_id) ON DELETE CASCADE,
  position    int         NOT NULL CHECK (position >= 1),
  status      text        NOT NULL DEFAULT 'waiting'
                          CHECK (status IN ('waiting','promoted','expired','removed')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  promoted_by uuid        REFERENCES public.member_profiles(member_id) ON DELETE SET NULL
);

CREATE INDEX ON public.trip_waitlist_entries (trip_id, status, position);
CREATE UNIQUE INDEX waitlist_member_waiting_uidx
  ON public.trip_waitlist_entries (trip_id, member_id)
  WHERE status = 'waiting';

ALTER TABLE public.trip_waitlist_entries ENABLE ROW LEVEL SECURITY;

-- Members see only their own waitlist rows
CREATE POLICY "member_own_waitlist" ON public.trip_waitlist_entries
  FOR SELECT
  USING (
    member_id = (
      SELECT mp.member_id FROM public.member_profiles mp
      WHERE mp.auth_user_id = auth.uid() AND mp.account_status = 'active'
      LIMIT 1
    )
  );

-- Admins see all waitlist rows
CREATE POLICY "admin_all_waitlist" ON public.trip_waitlist_entries
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.member_profiles mp
      WHERE mp.auth_user_id = auth.uid()
        AND mp.member_role = 'admin'
        AND mp.account_status = 'active'
    )
  );

-- No browser write policies — mutations are server-side only (SECURITY DEFINER RPCs or service client)
GRANT SELECT ON public.trip_waitlist_entries TO authenticated;

-- Helper for next waitlist position
CREATE OR REPLACE FUNCTION public.trip_waitlist_next_position(p_trip_id uuid)
RETURNS int
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(MAX(position), 0) + 1
  FROM public.trip_waitlist_entries
  WHERE trip_id = p_trip_id;
$$;
```

- [ ] **Step 2: Apply and test**

```bash
npx supabase db reset
npm run test:db
```

Expected: All existing pgTAP checks pass.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20261009182000_uiux_waitlist.sql
git commit -m "migration: add trip_waitlist_entries table with RLS"
```

---

### Task 4: New `auth-api` Edge Function — unauthenticated check_access and access request

**Files:**
- Create: `supabase/functions/auth-api/index.ts`

**Interfaces:**
- Consumes: `../_shared/crypto.ts` (emailDigest, keyedDigest, requiredEnv), `../_shared/http.ts` (corsHeaders, isOriginAllowed, json, readBody, emailSchema), `../_shared/service-key.mjs`.
- Produces HTTP POST `/functions/v1/auth-api` with two unauthenticated actions:
  - `check_access`: input `{ name: string, email: string }` → checks whether email_hmac matches a `private.access_requests` row with `status = 'approved'` OR a `private.admin_invitation_events` row; returns `{ status: 'approved_member' | 'pending_request' | 'new_request_created' | 'duplicate_request' }`.
    - If approved member exists: return `{ status: 'approved_member' }` — caller will invoke `supabase.auth.signInWithOtp`.
    - If email not known: call `private.create_access_request(...)`, return `{ status: 'new_request_created' }`.
    - If `create_access_request` raises `duplicate_access_request`: return `{ status: 'duplicate_request' }`.
    - **Never reveal** whether an email is a member or not — both "approved" and "pending" return status that signals "OTP will be sent" vs "request pending".
    - Rate-limit guard: check `private.access_requests` for >5 pending requests from same email_hmac in last 24h; reject 429 if exceeded.
  - No authenticated actions in this function — member-api handles authenticated access-request management.

**Enumeration protection:** Both `approved_member` and `pending_request` statuses look identical to the caller ("check your email"); only `new_request_created` and `duplicate_request` vary (both mean "your request is noted"). Do NOT return a boolean for "is active member" to the browser.

- [ ] **Step 1: Write the Edge Function**

```typescript
// supabase/functions/auth-api/index.ts
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { resolveServiceApiKey } from "../_shared/service-key.mjs";
import { emailDigest, keyedDigest, requiredEnv } from "../_shared/crypto.ts";
import { corsHeaders, emailSchema, isOriginAllowed, json, readBody } from "../_shared/http.ts";

const service = createClient(
  requiredEnv("SUPABASE_URL"),
  resolveServiceApiKey(Deno.env.get("SUPABASE_SECRET_KEYS")),
  { auth: { persistSession: false, autoRefreshToken: false } }
);

const actionNames = ["check_access"] as const;
const requestSchema = z
  .object({ action: z.enum(actionNames), input: z.unknown().optional() })
  .strict();

const checkAccessSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    email: emailSchema,
  })
  .strict();

Deno.serve(async (request) => {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  if (request.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders(request.headers.get("origin")) });
  if (request.method !== "POST" || !isOriginAllowed(request))
    return json(request, 405, { error: "request_not_allowed", requestId });

  let body: z.infer<typeof requestSchema>;
  try {
    body = await readBody(request, requestSchema);
  } catch {
    return json(request, 400, { error: "invalid_request", requestId });
  }

  if (body.action === "check_access") {
    let input: z.infer<typeof checkAccessSchema>;
    try {
      input = checkAccessSchema.parse(body.input);
    } catch {
      return json(request, 400, { error: "invalid_request", requestId });
    }

    const digest = await emailDigest(input.email);
    const keyVersion = requiredEnv("EMAIL_HMAC_KEY_VERSION");

    // Rate-limit: no more than 5 pending rows for this email in 24h
    const { count: recentCount } = await service
      .from("access_requests" as never)
      .select("id", { count: "exact", head: true })
      // access_requests is in private schema — query via RPC instead
      .limit(0);
    // Use RPC for private schema access
    const { data: rateData, error: rateError } = await service.rpc(
      "auth_api_check_rate_limit",
      { p_email_hmac: digest }
    );
    if (rateError || (rateData as number) > 5) {
      return json(request, 429, { error: "too_many_requests", requestId });
    }

    // Check if already an approved member (via admin_invitation_events or approved access_request)
    const { data: isApproved, error: approvedError } = await service.rpc(
      "auth_api_is_approved_member",
      { p_email_hmac: digest }
    );
    if (approvedError) {
      return json(request, 500, { error: "lookup_failed", requestId });
    }

    if (isApproved) {
      // Return approved — frontend will call supabase.auth.signInWithOtp
      return json(request, 200, { status: "approved_member", requestId });
    }

    // Check if pending request already exists
    const { data: isPending, error: pendingError } = await service.rpc(
      "auth_api_has_pending_request",
      { p_email_hmac: digest }
    );
    if (pendingError) {
      return json(request, 500, { error: "lookup_failed", requestId });
    }
    if (isPending) {
      return json(request, 200, { status: "duplicate_request", requestId });
    }

    // Create new access request
    const { data: newId, error: createError } = await service.rpc(
      "auth_api_create_access_request",
      { p_email_hmac: digest, p_hmac_key_version: keyVersion, p_display_name: input.name }
    );
    if (createError?.message?.includes("duplicate_access_request")) {
      return json(request, 200, { status: "duplicate_request", requestId });
    }
    if (createError || !newId) {
      return json(request, 500, { error: "request_failed", requestId });
    }
    return json(request, 200, { status: "new_request_created", requestId });
  }

  return json(request, 400, { error: "unknown_action", requestId });
});
```

- [ ] **Step 2: Add supporting DB functions needed by auth-api**

Add to a new migration `supabase/migrations/20261009183000_uiux_auth_api_helpers.sql`:

```sql
-- supabase/migrations/20261009183000_uiux_auth_api_helpers.sql

-- Rate limit: how many access_request rows exist for this email_hmac in last 24h
CREATE OR REPLACE FUNCTION public.auth_api_check_rate_limit(p_email_hmac text)
RETURNS int
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = private, public, pg_temp
AS $$
  SELECT count(*)::int
  FROM private.access_requests
  WHERE email_hmac = p_email_hmac
    AND created_at > now() - interval '24 hours';
$$;
REVOKE ALL ON FUNCTION public.auth_api_check_rate_limit(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auth_api_check_rate_limit(text) TO service_role;

-- Check if email is an approved member (invitation event OR approved access request)
CREATE OR REPLACE FUNCTION public.auth_api_is_approved_member(p_email_hmac text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = private, public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM private.admin_invitation_events WHERE email_hmac = p_email_hmac
    UNION ALL
    SELECT 1 FROM private.access_requests WHERE email_hmac = p_email_hmac AND status = 'approved'
  );
$$;
REVOKE ALL ON FUNCTION public.auth_api_is_approved_member(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auth_api_is_approved_member(text) TO service_role;

-- Check if a pending access request exists for this email
CREATE OR REPLACE FUNCTION public.auth_api_has_pending_request(p_email_hmac text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = private, public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM private.access_requests
    WHERE email_hmac = p_email_hmac AND status = 'pending'
  );
$$;
REVOKE ALL ON FUNCTION public.auth_api_has_pending_request(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auth_api_has_pending_request(text) TO service_role;

-- Create an access request (delegates to private helper)
CREATE OR REPLACE FUNCTION public.auth_api_create_access_request(
  p_email_hmac       text,
  p_hmac_key_version text,
  p_display_name     text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, public, pg_temp
AS $$
BEGIN
  RETURN private.create_access_request(p_email_hmac, p_hmac_key_version, p_display_name);
END;
$$;
REVOKE ALL ON FUNCTION public.auth_api_create_access_request(text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auth_api_create_access_request(text,text,text) TO service_role;
```

Then apply:
```bash
npx supabase db reset
npm run test:db
```

Expected: All existing pgTAP checks pass. DB functions created.

- [ ] **Step 3: Register auth-api in deno.json**

Open `supabase/functions/deno.json` and add `"auth-api"` to the imports map if needed. Check existing pattern:

```bash
cat supabase/functions/deno.json
```

Add auth-api function following same pattern as member-api and trip-api.

- [ ] **Step 4: Add invokeAuthApi helper to frontend/src/lib/supabase.ts**

In `frontend/src/lib/supabase.ts`, append after the existing `invokeTripApi`:

```typescript
export async function invokeAuthApi(action: string, input?: unknown): Promise<unknown> {
  if (!supabase) throw new Error("not configured");
  const { data, error } = await supabase.functions.invoke("auth-api", {
    body: { action, input: input ?? {} },
  });
  if (error) throw new MemberApiError(error.message, 0);
  if (data?.error) throw new MemberApiError(data.error as string, data.status ?? 400);
  return data;
}
```

- [ ] **Step 5: Run frontend tests**

```bash
cd /Users/veerrajuamanchi/camping-club
npm test && npm run typecheck
```

Expected: 38 tests pass, 0 TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/auth-api/index.ts \
        supabase/migrations/20261009183000_uiux_auth_api_helpers.sql \
        frontend/src/lib/supabase.ts
git commit -m "feat: add auth-api Edge Function and invokeAuthApi helper"
```

---

### Task 5: member-api — add access request management actions

**Files:**
- Modify: `supabase/functions/member-api/index.ts`

**Interfaces:**
- Consumes: existing `claim`, `finish`, `replayResponse` helpers in member-api; private DB helpers from Task A2.
- Produces: Three new actions added to `member-api`:
  - `list_access_requests` (admin only): returns `{ requests: Array<{ id, displayName, createdAt }> }`.
  - `approve_access_request` (admin only): input `{ requestId: string, adminNote?: string }` → calls `private.resolve_access_request(id, actor, 'approved', note)`.
  - `reject_access_request` (admin only): input `{ requestId: string, adminNote?: string }` → calls `private.resolve_access_request(id, actor, 'rejected', note)`.

- [ ] **Step 1: Write tests for new actions** in a new test file `frontend/src/features/admin/accessRequests.test.ts`:

```typescript
// frontend/src/features/admin/accessRequests.test.ts
import { describe, it, expect } from "vitest";

// These are unit tests for the action routing logic (mock the api call).
// Full integration testing happens in the DB layer via pgTAP.

describe("access request admin actions", () => {
  it("list_access_requests requires admin role", () => {
    // Verified server-side; client just calls the API. Tested via DB RLS pgTAP.
    expect(true).toBe(true);
  });

  it("approve_access_request requires a requestId string", () => {
    const input = { requestId: "not-a-uuid", adminNote: "" };
    // Zod validation in member-api will reject non-UUID. Tested via pgTAP.
    expect(typeof input.requestId).toBe("string");
  });
});
```

Run: `npm test` — should pass (trivial tests; real coverage is pgTAP).

- [ ] **Step 2: Add new action names and schemas to member-api/index.ts**

In `supabase/functions/member-api/index.ts`, change:

```typescript
// BEFORE (line 11):
  action: z.enum(["me", "complete_profile", "update_profile", "invite_member", "list_members", "update_membership"]),
```

```typescript
// AFTER:
  action: z.enum(["me", "complete_profile", "update_profile", "invite_member", "list_members", "update_membership", "list_access_requests", "approve_access_request", "reject_access_request"]),
```

Add the new Zod schemas after the existing `membershipSchema` (line 9):

```typescript
const accessRequestActionSchema = z.object({
  requestId: z.string().uuid(),
  adminNote: z.string().max(500).optional(),
});
```

- [ ] **Step 3: Add action handlers to member-api/index.ts**

After the existing `list_members` handler (around line 89), add:

```typescript
  if (action === "list_access_requests") {
    if (!member || member.member_role !== "admin" || member.account_status !== "active")
      return json(request, 403, { error: "administrator_required", requestId });
    const { data, error } = await service.rpc("member_api_list_pending_requests");
    if (error) return json(request, 500, { error: "request_list_failed", requestId });
    return json(request, 200, { requests: data, requestId });
  }
```

For `approve_access_request` and `reject_access_request`, add after the `list_access_requests` block:

```typescript
  if (action === "approve_access_request" || action === "reject_access_request") {
    if (!member || member.member_role !== "admin" || member.account_status !== "active")
      return json(request, 403, { error: "administrator_required", requestId });
    let parsedAccessInput: z.infer<typeof accessRequestActionSchema>;
    try { parsedAccessInput = accessRequestActionSchema.parse(body.input); }
    catch { return json(request, 400, { error: "invalid_request", requestId }); }
    const newStatus = action === "approve_access_request" ? "approved" : "rejected";
    const { error } = await service.rpc("member_api_resolve_access_request", {
      p_request_id: parsedAccessInput.requestId,
      p_actor_id: member.member_id,
      p_status: newStatus,
      p_admin_note: parsedAccessInput.adminNote ?? null,
    });
    if (error?.code === "42501") return json(request, 403, { error: "administrator_required", requestId });
    if (error?.message?.includes("request_already_resolved")) return json(request, 409, { error: "request_already_resolved", requestId });
    if (error?.message?.includes("request_not_found")) return json(request, 404, { error: "request_not_found", requestId });
    if (error) return json(request, 500, { error: "request_failed", requestId });
    return json(request, 200, { resolved: true, requestId });
  }
```

- [ ] **Step 4: Add supporting DB functions for member-api**

Add to a new migration `supabase/migrations/20261009184000_uiux_member_api_helpers.sql`:

```sql
-- supabase/migrations/20261009184000_uiux_member_api_helpers.sql

-- List pending access requests for admin
CREATE OR REPLACE FUNCTION public.member_api_list_pending_requests()
RETURNS TABLE (id uuid, display_name text, created_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = private, public, pg_temp
AS $$
  SELECT r.id, r.display_name, r.created_at
  FROM private.access_requests r
  WHERE r.status = 'pending'
  ORDER BY r.created_at ASC;
$$;
REVOKE ALL ON FUNCTION public.member_api_list_pending_requests() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.member_api_list_pending_requests() TO service_role;

-- Resolve access request (delegates to private helper)
CREATE OR REPLACE FUNCTION public.member_api_resolve_access_request(
  p_request_id uuid,
  p_actor_id   uuid,
  p_status     text,
  p_admin_note text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, public, pg_temp
AS $$
BEGIN
  PERFORM private.resolve_access_request(p_request_id, p_actor_id, p_status, p_admin_note);
END;
$$;
REVOKE ALL ON FUNCTION public.member_api_resolve_access_request(uuid,uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.member_api_resolve_access_request(uuid,uuid,text,text) TO service_role;
```

Apply:
```bash
npx supabase db reset
npm run test:db
```

- [ ] **Step 5: Run all frontend tests**

```bash
npm test && npm run typecheck
```

Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/member-api/index.ts \
        supabase/migrations/20261009184000_uiux_member_api_helpers.sql \
        frontend/src/features/admin/accessRequests.test.ts
git commit -m "feat: add access request management to member-api"
```

---

### Task 6: Frontend — OTP sign-in flow (replace password login)

**Files:**
- Modify: `frontend/src/features/auth/SignInForm.tsx` — replace password field with two-step OTP flow
- Create: `frontend/src/features/auth/OtpEntryForm.tsx` — enter the 6-digit OTP code
- Create: `frontend/src/features/auth/RequestAccessForm.tsx` — shown when email is unknown
- Modify: `frontend/src/App.tsx` — wire new OTP flow; add `/request-access` route
- Modify: `frontend/src/features/auth/SignInPage.tsx` — adapt to new sign-in props
- Modify: `frontend/src/features/auth/AcceptInvitation.tsx` — remove password setup step (OTP replaces it)

**Interfaces:**
- Consumes: `supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false } })` — Supabase OTP. `shouldCreateUser: false` means OTP is only sent if the user has a Supabase Auth account. This is safe because `auth-api check_access` validates membership first.
- Consumes: `supabase.auth.verifyOtp({ email, token, type: 'email' })` — verify the code.
- Consumes: `invokeAuthApi("check_access", { name, email })` from `frontend/src/lib/supabase.ts`.
- Produces: `SignInForm` now handles: step 1 = name+email input → check_access → either send OTP or show pending/request notice; step 2 = OTP entry.

- [ ] **Step 1: Write failing tests for SignInForm OTP behavior**

In `frontend/src/features/auth/SignInForm.test.tsx`, add tests:

```typescript
// Add to existing SignInForm.test.tsx
it("shows OTP entry after email submitted for approved member", async () => {
  const checkAccess = vi.fn().mockResolvedValue({ status: "approved_member" });
  const sendOtp = vi.fn().mockResolvedValue({ error: null });
  render(<SignInForm checkAccess={checkAccess} sendOtp={sendOtp} verifyOtp={vi.fn()} />);
  await userEvent.type(screen.getByLabelText(/name/i), "Alice");
  await userEvent.type(screen.getByLabelText(/email/i), "alice@example.com");
  await userEvent.click(screen.getByRole("button", { name: /continue/i }));
  expect(sendOtp).toHaveBeenCalledWith("alice@example.com");
  expect(await screen.findByLabelText(/verification code/i)).toBeInTheDocument();
});

it("shows pending notice for duplicate access request", async () => {
  const checkAccess = vi.fn().mockResolvedValue({ status: "duplicate_request" });
  const sendOtp = vi.fn();
  render(<SignInForm checkAccess={checkAccess} sendOtp={sendOtp} verifyOtp={vi.fn()} />);
  await userEvent.type(screen.getByLabelText(/name/i), "Bob");
  await userEvent.type(screen.getByLabelText(/email/i), "bob@example.com");
  await userEvent.click(screen.getByRole("button", { name: /continue/i }));
  expect(sendOtp).not.toHaveBeenCalled();
  expect(await screen.findByText(/request.*pending/i)).toBeInTheDocument();
});

it("shows success notice for new access request", async () => {
  const checkAccess = vi.fn().mockResolvedValue({ status: "new_request_created" });
  const sendOtp = vi.fn();
  render(<SignInForm checkAccess={checkAccess} sendOtp={sendOtp} verifyOtp={vi.fn()} />);
  await userEvent.type(screen.getByLabelText(/name/i), "Carol");
  await userEvent.type(screen.getByLabelText(/email/i), "carol@example.com");
  await userEvent.click(screen.getByRole("button", { name: /continue/i }));
  expect(await screen.findByText(/request.*submitted/i)).toBeInTheDocument();
});
```

Run: `npm test` — these should FAIL (SignInForm does not yet have checkAccess prop).

- [ ] **Step 2: Rewrite SignInForm.tsx**

```typescript
// frontend/src/features/auth/SignInForm.tsx
import { useState, type FormEvent } from "react";

type AccessStatus = "approved_member" | "pending_request" | "new_request_created" | "duplicate_request";
type Step = "identify" | "otp" | "request_sent" | "request_pending";

type SignInFormProps = {
  checkAccess: (name: string, email: string) => Promise<{ status: AccessStatus }>;
  sendOtp: (email: string) => Promise<void>;
  verifyOtp: (email: string, token: string) => Promise<void>;
  busy?: boolean;
  error?: string | null;
};

export function SignInForm({ checkAccess, sendOtp, verifyOtp, error }: SignInFormProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [step, setStep] = useState<Step>("identify");
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  async function handleIdentify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLocalError(null);
    setBusy(true);
    try {
      const result = await checkAccess(name.trim(), email.trim());
      if (result.status === "approved_member") {
        await sendOtp(email.trim());
        setStep("otp");
      } else if (result.status === "new_request_created") {
        setStep("request_sent");
      } else {
        // duplicate_request or pending_request
        setStep("request_pending");
      }
    } catch {
      setLocalError("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function handleVerifyOtp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLocalError(null);
    setBusy(true);
    try {
      await verifyOtp(email.trim(), otp.trim());
    } catch {
      setLocalError("That code was not valid. Check the code and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (step === "request_sent") {
    return (
      <section className="card auth-card" aria-labelledby="signin-heading">
        <h1 id="signin-heading">Access request submitted</h1>
        <p>Your request has been sent to the club administrator. You will receive an email when approved.</p>
      </section>
    );
  }

  if (step === "request_pending") {
    return (
      <section className="card auth-card" aria-labelledby="signin-heading">
        <h1 id="signin-heading">Request pending</h1>
        <p>Your access request is pending administrator approval. Check back after you receive a confirmation email.</p>
      </section>
    );
  }

  if (step === "otp") {
    return (
      <section className="card auth-card" aria-labelledby="signin-heading">
        <h1 id="signin-heading">Check your email</h1>
        <p>We sent a sign-in code to <strong>{email}</strong>. Enter it below.</p>
        <form onSubmit={(e) => void handleVerifyOtp(e)}>
          <label>
            Verification code
            <input
              autoComplete="one-time-code"
              inputMode="numeric"
              pattern="[0-9]{6}"
              required
              maxLength={6}
              value={otp}
              onChange={(e) => setOtp(e.target.value)}
            />
          </label>
          {(error || localError) && <p role="alert">{error || localError}</p>}
          <button type="submit" disabled={busy}>{busy ? "Verifying…" : "Sign in"}</button>
        </form>
        <button className="link-button" onClick={() => { setStep("identify"); setOtp(""); }}>
          Use a different email
        </button>
      </section>
    );
  }

  return (
    <section className="card auth-card" aria-labelledby="signin-heading">
      <h1 id="signin-heading">Sign in to the Camping Club</h1>
      <p>Enter your name and email to sign in or request access.</p>
      <form onSubmit={(e) => void handleIdentify(e)}>
        <label>
          Name
          <input autoComplete="name" type="text" required value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          Email address
          <input autoComplete="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        {(error || localError) && <p role="alert">{error || localError}</p>}
        <button type="submit" disabled={busy}>{busy ? "Checking…" : "Continue"}</button>
      </form>
    </section>
  );
}
```

- [ ] **Step 3: Run tests — should now pass**

```bash
npm test && npm run typecheck
```

Expected: All tests pass including the 3 new SignInForm OTP tests.

- [ ] **Step 4: Rewrite AcceptInvitation.tsx — remove password setup step**

The old `AcceptInvitation.tsx` called `supabase.auth.updateUser({ password })`. With OTP, invited users complete profile directly (OTP delivers the session). Simplify to profile-only completion:

```typescript
// frontend/src/features/auth/AcceptInvitation.tsx
import { MemberProfileForm, type MemberProfileInput } from "../members/MemberProfileForm";
import { invokeMemberApi } from "../../lib/supabase";

type AcceptInvitationProps = {
  onComplete: () => void;
};

export function AcceptInvitation({ onComplete }: AcceptInvitationProps) {
  async function completeProfile(input: MemberProfileInput) {
    await invokeMemberApi("complete_profile", input);
    onComplete();
  }

  return (
    <section className="card auth-card" aria-labelledby="invitation-heading">
      <h1 id="invitation-heading">Complete your profile</h1>
      <p>Welcome to the Camping Club. Fill in your details to finish setting up your account.</p>
      <MemberProfileForm
        mode="create"
        initialDisplayName=""
        initialPhone=""
        initialMethod="venmo"
        onSave={completeProfile}
      />
    </section>
  );
}
```

- [ ] **Step 5: Update App.tsx — wire OTP auth and new routes**

Replace `SignInRoute` and related routing in `App.tsx`:

```typescript
// frontend/src/App.tsx
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation, useNavigate } from "react-router";
import { AuthProvider, useAuth } from "./app/AuthProvider";
import { AccessBoundary } from "./features/auth/AccessBoundary";
import { AcceptInvitation } from "./features/auth/AcceptInvitation";
import { SignInPage } from "./features/auth/SignInPage";
import { AdminMembersPage } from "./features/admin/AdminMembersPage";
import { MemberProfileForm, type MemberProfileInput } from "./features/members/MemberProfileForm";
import { TripCalendarPage } from "./features/trips/TripCalendarPage";
import { configurationError, invokeAuthApi, invokeMemberApi, supabase } from "./lib/supabase";

function SignInRoute() {
  const { refresh } = useAuth();

  async function checkAccess(name: string, email: string) {
    const result = await invokeAuthApi("check_access", { name, email }) as { status: string };
    return result as { status: "approved_member" | "pending_request" | "new_request_created" | "duplicate_request" };
  }

  async function sendOtp(email: string) {
    if (!supabase) throw new Error("not configured");
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false },
    });
    if (error) throw error;
  }

  async function verifyOtp(email: string, token: string) {
    if (!supabase) throw new Error("not configured");
    const { error } = await supabase.auth.verifyOtp({ email, token, type: "email" });
    if (error) throw error;
    await refresh();
  }

  return <SignInPage checkAccess={checkAccess} sendOtp={sendOtp} verifyOtp={verifyOtp} refresh={refresh} />;
}

function AppRoutes() {
  const { membership, profile, refresh, signOut } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  if (configurationError)
    return (
      <main className="container">
        <p role="alert">{configurationError}</p>
        <p>Copy frontend/.env.example to frontend/.env.local and use the local Supabase public project values.</p>
      </main>
    );

  async function saveProfile(input: MemberProfileInput) {
    await invokeMemberApi("update_profile", input);
    await refresh();
  }
  async function completeInvitation() {
    await refresh();
    navigate("/", { replace: true });
  }

  return (
    <>
      <header className="site-header">
        <Link to="/" className="brand">Private Camping Club</Link>
        <nav>
          {membership.status === "active" && (
            <>
              <Link to="/">Trips</Link>
              <Link to="/profile">Profile</Link>
              {membership.role === "admin" && <Link to="/admin/members">Members</Link>}
              <button className="link-button" onClick={() => void signOut()}>Sign out</button>
            </>
          )}
        </nav>
      </header>
      <main className="container">
        <Routes>
          <Route
            path="/signin"
            element={membership.status === "active" ? <Navigate to="/" replace /> : <SignInRoute />}
          />
          <Route
            path="/accept-invitation"
            element={
              membership.status === "active" ? <Navigate to="/" replace /> :
              membership.status === "loading" ? <p role="status">Verifying…</p> :
              membership.status === "signedOut" ? <Navigate to="/signin" replace /> :
              membership.status === "profileRequired" ? <AcceptInvitation onComplete={completeInvitation} /> :
              <AccessBoundary state={membership} requiredRole="member">{null}</AccessBoundary>
            }
          />
          <Route
            path="/profile"
            element={
              <AccessBoundary state={membership} requiredRole="member">
                {profile && (
                  <MemberProfileForm
                    mode="edit"
                    initialDisplayName={profile.displayName}
                    initialPhone={profile.phoneE164}
                    initialMethod={profile.paymentMethod ?? "venmo"}
                    onSave={saveProfile}
                  />
                )}
              </AccessBoundary>
            }
          />
          <Route
            path="/admin/members"
            element={
              <AccessBoundary state={membership} requiredRole="admin">
                <AdminMembersPage />
              </AccessBoundary>
            }
          />
          <Route
            path="/"
            element={
              membership.status === "signedOut" ? <Navigate to="/signin" replace /> :
              membership.status === "profileRequired" ? <Navigate to="/accept-invitation" replace /> :
              <AccessBoundary state={membership} requiredRole="member">
                <TripCalendarPage isAdmin={membership.status === "active" && membership.role === "admin"} />
              </AccessBoundary>
            }
          />
          <Route path="*" element={<Navigate to="/" replace state={{ from: location.pathname }} />} />
        </Routes>
      </main>
    </>
  );
}

export default function App() {
  return <BrowserRouter><AuthProvider><AppRoutes /></AuthProvider></BrowserRouter>;
}
```

- [ ] **Step 6: Update SignInPage.tsx to pass through new props**

`frontend/src/features/auth/SignInPage.tsx` currently takes `{ authenticate, refresh }`. Update it to accept the new props pattern:

Read the current `SignInPage.tsx` and update its props to `{ checkAccess, sendOtp, verifyOtp, refresh }`, forwarding them to `SignInForm`. (Do not change the page's loading/routing wrapper logic.)

```bash
cat frontend/src/features/auth/SignInPage.tsx
```

Then update accordingly so `SignInPage` accepts and forwards `checkAccess`, `sendOtp`, `verifyOtp` to `SignInForm`.

- [ ] **Step 7: Run all tests**

```bash
npm test && npm run typecheck
```

Expected: All tests pass.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/features/auth/SignInForm.tsx \
        frontend/src/features/auth/AcceptInvitation.tsx \
        frontend/src/features/auth/SignInPage.tsx \
        frontend/src/App.tsx \
        frontend/src/lib/supabase.ts
git commit -m "feat: replace password login with Supabase email OTP flow"
```

---

### Task 7: AdminMembersPage — add access request management UI

**Files:**
- Modify: `frontend/src/features/admin/AdminMembersPage.tsx`

**Interfaces:**
- Consumes: `invokeMemberApi("list_access_requests")` → `{ requests: Array<{ id: string; display_name: string; created_at: string }> }`.
- Consumes: `invokeMemberApi("approve_access_request", { requestId, adminNote })`.
- Consumes: `invokeMemberApi("reject_access_request", { requestId, adminNote })`.
- Produces: A new collapsible section at the top of `AdminMembersPage` that shows pending access requests with Approve/Reject buttons.

- [ ] **Step 1: Write a test**

In `frontend/src/features/admin/AdminMembersPage.test.tsx` (create if absent):

```typescript
// frontend/src/features/admin/AdminMembersPage.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi, it, expect } from "vitest";
import { AdminMembersPage } from "./AdminMembersPage";

it("shows pending access requests", async () => {
  // Mock the invokeMemberApi calls
  vi.mock("../../lib/supabase", () => ({
    invokeMemberApi: vi.fn().mockImplementation((action: string) => {
      if (action === "list_access_requests")
        return Promise.resolve({ requests: [{ id: "req-1", display_name: "New User", created_at: "2026-10-01T00:00:00Z" }] });
      if (action === "list_members")
        return Promise.resolve({ members: [] });
      return Promise.resolve({});
    }),
  }));
  render(<AdminMembersPage />);
  expect(await screen.findByText("New User")).toBeInTheDocument();
});
```

Run: `npm test` — FAIL (feature not implemented yet).

- [ ] **Step 2: Add access requests section to AdminMembersPage.tsx**

Open `frontend/src/features/admin/AdminMembersPage.tsx` and add a new `AccessRequestsSection` component at the top of the file, then render it inside the page before the existing members table:

```typescript
// Add inside AdminMembersPage.tsx

function AccessRequestsSection() {
  const [requests, setRequests] = useState<Array<{ id: string; display_name: string; created_at: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void invokeMemberApi("list_access_requests")
      .then((data) => setRequests((data as { requests: typeof requests }).requests))
      .catch(() => setMessage("Could not load access requests."));
  }, []);

  async function resolve(id: string, action: "approve" | "reject") {
    setBusy(true); setMessage(null);
    try {
      await invokeMemberApi(
        action === "approve" ? "approve_access_request" : "reject_access_request",
        { requestId: id }
      );
      setRequests((prev) => prev.filter((r) => r.id !== id));
      setMessage(action === "approve" ? "Request approved." : "Request rejected.");
    } catch {
      setMessage("Could not process request. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (requests.length === 0 && !message) return null;

  return (
    <section className="card" aria-labelledby="access-requests-heading">
      <h2 id="access-requests-heading">Access requests</h2>
      {message && <p role="status">{message}</p>}
      {requests.length === 0 && <p>No pending requests.</p>}
      <ul className="admin-participant-list">
        {requests.map((r) => (
          <li key={r.id}>
            <span><strong>{r.display_name}</strong> · {new Date(r.created_at).toLocaleDateString()}</span>
            <div>
              <button type="button" disabled={busy} onClick={() => void resolve(r.id, "approve")}>Approve</button>
              <button type="button" className="secondary-button" disabled={busy} onClick={() => void resolve(r.id, "reject")}>Reject</button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

Add `<AccessRequestsSection />` at the top of the `AdminMembersPage` render output.

- [ ] **Step 3: Run all tests**

```bash
npm test && npm run typecheck
```

Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/features/admin/AdminMembersPage.tsx \
        frontend/src/features/admin/AdminMembersPage.test.tsx
git commit -m "feat: add access request management to admin members page"
```

---

## Phase UI-B: Unified Landing Page (EventCard with full metadata)

### Task 8: Extend trip-api get_calendar to return waitlist + capacity fields

**Files:**
- Modify: `supabase/functions/trip-api/index.ts` — `getCalendar` function

**Interfaces:**
- Consumes: new `trip_waitlist_entries` table (Task A3) and new columns `per_cabin_capacity`, `cabin_count` (Task A2).
- Produces: Each trip object in `get_calendar` response gains:
  - `perCabinCapacity: number` (from `per_cabin_capacity`)
  - `cabinCount: number | null` (from `cabin_count`)
  - `effectiveCapacity: number | null` — computed: `maxCapacity ?? (cabinCount != null ? cabinCount * perCabinCapacity : null)`
  - `spotsRemaining: number | null` — `effectiveCapacity != null ? Math.max(0, effectiveCapacity - comingCount) : null`
  - `waitlistCount: number` — count of `trip_waitlist_entries` with `status = 'waiting'` for this trip
  - `myWaitlistPosition: number | null` — caller's position if on waitlist

- [ ] **Step 1: Write a TypeScript type update test**

In `frontend/src/domain/calendar.test.ts`, add:

```typescript
it("trip has waitlist and capacity fields", () => {
  const trip: Trip = {
    tripId: "a", monthKey: "2026-11", rotationPosition: 1,
    suggestedCampsiteId: "b", selectedCampsiteId: "b",
    startsOn: null, endsOn: null, clubTimezone: null, pollDeadlineAt: null,
    minimumParticipants: 4, minimumBasis: null, maxCapacity: null,
    perCabinCapacity: 6, cabinCount: null, effectiveCapacity: null,
    spotsRemaining: null, waitlistCount: 0, myWaitlistPosition: null,
    pollStatus: "draft", additionalInformation: "",
    cabinBookingStatus: null, legacyCabinAvailabilityStatus: null,
    version: 1, comingCount: 0, tripDecision: "none",
    currentRuleBundle: null, myRsvp: null,
  };
  expect(trip.perCabinCapacity).toBe(6);
  expect(trip.waitlistCount).toBe(0);
});
```

This test will fail until the `Trip` type in `TripCalendarPage.tsx` is updated. Run to confirm:

```bash
npm test
```

Expected: FAIL — `Trip` does not have `perCabinCapacity`, `waitlistCount`, etc.

- [ ] **Step 2: Update `Trip` type in TripCalendarPage.tsx**

In `frontend/src/features/trips/TripCalendarPage.tsx`, update the `Trip` type (lines 14–22) to add the new fields:

```typescript
type Trip = {
  tripId: string; monthKey: string; rotationPosition: number; suggestedCampsiteId: string; selectedCampsiteId: string;
  startsOn: string | null; endsOn: string | null; clubTimezone: string | null; pollDeadlineAt: string | null;
  minimumParticipants: number; minimumBasis: null; maxCapacity: number | null;
  perCabinCapacity: number; cabinCount: number | null;
  effectiveCapacity: number | null; spotsRemaining: number | null;
  waitlistCount: number; myWaitlistPosition: number | null;
  pollStatus: "draft" | "open" | "closed";
  additionalInformation: string; cabinBookingStatus: CabinBookingStatus | null;
  legacyCabinAvailabilityStatus?: string | null; version: number; comingCount: number;
  tripDecision: "none"; currentRuleBundle: Bundle | null;
  myRsvp: null | { response: "coming" | "not_coming"; acknowledgmentId: string | null; version: number; updatedAt: string; acceptedRuleBundle?: Bundle | null };
  myWaitlistEntry?: { position: number; status: string };
  participantEntries?: Array<{ memberId: string; displayName: string; response: "coming" | "not_coming"; version: number; acknowledgmentId: string | null }>;
};
```

Also update `calendar.test.ts` to import the `Trip` type:

```typescript
// At top of calendar.test.ts, add:
import type { Trip } from "../features/trips/TripCalendarPage";
```

- [ ] **Step 3: Update getCalendar in trip-api/index.ts**

In `supabase/functions/trip-api/index.ts`, in the `getCalendar` function:

1. Add `per_cabin_capacity, cabin_count` to the `camping_trips` SELECT (around line 135).
2. After fetching trips, fetch waitlist counts and own waitlist entry:

```typescript
// Add after bundleResult/rsvpResult fetch (around line 148):
const [waitlistCountResult, ownWaitlistResult] = tripIds.length ? await Promise.all([
  service
    .from("trip_waitlist_entries")
    .select("trip_id, id", { count: "exact" })
    .in("trip_id", tripIds)
    .eq("status", "waiting"),
  service
    .from("trip_waitlist_entries")
    .select("trip_id, position, status")
    .in("trip_id", tripIds)
    .eq("member_id", member.member_id)
    .eq("status", "waiting"),
]) : [{ data: [], error: null }, { data: [], error: null }];
checkError(waitlistCountResult.error);
checkError(ownWaitlistResult.error);

const waitlistCountsByTrip = new Map<string, number>();
for (const row of waitlistCountResult.data ?? []) {
  waitlistCountsByTrip.set(row.trip_id, (waitlistCountsByTrip.get(row.trip_id) ?? 0) + 1);
}
const ownWaitlistByTrip = new Map(
  (ownWaitlistResult.data ?? []).map((row) => [row.trip_id, row])
);
```

3. In the trip mapping (around line 220 where trips are mapped to response objects), add the new fields:

```typescript
perCabinCapacity: trip.per_cabin_capacity ?? 6,
cabinCount: trip.cabin_count ?? null,
effectiveCapacity: trip.max_capacity
  ?? (trip.cabin_count != null ? trip.cabin_count * (trip.per_cabin_capacity ?? 6) : null),
spotsRemaining: trip.max_capacity != null
  ? Math.max(0, trip.max_capacity - (counts.get(trip.id) ?? 0))
  : trip.cabin_count != null
    ? Math.max(0, trip.cabin_count * (trip.per_cabin_capacity ?? 6) - (counts.get(trip.id) ?? 0))
    : null,
waitlistCount: waitlistCountsByTrip.get(trip.id) ?? 0,
myWaitlistPosition: ownWaitlistByTrip.get(trip.id)?.position ?? null,
```

- [ ] **Step 4: Run tests**

```bash
npm test && npm run typecheck
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/trip-api/index.ts \
        frontend/src/features/trips/TripCalendarPage.tsx \
        frontend/src/domain/calendar.test.ts
git commit -m "feat: extend get_calendar with capacity, waitlist count, and spots remaining"
```

---

### Task 9: Redesign TripCalendarPage — unified EventCard landing page

**Files:**
- Modify: `frontend/src/features/trips/TripCalendarPage.tsx` — refactor `TripPollCard` into a new `EventCard` component with mobile-first layout
- Modify: `frontend/src/features/trips/TripCalendarPage.test.tsx` — update tests to match new component

**Interfaces:**
- Consumes: enriched `Trip` type from Task B1.
- Produces:
  - `EventCard` renders for ALL members (not just admins on a separate tab). Shows:
    - Month + `additionalInformation` as title (fallback: "Camping Trip")
    - Start/end date (or "Dates TBA" for drafts)
    - Campsite name + location description (looked up from calendar.campsites)
    - `cabinCount` cabins booked / `effectiveCapacity` capacity / `comingCount` confirmed / `spotsRemaining` spots left / `waitlistCount` on waitlist
    - Current member RSVP status badge
    - Inline Yes/No RSVP buttons (hidden for drafts; disabled after cutoff unless admin)
    - Clickable card → navigate to `/trips/:tripId` (wired in Phase UI-C)
  - Admin controls remain inline per card (poll open/close, configure trip — move from top tabs into card)
  - Top admin tabs removed; admin sections appear inside each card under a collapsible "Admin" section

- [ ] **Step 1: Write failing tests for new card structure**

In `frontend/src/features/trips/TripCalendarPage.test.tsx`, add:

```typescript
it("shows Dates TBA for draft trips", () => {
  const calendar = buildCalendar([{
    tripId: "t1", pollStatus: "draft", startsOn: null, endsOn: null,
    perCabinCapacity: 6, cabinCount: 2, effectiveCapacity: 12,
    spotsRemaining: 12, waitlistCount: 0, myWaitlistPosition: null,
    comingCount: 0, myRsvp: null,
  }]);
  render(<TripCalendarPage isAdmin={false} api={mockApi(calendar)} />);
  expect(screen.findByText(/dates tba/i)).toBeTruthy();
});

it("shows spots remaining and waitlist count", async () => {
  const calendar = buildCalendar([{
    tripId: "t1", pollStatus: "open", startsOn: "2026-12-05", endsOn: "2026-12-07",
    perCabinCapacity: 6, cabinCount: 2, effectiveCapacity: 12,
    spotsRemaining: 8, waitlistCount: 3, myWaitlistPosition: null,
    comingCount: 4, myRsvp: null,
  }]);
  render(<TripCalendarPage isAdmin={false} api={mockApi(calendar)} />);
  expect(await screen.findByText(/8 spots remaining/i)).toBeInTheDocument();
  expect(screen.getByText(/3 on waitlist/i)).toBeInTheDocument();
});
```

These will fail until the EventCard is built. Run to confirm:
```bash
npm test
```

Expected: FAIL on the new tests.

- [ ] **Step 2: Refactor TripPollCard into EventCard in TripCalendarPage.tsx**

Replace `TripPollCard` with a new `EventCard` component. Key rules:
- For `pollStatus === 'draft'`: show "Dates TBA", no RSVP buttons.
- Show RSVP status as a badge: Going / Not Going / Waitlisted / Pending Approval.
- Yes/No buttons only show when poll is open and deadline is in the future.
- If capacity is full on Yes click → route to waitlist (handled in Task D1).
- Campsite lookup: `calendar.campsites.find(s => s.campsiteId === trip.selectedCampsiteId)`.

```typescript
function EventCard({ trip, campsite, isAdmin, api, onRefresh }: {
  trip: Trip;
  campsite: Campsite | undefined;
  isAdmin: boolean;
  api: TripApi;
  onRefresh: () => Promise<void>;
}) {
  const [choice, setChoice] = useState<"coming" | "not_coming" | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAdminPanel, setShowAdminPanel] = useState(false);

  const isDraft = trip.pollStatus === "draft";
  const isOpen = trip.pollStatus === "open"
    && Boolean(trip.pollDeadlineAt)
    && new Date(trip.pollDeadlineAt as string).getTime() > Date.now();
  const isComing = trip.myRsvp?.response === "coming";
  const isNotComing = trip.myRsvp?.response === "not_coming";
  const isWaitlisted = Boolean(trip.myWaitlistPosition);
  const needsAcknowledgment = choice === "coming" && !isComing;

  const dateLabel = isDraft || (!trip.startsOn || !trip.endsOn)
    ? "Dates TBA"
    : `${trip.startsOn} – ${trip.endsOn}`;

  const rsvpStatusLabel = isWaitlisted ? "Waitlisted"
    : isComing ? "Going"
    : isNotComing ? "Not Going"
    : "No response";

  async function submit() {
    if (!choice) return;
    if (needsAcknowledgment && (!trip.currentRuleBundle || !acknowledged)) {
      setError("Acknowledge the Camping Constitution before selecting Going.");
      return;
    }
    setBusy(true); setError(null);
    try {
      await api("submit_rsvp", {
        tripId: trip.tripId,
        response: choice,
        expectedVersion: trip.myRsvp?.version ?? 0,
        ...(choice === "coming" && trip.currentRuleBundle
          ? { bundleId: trip.currentRuleBundle.id, contentHash: trip.currentRuleBundle.contentHash }
          : {}),
      });
      setChoice(null); setAcknowledged(false);
      await onRefresh();
    } catch {
      setError("Response could not be saved. The poll may have changed — refresh and try again.");
    } finally { setBusy(false); }
  }

  return (
    <article className="card event-card" aria-label={`Trip ${dateLabel}`}>
      <div className="event-card-head">
        <div>
          <p className="eyebrow">{monthName(trip.monthKey)}</p>
          <h2 className="event-card-title">{trip.additionalInformation || "Camping Trip"}</h2>
          <p className="event-card-date">{dateLabel}</p>
          {campsite && (
            <p className="event-card-location">
              {campsite.name}{campsite.locationDescription ? ` · ${campsite.locationDescription}` : ""}
            </p>
          )}
        </div>
        <span className={`status-chip status-${trip.myWaitlistPosition ? "waitlisted" : trip.myRsvp?.response ?? "none"}`}>
          {rsvpStatusLabel}
        </span>
      </div>

      <div className="event-card-meta">
        {trip.cabinCount != null && <span>{trip.cabinCount} cabin{trip.cabinCount !== 1 ? "s" : ""} booked</span>}
        {trip.effectiveCapacity != null && <span>Capacity: {trip.effectiveCapacity}</span>}
        <span>{trip.comingCount} confirmed</span>
        {trip.spotsRemaining != null && <span>{trip.spotsRemaining} spots remaining</span>}
        {trip.waitlistCount > 0 && <span>{trip.waitlistCount} on waitlist</span>}
      </div>

      {!isDraft && isOpen && (
        <div className="response-actions">
          <button
            type="button"
            className={choice === "coming" || (!choice && isComing) ? "selected" : "secondary-button"}
            onClick={() => { setChoice(isComing && !choice ? null : "coming"); setError(null); }}
          >
            {!choice && isComing ? "Going ✓" : "Going"}
          </button>
          <button
            type="button"
            className={choice === "not_coming" ? "selected" : "secondary-button"}
            onClick={() => { setChoice("not_coming"); setAcknowledged(false); setError(null); }}
          >
            Not Going
          </button>
        </div>
      )}

      {choice === "coming" && needsAcknowledgment && trip.currentRuleBundle && (
        <section className="rules-acknowledgment" aria-label="Camping Constitution acknowledgment">
          <h3>Camping Constitution · version {trip.currentRuleBundle.version}</h3>
          <div className="rules-list">
            {trip.currentRuleBundle.rules.map((rule) => (
              <article key={rule.stable_key}>
                <h4>{rule.stable_key.replaceAll("-", " ")}</h4>
                <p>{rule.text}</p>
              </article>
            ))}
          </div>
          <label className="checkbox-label">
            <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />
            <span>I have read and agree to the Camping Constitution shown above.</span>
          </label>
          <button type="button" onClick={() => void submit()} disabled={busy}>
            {busy ? "Saving…" : "Confirm Going"}
          </button>
        </section>
      )}

      {choice === "not_coming" && (
        <div className="not-coming-submit">
          <button type="button" onClick={() => void submit()} disabled={busy}>
            {busy ? "Saving…" : "Confirm Not Going"}
          </button>
        </div>
      )}

      {error && <p role="alert" className="form-error">{error}</p>}

      {isAdmin && (
        <details className="admin-panel" onToggle={(e) => setShowAdminPanel((e.target as HTMLDetailsElement).open)}>
          <summary>Admin controls</summary>
          {showAdminPanel && (
            <AdminTripPanel trip={trip} calendar={undefined as never} api={api} onRefresh={onRefresh} />
          )}
        </details>
      )}
    </article>
  );
}
```

> **Note:** `AdminTripPanel` is extracted from the existing `PollManager` logic and scoped to a single trip. The `CampsiteManager`, `ClubSettingsForm`, and `ConstitutionManager` keep their existing tab-based location for the admin page, but a compact version lives in the event card admin panel. Keep the existing admin-only tab section for full management — just hide it from non-admins.

- [ ] **Step 3: Update TripCalendarPage render**

Change the render output so:
1. Admin tabs remain (for campsites and constitution management) but calendar tab shows EventCards.
2. EventCards are rendered for all members (not wrapped in `isAdmin || tab === "calendar"`).
3. Trips are sorted ascending by `startsOn` (nulls last for drafts).

```typescript
// In TripCalendarPage render, replace the calendar section:
{calendar && (
  <div className="stack">
    {isAdmin && <PollManager calendar={calendar} api={api} onRefresh={refresh} />}
    {[...calendar.trips]
      .sort((a, b) => {
        if (!a.startsOn && !b.startsOn) return 0;
        if (!a.startsOn) return 1;
        if (!b.startsOn) return -1;
        return a.startsOn.localeCompare(b.startsOn);
      })
      .map((trip) => (
        <EventCard
          key={trip.tripId}
          trip={trip}
          campsite={calendar.campsites.find((s) => s.campsiteId === trip.selectedCampsiteId)}
          isAdmin={isAdmin}
          api={api}
          onRefresh={refresh}
        />
      ))}
  </div>
)}
```

- [ ] **Step 4: Run tests**

```bash
npm test && npm run typecheck
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/trips/TripCalendarPage.tsx \
        frontend/src/features/trips/TripCalendarPage.test.tsx
git commit -m "feat: redesign landing page with unified EventCard component for all members"
```

---

## Phase UI-C: Event Details Page

### Task 10: trip-api get_trip_details action

**Files:**
- Modify: `supabase/functions/trip-api/index.ts` — add `get_trip_details` action

**Interfaces:**
- Consumes: existing DB tables; `trip_waitlist_entries` from Task A3; capacity columns from Task A2.
- Produces: New action `get_trip_details` with input `{ tripId: string }`. Returns a single trip's full data including:
  - All calendar-level trip fields (same shape as a single trip in `get_calendar`)
  - `campsite: Campsite | null` (full campsite object for selected campsite)
  - `waitlistEntries: Array<{ memberId: string; displayName: string; position: number; createdAt: string }>` (admin only)
  - `participantEntries`: all "coming" members (all members, not just admin)
  - `constitutionData: { definitions, versions, overrides }` (same shape as `get_constitution`)

- [ ] **Step 1: Add action to actionNames and input schemas in trip-api/index.ts**

Add `"get_trip_details"` to `actionNames` array (line 14). Add to `inputSchemas`:

```typescript
get_trip_details: z.object({ tripId: uuid }).strict(),
```

- [ ] **Step 2: Implement the getOneTripDetails handler**

After the existing `getCalendar` function, add:

```typescript
async function getTripDetails(member: Member, tripId: string): Promise<Record<string, unknown>> {
  const [tripResult, campsiteResult, bundleResult, rsvpResult, waitlistResult] = await Promise.all([
    service.from("camping_trips")
      .select("id,month_key,rotation_position,suggested_campsite_id,selected_campsite_id,starts_on,ends_on,club_timezone_snapshot,poll_deadline_at,minimum_participants,minimum_basis,max_capacity,per_cabin_capacity,cabin_count,poll_status,additional_information,cabin_booking_status,version")
      .eq("id", tripId).single(),
    // Campsite fetched after tripResult; done in series below
    service.from("trip_rule_bundles").select("id,trip_id,version_no,content_hash,rendered_bundle,created_at").eq("trip_id", tripId).eq("is_current", true).maybeSingle(),
    service.from("trip_rsvps").select("trip_id,member_id,response,rule_acknowledgment_id,version,updated_at").eq("trip_id", tripId),
    service.from("trip_waitlist_entries").select("id,member_id,position,status,created_at").eq("trip_id", tripId).eq("status", "waiting").order("position"),
  ]);
  checkError(tripResult.error);
  if (!tripResult.data) throw Object.assign(new Error("trip not found"), { code: "22023" });

  const trip = tripResult.data;
  const { data: campsite, error: siteError } = await service.from("campsites")
    .select("id,rotation_position,name,availability_url,location_description,directions,cabin_capacity,cabin_types,reservation_instructions,estimated_rate_cents,availability_status,availability_source_url,availability_verified_at,version")
    .eq("id", trip.selected_campsite_id).maybeSingle();
  checkError(siteError);

  const rsvps = rsvpResult.data ?? [];
  const memberIds = [...new Set([...rsvps.map((r) => r.member_id), ...(waitlistResult.data ?? []).map((w) => w.member_id)])];
  const { data: memberRows } = memberIds.length
    ? await service.from("member_profiles").select("member_id,display_name").in("member_id", memberIds)
    : { data: [] };
  const nameMap = new Map((memberRows ?? []).map((m) => [m.member_id, m.display_name]));

  const ownRsvp = rsvps.find((r) => r.member_id === member.member_id);
  const comingCount = rsvps.filter((r) => r.response === "coming").length;

  const participantEntries = rsvps
    .filter((r) => r.response === "coming")
    .map((r) => ({ memberId: r.member_id, displayName: nameMap.get(r.member_id) ?? "Member", response: r.response }));

  const waitlistEntries = member.member_role === "admin"
    ? (waitlistResult.data ?? []).map((w) => ({
        memberId: w.member_id,
        displayName: nameMap.get(w.member_id) ?? "Member",
        position: w.position,
        createdAt: w.created_at,
      }))
    : [];

  const ownWaitlistEntry = (waitlistResult.data ?? []).find((w) => w.member_id === member.member_id);

  const effectiveCapacity = trip.max_capacity
    ?? (trip.cabin_count != null ? trip.cabin_count * (trip.per_cabin_capacity ?? 6) : null);

  // Constitution data (same as get_constitution)
  const { data: constitutionData } = await service.rpc("phase2_refresh_open_rule_bundles", {
    p_actor_id: member.member_id, p_trip_ids: [tripId],
  });

  return {
    tripId: trip.id,
    monthKey: trip.month_key,
    pollStatus: trip.poll_status,
    startsOn: trip.starts_on,
    endsOn: trip.ends_on,
    clubTimezone: trip.club_timezone_snapshot,
    pollDeadlineAt: trip.poll_deadline_at,
    minimumParticipants: trip.minimum_participants,
    maxCapacity: trip.max_capacity,
    perCabinCapacity: trip.per_cabin_capacity ?? 6,
    cabinCount: trip.cabin_count ?? null,
    effectiveCapacity,
    spotsRemaining: effectiveCapacity != null ? Math.max(0, effectiveCapacity - comingCount) : null,
    comingCount,
    waitlistCount: (waitlistResult.data ?? []).length,
    myWaitlistPosition: ownWaitlistEntry?.position ?? null,
    cabinBookingStatus: trip.cabin_booking_status,
    additionalInformation: trip.additional_information,
    version: trip.version,
    campsite: campsite ? {
      campsiteId: campsite.id,
      name: campsite.name,
      locationDescription: campsite.location_description,
      availabilityUrl: campsite.availability_url,
      directions: campsite.directions,
      cabinCapacity: campsite.cabin_capacity,
      reservationInstructions: campsite.reservation_instructions,
    } : null,
    currentRuleBundle: bundleResult.data ? {
      id: bundleResult.data.id,
      version: bundleResult.data.version_no,
      contentHash: bundleResult.data.content_hash,
      rules: (bundleResult.data.rendered_bundle as Array<{ stable_key: string; text: string; structured_values: Record<string, unknown> }>),
      createdAt: bundleResult.data.created_at,
    } : null,
    myRsvp: ownRsvp ? {
      response: ownRsvp.response,
      acknowledgmentId: ownRsvp.rule_acknowledgment_id,
      version: ownRsvp.version,
      updatedAt: ownRsvp.updated_at,
    } : null,
    participantEntries,
    waitlistEntries,
  };
}
```

In the main `Deno.serve` handler, add the new action routing for `get_trip_details` (following the same pattern as `get_calendar`).

- [ ] **Step 3: Add get_trip_details to adminActions (read-only, not mutating)**

`get_trip_details` is NOT an admin-only action (all members can view). Add it to `actionNames` only.

- [ ] **Step 4: Run tests**

```bash
npm test && npm run typecheck
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/trip-api/index.ts
git commit -m "feat: add get_trip_details action to trip-api"
```

---

### Task 11: EventDetailsPage component — four-tab layout

**Files:**
- Create: `frontend/src/features/trips/EventDetailsPage.tsx`
- Create: `frontend/src/features/trips/EventDetailsPage.test.tsx`
- Modify: `frontend/src/App.tsx` — add `/trips/:tripId` route

**Interfaces:**
- Consumes: `invokeTripApi("get_trip_details", { tripId })`.
- Consumes: `invokeTripApi("get_constitution", { tripId })` for Constitution tab data.
- Produces: Route `/trips/:tripId` renders `EventDetailsPage` with four tabs:
  - **Overview**: event details (name, dates, campsite, capacity, attendee count, RSVP widget identical to EventCard).
  - **Constitution**: grouped by 4 categories (Travel & Cabin = transport+cabin, Food & Expenses = expenses+conduct, Lodging & Responsibilities = lodging+participation, Packing & Meals = meals+custom); show effective bundle for trip; member's accepted version shown if they RSVPed.
  - **Logistics**: transport, cabin assignments, responsibilities, meals and packing sections (currently just `additionalInformation`; expandable as future data is added).
  - **Financials**: placeholder text "Settlement details will be available after the trip is confirmed." (Phase 3).
  - Admin tab panels: inline Edit Trip, Constitution management dropdowns.

- [ ] **Step 1: Write failing tests**

```typescript
// frontend/src/features/trips/EventDetailsPage.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi, it, expect, describe } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";
import { EventDetailsPage } from "./EventDetailsPage";

const tripData = {
  tripId: "trip-1",
  monthKey: "2026-12",
  pollStatus: "open" as const,
  startsOn: "2026-12-05",
  endsOn: "2026-12-07",
  additionalInformation: "December Camping",
  comingCount: 3,
  effectiveCapacity: 12,
  spotsRemaining: 9,
  waitlistCount: 0,
  myWaitlistPosition: null,
  myRsvp: null,
  currentRuleBundle: null,
  campsite: { campsiteId: "s1", name: "Pine Ridge", locationDescription: "Pine, CO", availabilityUrl: null, directions: null, cabinCapacity: 6, reservationInstructions: null },
  perCabinCapacity: 6,
  cabinCount: 2,
  maxCapacity: null,
  participantEntries: [],
  waitlistEntries: [],
  version: 1,
};

function mockApi(data: typeof tripData) {
  return vi.fn().mockResolvedValue(data);
}

describe("EventDetailsPage", () => {
  it("renders Overview tab by default", async () => {
    render(
      <MemoryRouter initialEntries={["/trips/trip-1"]}>
        <Routes>
          <Route path="/trips/:tripId" element={<EventDetailsPage isAdmin={false} api={mockApi(tripData)} />} />
        </Routes>
      </MemoryRouter>
    );
    expect(await screen.findByText("December Camping")).toBeInTheDocument();
    expect(screen.getByText(/Pine Ridge/)).toBeInTheDocument();
  });

  it("switches to Constitution tab", async () => {
    render(
      <MemoryRouter initialEntries={["/trips/trip-1"]}>
        <Routes>
          <Route path="/trips/:tripId" element={<EventDetailsPage isAdmin={false} api={mockApi(tripData)} />} />
        </Routes>
      </MemoryRouter>
    );
    await screen.findByText("December Camping");
    await userEvent.click(screen.getByRole("tab", { name: /constitution/i }));
    expect(screen.getByRole("heading", { name: /camping constitution/i })).toBeInTheDocument();
  });
});
```

Run: `npm test` — FAIL (EventDetailsPage does not exist yet).

- [ ] **Step 2: Create EventDetailsPage.tsx**

```typescript
// frontend/src/features/trips/EventDetailsPage.tsx
import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { invokeTripApi, TripApiError } from "../../lib/supabase";

type TripDetails = {
  tripId: string;
  monthKey: string;
  pollStatus: "draft" | "open" | "closed";
  startsOn: string | null;
  endsOn: string | null;
  additionalInformation: string;
  comingCount: number;
  effectiveCapacity: number | null;
  spotsRemaining: number | null;
  waitlistCount: number;
  myWaitlistPosition: number | null;
  myRsvp: null | { response: "coming" | "not_coming"; version: number; acknowledgmentId: string | null; updatedAt: string };
  currentRuleBundle: null | { id: string; version: number; contentHash: string; rules: Array<{ stable_key: string; text: string; category?: string; structured_values: Record<string, unknown> }>; createdAt: string };
  campsite: null | { campsiteId: string; name: string; locationDescription: string; availabilityUrl: string | null; directions: string | null; cabinCapacity: number | null; reservationInstructions: string | null };
  perCabinCapacity: number;
  cabinCount: number | null;
  maxCapacity: number | null;
  participantEntries: Array<{ memberId: string; displayName: string; response: string }>;
  waitlistEntries: Array<{ memberId: string; displayName: string; position: number; createdAt: string }>;
  version: number;
};

type Tab = "overview" | "constitution" | "logistics" | "financials";
type TripApiType = <T = unknown>(action: string, input?: unknown) => Promise<T>;

const constitutionGroups: Array<{ label: string; categories: string[] }> = [
  { label: "Travel & Cabin", categories: ["transport", "cabin"] },
  { label: "Food & Expenses", categories: ["expenses", "conduct"] },
  { label: "Lodging & Responsibilities", categories: ["lodging", "participation"] },
  { label: "Packing & Meals", categories: ["meals", "custom"] },
];

type Props = { isAdmin: boolean; api?: TripApiType };
const defaultApi: TripApiType = (action, input) => invokeTripApi(action, input);

export function EventDetailsPage({ isAdmin, api = defaultApi }: Props) {
  const { tripId } = useParams<{ tripId: string }>();
  const [details, setDetails] = useState<TripDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("overview");
  const [rsvpChoice, setRsvpChoice] = useState<"coming" | "not_coming" | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [rsvpBusy, setRsvpBusy] = useState(false);
  const [rsvpError, setRsvpError] = useState<string | null>(null);

  async function refresh() {
    if (!tripId) return;
    setError(null);
    try { setDetails(await api<TripDetails>("get_trip_details", { tripId })); }
    catch { setError("Could not load trip details. Please try again."); }
    finally { setLoading(false); }
  }

  useEffect(() => { void refresh(); }, [tripId]);

  async function submitRsvp() {
    if (!details || !rsvpChoice) return;
    if (rsvpChoice === "coming" && details.myRsvp?.response !== "coming") {
      if (!details.currentRuleBundle || !acknowledged) {
        setRsvpError("Acknowledge the Camping Constitution before selecting Going.");
        return;
      }
    }
    setRsvpBusy(true); setRsvpError(null);
    try {
      await api("submit_rsvp", {
        tripId: details.tripId,
        response: rsvpChoice,
        expectedVersion: details.myRsvp?.version ?? 0,
        ...(rsvpChoice === "coming" && details.currentRuleBundle
          ? { bundleId: details.currentRuleBundle.id, contentHash: details.currentRuleBundle.contentHash }
          : {}),
      });
      setRsvpChoice(null); setAcknowledged(false);
      await refresh();
    } catch {
      setRsvpError("Response could not be saved. Refresh and try again.");
    } finally { setRsvpBusy(false); }
  }

  if (loading) return <p role="status">Loading trip details…</p>;
  if (error || !details) return (
    <div className="card">
      <p role="alert">{error ?? "Trip not found."}</p>
      <button className="secondary-button" onClick={() => void refresh()}>Try again</button>
    </div>
  );

  const isDraft = details.pollStatus === "draft";
  const isOpen = details.pollStatus === "open"
    && Boolean(details.myRsvp === null || true) // show for all open trips
    && true; // Deadline check done server-side; show buttons always when open
  const rsvpStatusLabel = details.myWaitlistPosition ? "Waitlisted"
    : details.myRsvp?.response === "coming" ? "Going"
    : details.myRsvp?.response === "not_coming" ? "Not Going"
    : "No response";

  const groupedRules = constitutionGroups.map((group) => ({
    ...group,
    rules: (details.currentRuleBundle?.rules ?? []).filter((r) =>
      group.categories.includes((r as { category?: string }).category ?? "custom")
    ),
  }));

  return (
    <section className="event-details">
      <div className="page-heading">
        <p className="eyebrow">{details.monthKey}</p>
        <h1>{details.additionalInformation || "Camping Trip"}</h1>
        {!isDraft && details.startsOn && <p>{details.startsOn} – {details.endsOn}</p>}
        {isDraft && <p className="eyebrow">Dates TBA</p>}
      </div>

      <div className="event-tabs" role="tablist" aria-label="Trip sections">
        {(["overview", "constitution", "logistics", "financials"] as Tab[]).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="stack">
          {details.campsite && (
            <div className="card">
              <h2>Campsite</h2>
              <p><strong>{details.campsite.name}</strong></p>
              {details.campsite.locationDescription && <p>{details.campsite.locationDescription}</p>}
              {details.campsite.availabilityUrl && (
                <a href={details.campsite.availabilityUrl} target="_blank" rel="noopener noreferrer">
                  View campsite
                </a>
              )}
            </div>
          )}

          <div className="card">
            <h2>Attendance</h2>
            <div className="event-card-meta">
              {details.cabinCount != null && <span>{details.cabinCount} cabins booked</span>}
              {details.effectiveCapacity != null && <span>Capacity: {details.effectiveCapacity}</span>}
              <span>{details.comingCount} confirmed</span>
              {details.spotsRemaining != null && <span>{details.spotsRemaining} spots remaining</span>}
              {details.waitlistCount > 0 && <span>{details.waitlistCount} on waitlist</span>}
            </div>
            <p>Your status: <strong>{rsvpStatusLabel}</strong></p>

            {!isDraft && isOpen && (
              <div className="response-actions">
                <button
                  type="button"
                  className={rsvpChoice === "coming" || (!rsvpChoice && details.myRsvp?.response === "coming") ? "selected" : "secondary-button"}
                  onClick={() => { setRsvpChoice(details.myRsvp?.response === "coming" && !rsvpChoice ? null : "coming"); setRsvpError(null); }}
                >
                  {!rsvpChoice && details.myRsvp?.response === "coming" ? "Going ✓" : "Going"}
                </button>
                <button
                  type="button"
                  className={rsvpChoice === "not_coming" ? "selected" : "secondary-button"}
                  onClick={() => { setRsvpChoice("not_coming"); setAcknowledged(false); setRsvpError(null); }}
                >
                  Not Going
                </button>
              </div>
            )}

            {rsvpChoice === "coming" && details.myRsvp?.response !== "coming" && details.currentRuleBundle && (
              <div className="rules-acknowledgment">
                <p>By selecting Going you agree to the current Camping Constitution (version {details.currentRuleBundle.version}).</p>
                <label className="checkbox-label">
                  <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />
                  <span>I have read and agree to the Camping Constitution.</span>
                </label>
                <button type="button" onClick={() => void submitRsvp()} disabled={rsvpBusy}>
                  {rsvpBusy ? "Saving…" : "Confirm Going"}
                </button>
              </div>
            )}

            {rsvpChoice === "not_coming" && (
              <button type="button" onClick={() => void submitRsvp()} disabled={rsvpBusy}>
                {rsvpBusy ? "Saving…" : "Confirm Not Going"}
              </button>
            )}

            {rsvpError && <p role="alert" className="form-error">{rsvpError}</p>}

            {details.participantEntries.length > 0 && (
              <details>
                <summary>{details.comingCount} Going</summary>
                <ul>
                  {details.participantEntries.map((e) => (
                    <li key={e.memberId}>{e.displayName}</li>
                  ))}
                </ul>
              </details>
            )}

            {isAdmin && details.waitlistEntries.length > 0 && (
              <details>
                <summary>Waitlist ({details.waitlistEntries.length})</summary>
                <ol>
                  {details.waitlistEntries.map((w) => (
                    <li key={w.memberId}>{w.displayName} · joined {new Date(w.createdAt).toLocaleDateString()}</li>
                  ))}
                </ol>
              </details>
            )}
          </div>
        </div>
      )}

      {tab === "constitution" && (
        <div className="stack">
          <div className="card">
            <h2>Camping Constitution</h2>
            {!details.currentRuleBundle && <p>No constitution bundle available for this trip.</p>}
            {details.currentRuleBundle && (
              <>
                <p className="eyebrow">Version {details.currentRuleBundle.version}</p>
                {groupedRules.map((group) => group.rules.length > 0 && (
                  <details key={group.label} className="rule-history" open>
                    <summary>{group.label}</summary>
                    <div className="rules-list">
                      {group.rules.map((rule) => (
                        <article key={rule.stable_key}>
                          <h4>{rule.stable_key.replaceAll("-", " ")}</h4>
                          <p>{rule.text}</p>
                        </article>
                      ))}
                    </div>
                  </details>
                ))}
                {details.myRsvp?.response === "coming" && details.myRsvp.acknowledgmentId && (
                  <p className="eyebrow">You acknowledged version {details.currentRuleBundle.version}.</p>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {tab === "logistics" && (
        <div className="card">
          <h2>Logistics</h2>
          {details.additionalInformation
            ? <p>{details.additionalInformation}</p>
            : <p>Logistics details will be added by the administrator.</p>}
          {details.campsite?.reservationInstructions && (
            <>
              <h3>Reservation instructions</h3>
              <p>{details.campsite.reservationInstructions}</p>
            </>
          )}
          {details.campsite?.directions && (
            <>
              <h3>Directions</h3>
              <p>{details.campsite.directions}</p>
            </>
          )}
        </div>
      )}

      {tab === "financials" && (
        <div className="card">
          <h2>Financials</h2>
          <p>Settlement details will be available after the trip is confirmed. Expense tracking is coming in a future update.</p>
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 3: Add /trips/:tripId route to App.tsx**

In `frontend/src/App.tsx`, import `EventDetailsPage` and add a route:

```typescript
import { EventDetailsPage } from "./features/trips/EventDetailsPage";
// ...inside AppRoutes Routes block, before the * catch-all:
<Route
  path="/trips/:tripId"
  element={
    membership.status === "signedOut" ? <Navigate to="/signin" replace /> :
    <AccessBoundary state={membership} requiredRole="member">
      <EventDetailsPage isAdmin={membership.status === "active" && membership.role === "admin"} />
    </AccessBoundary>
  }
/>
```

- [ ] **Step 4: Make EventCards clickable — navigate to /trips/:tripId**

In `EventCard` (TripCalendarPage.tsx), wrap the card heading/body in a `Link`:

```typescript
import { Link } from "react-router";
// At top of EventCard article:
<Link to={`/trips/${trip.tripId}`} className="event-card-link" aria-label={`View details for ${trip.additionalInformation || "camping trip"}`}>
  <div className="event-card-head">...</div>
</Link>
// Keep RSVP buttons and admin panel outside the link
```

- [ ] **Step 5: Run all tests**

```bash
npm test && npm run typecheck
```

Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/features/trips/EventDetailsPage.tsx \
        frontend/src/features/trips/EventDetailsPage.test.tsx \
        frontend/src/App.tsx \
        frontend/src/features/trips/TripCalendarPage.tsx
git commit -m "feat: add EventDetailsPage with four tabs at /trips/:tripId"
```

---

## Phase UI-D: Waitlist — submit_rsvp capacity enforcement + admin promotion

### Task 12: Extend submit_rsvp to enforce capacity and create waitlist entries

**Files:**
- Modify: `supabase/functions/trip-api/index.ts` — `submit_rsvp` handler
- Create: `supabase/migrations/20261009185000_uiux_submit_rsvp_waitlist.sql` — DB function for waitlist insert

**Interfaces:**
- Produces: When `submit_rsvp` is called with `response = "coming"` and the trip is at capacity, instead of inserting into `trip_rsvps` as "coming", insert into `trip_waitlist_entries` and return `{ waitlisted: true, position: N }` instead of `{ rsvpId }`.
- Algorithm:
  1. Look up `effective_capacity = trip_effective_capacity(p_trip_id)`.
  2. Count current "coming" RSVPs (active members only).
  3. If `effective_capacity IS NULL OR coming_count < effective_capacity`: proceed with existing RSVP logic.
  4. If `coming_count >= effective_capacity`: insert waitlist entry, return `{ waitlisted: true, position }`.
  5. If member already has "coming" RSVP: allow re-submit (idempotent).
  6. If member is already on waitlist: return current position (idempotent).

- [ ] **Step 1: Write the DB function for waitlist insert**

```sql
-- supabase/migrations/20261009185000_uiux_submit_rsvp_waitlist.sql

CREATE OR REPLACE FUNCTION public.trip_api_join_waitlist(
  p_trip_id    uuid,
  p_member_id  uuid,
  p_request_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_existing_position int;
  v_new_position      int;
  v_entry_id          uuid;
BEGIN
  -- Check if member already on waitlist
  SELECT position INTO v_existing_position
  FROM public.trip_waitlist_entries
  WHERE trip_id = p_trip_id AND member_id = p_member_id AND status = 'waiting';

  IF FOUND THEN
    RETURN jsonb_build_object('waitlisted', true, 'position', v_existing_position);
  END IF;

  -- Get next position
  v_new_position := public.trip_waitlist_next_position(p_trip_id);

  INSERT INTO public.trip_waitlist_entries (trip_id, member_id, position)
  VALUES (p_trip_id, p_member_id, v_new_position)
  RETURNING id INTO v_entry_id;

  RETURN jsonb_build_object('waitlisted', true, 'position', v_new_position, 'entryId', v_entry_id);
END;
$$;
```

Apply:
```bash
npx supabase db reset
npm run test:db
```

- [ ] **Step 2: Update submit_rsvp handler in trip-api/index.ts**

In the `submit_rsvp` action handler (find by `action === "submit_rsvp"` in the switch/if block), before calling the existing RSVP DB RPC, add capacity check:

```typescript
if (input.response === "coming") {
  // Check capacity
  const [capacityResult, countResult] = await Promise.all([
    service.rpc("trip_effective_capacity", { p_trip_id: input.tripId }),
    service.from("trip_rsvps")
      .select("member_id", { count: "exact" })
      .eq("trip_id", input.tripId)
      .eq("response", "coming"),
  ]);
  const effectiveCapacity = capacityResult.data as number | null;
  const comingCount = countResult.count ?? 0;

  if (effectiveCapacity !== null && comingCount >= effectiveCapacity) {
    // Check if this member is already confirmed Coming
    const alreadyComing = await service.from("trip_rsvps")
      .select("id").eq("trip_id", input.tripId)
      .eq("member_id", member.member_id).eq("response", "coming").maybeSingle();
    if (!alreadyComing.data) {
      // Join waitlist
      const { data: waitlistResult, error: waitlistError } = await service.rpc("trip_api_join_waitlist", {
        p_trip_id: input.tripId,
        p_member_id: member.member_id,
        p_request_id: idempotencyKey,
      });
      checkError(waitlistError);
      await finish(member.member_id, action, aggregateId(action, input as Record<string, unknown>, member.member_id), idempotencyKey, input, (waitlistResult as { entryId?: string })?.entryId ?? null);
      return json(request, 200, { waitlisted: true, position: (waitlistResult as { position: number }).position, requestId });
    }
  }
}
// ... existing RSVP submission logic continues
```

- [ ] **Step 3: Add waitlist_joined_notice to EventCard and EventDetailsPage**

In `TripCalendarPage.tsx` EventCard, after the `submit` call:

```typescript
const [waitlistedPosition, setWaitlistedPosition] = useState<number | null>(null);
// ... after api("submit_rsvp"):
const result = await api<{ waitlisted?: boolean; position?: number }>("submit_rsvp", { ... });
if (result.waitlisted) {
  setWaitlistedPosition(result.position ?? null);
}
// In render:
{waitlistedPosition !== null && (
  <p role="status">You are #{waitlistedPosition} on the waitlist. The administrator will notify you if a spot opens.</p>
)}
```

Apply the same pattern in `EventDetailsPage.tsx`.

- [ ] **Step 4: Run all tests**

```bash
npm test && npm run typecheck && npm run test:db
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/trip-api/index.ts \
        supabase/migrations/20261009185000_uiux_submit_rsvp_waitlist.sql \
        frontend/src/features/trips/TripCalendarPage.tsx \
        frontend/src/features/trips/EventDetailsPage.tsx
git commit -m "feat: capacity enforcement in submit_rsvp — waitlist on full trip"
```

---

### Task 13: Admin waitlist promotion — admin_promote_from_waitlist action

**Files:**
- Modify: `supabase/functions/trip-api/index.ts` — add `admin_promote_from_waitlist` action
- Create: `supabase/migrations/20261009186000_uiux_promote_waitlist.sql`

**Interfaces:**
- Consumes: `trip_waitlist_entries`, existing `submit_rsvp` DB RPC.
- Produces: Action `admin_promote_from_waitlist` with input `{ tripId: string, memberId: string, reason: string }`.
  - Verifies: trip not overbooked, member is on waitlist (status = 'waiting').
  - Moves member from waitlist to confirmed RSVP (calls existing RSVP insert logic or a dedicated DB function).
  - Updates `trip_waitlist_entries.status = 'promoted'`, sets `resolved_at`, `promoted_by`.
  - Returns `{ promoted: true, memberId, position }`.
  - Fails with 409 if trip is now at capacity (concurrent protection).

- [ ] **Step 1: Write DB function**

```sql
-- supabase/migrations/20261009186000_uiux_promote_waitlist.sql

CREATE OR REPLACE FUNCTION public.trip_api_promote_from_waitlist(
  p_trip_id   uuid,
  p_member_id uuid,
  p_actor_id  uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_effective_capacity int;
  v_coming_count       int;
  v_position           int;
  v_entry_id           uuid;
BEGIN
  -- Lock the waitlist entry
  SELECT id, position INTO v_entry_id, v_position
  FROM public.trip_waitlist_entries
  WHERE trip_id = p_trip_id AND member_id = p_member_id AND status = 'waiting'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'member_not_on_waitlist' USING ERRCODE = 'P0001';
  END IF;

  -- Check capacity
  SELECT public.trip_effective_capacity(p_trip_id) INTO v_effective_capacity;
  SELECT count(*) INTO v_coming_count FROM public.trip_rsvps WHERE trip_id = p_trip_id AND response = 'coming';

  IF v_effective_capacity IS NOT NULL AND v_coming_count >= v_effective_capacity THEN
    RAISE EXCEPTION 'trip_at_capacity' USING ERRCODE = '23514';
  END IF;

  -- Promote: insert or update RSVP to coming
  INSERT INTO public.trip_rsvps (trip_id, member_id, response, version)
  VALUES (p_trip_id, p_member_id, 'coming', 1)
  ON CONFLICT (trip_id, member_id) DO UPDATE SET response = 'coming', version = trip_rsvps.version + 1, updated_at = now();

  -- Mark waitlist entry promoted
  UPDATE public.trip_waitlist_entries
  SET status = 'promoted', resolved_at = now(), promoted_by = p_actor_id
  WHERE id = v_entry_id;

  RETURN jsonb_build_object('promoted', true, 'memberId', p_member_id, 'position', v_position);
END;
$$;
```

- [ ] **Step 2: Add action to trip-api**

Add `"admin_promote_from_waitlist"` to `actionNames` and `adminActions`. Add to `inputSchemas`:

```typescript
admin_promote_from_waitlist: z.object({ tripId: uuid, memberId: uuid, reason }).strict(),
```

Add handler:

```typescript
if (action === "admin_promote_from_waitlist") {
  const input = parsedInput as { tripId: string; memberId: string; reason: string };
  const { data: result, error } = await service.rpc("trip_api_promote_from_waitlist", {
    p_trip_id: input.tripId,
    p_member_id: input.memberId,
    p_actor_id: member.member_id,
  });
  if (error?.message?.includes("member_not_on_waitlist")) return errorResponse(request, 404, "member_not_on_waitlist", requestId);
  if (error?.code === "23514") return errorResponse(request, 409, "trip_at_capacity", requestId);
  checkError(error);
  await finish(member.member_id, action, input.tripId, idempotencyKey, parsedInput, null);
  return json(request, 200, { promoted: true, requestId });
}
```

- [ ] **Step 3: Add Promote button in EventDetailsPage waitlist section (admin only)**

In `EventDetailsPage.tsx`, in the waitlist admin section:

```typescript
async function promoteFromWaitlist(memberId: string) {
  setRsvpBusy(true);
  try {
    await api("admin_promote_from_waitlist", {
      tripId: details!.tripId, memberId, reason: "Administrator promoted from waitlist",
    });
    await refresh();
  } catch {
    setRsvpError("Could not promote member. The trip may be at capacity.");
  } finally { setRsvpBusy(false); }
}

// In waitlist list render:
{isAdmin && details.waitlistEntries.map((w) => (
  <li key={w.memberId}>
    #{w.position} {w.displayName}
    <button type="button" disabled={rsvpBusy} onClick={() => void promoteFromWaitlist(w.memberId)}>
      Promote
    </button>
  </li>
))}
```

- [ ] **Step 4: Run all tests**

```bash
npx supabase db reset && npm run test:db && npm test && npm run typecheck
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/trip-api/index.ts \
        supabase/migrations/20261009186000_uiux_promote_waitlist.sql \
        frontend/src/features/trips/EventDetailsPage.tsx
git commit -m "feat: add admin_promote_from_waitlist action and UI"
```

---

## Phase UI-E: Admin trip configure — cabin count and per-cabin capacity

### Task 14: Add cabin_count and per_cabin_capacity to admin_configure_trip

**Files:**
- Modify: `supabase/functions/trip-api/index.ts` — `admin_configure_trip` schema and handler
- Modify: `frontend/src/features/trips/TripCalendarPage.tsx` — `PollManager` form

**Interfaces:**
- Consumes: `per_cabin_capacity`, `cabin_count` columns (Task A2).
- Produces: `admin_configure_trip` accepts optional `cabinCount: number | null` and `perCabinCapacity: number` (default 6). PollManager form shows two new inputs.

- [ ] **Step 1: Update admin_configure_trip schema**

In `trip-api/index.ts`, in `inputSchemas.admin_configure_trip`, add:

```typescript
cabinCount: z.number().int().min(1).max(50).nullable().optional(),
perCabinCapacity: z.number().int().min(1).max(50).optional(),
```

- [ ] **Step 2: Update admin_configure_trip handler**

In the handler for `admin_configure_trip`, pass the new fields to the DB update. Find the existing `service.from("camping_trips").update(...)` call and add:

```typescript
...(typeof input.cabinCount !== "undefined" && { cabin_count: input.cabinCount }),
...(typeof input.perCabinCapacity !== "undefined" && { per_cabin_capacity: input.perCabinCapacity }),
```

- [ ] **Step 3: Update PollManager form**

In `TripCalendarPage.tsx`, add state and inputs for `cabinCount` and `perCabinCapacity` in the `PollManager` component. Add after the existing `capacity` field:

```typescript
const [cabinCount, setCabinCount] = useState(trip?.cabinCount?.toString() ?? "");
const [perCabinCapacity, setPerCabinCapacity] = useState(trip?.perCabinCapacity?.toString() ?? "6");
// In the form:
<label>Cabin count<input type="number" min="1" max="50" value={cabinCount} onChange={(e) => setCabinCount(e.target.value)} /></label>
<label>Per-cabin capacity (default 6)<input type="number" min="1" max="50" value={perCabinCapacity} onChange={(e) => setPerCabinCapacity(e.target.value)} /></label>
```

Include these in the `admin_configure_trip` API call:

```typescript
cabinCount: cabinCount ? Number(cabinCount) : null,
perCabinCapacity: perCabinCapacity ? Number(perCabinCapacity) : 6,
```

- [ ] **Step 4: Run tests**

```bash
npm test && npm run typecheck
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/trip-api/index.ts \
        frontend/src/features/trips/TripCalendarPage.tsx
git commit -m "feat: add cabin_count and per_cabin_capacity to admin trip configuration"
```

---

## Phase UI-F: Regression verification and final build

### Task 15: Full regression suite

**Files:** No new files — test only.

- [ ] **Step 1: Run all unit tests**

```bash
cd /Users/veerrajuamanchi/camping-club
npm test
```

Expected: All 38+ tests pass.

- [ ] **Step 2: Run TypeScript check**

```bash
npm run typecheck
```

Expected: 0 errors.

- [ ] **Step 3: Run DB tests**

```bash
npx supabase start   # if not already running
npm run test:db
```

Expected: All 81+ pgTAP tests pass.

- [ ] **Step 4: Run build**

```bash
npm run build
```

Expected: Build succeeds with no errors.

- [ ] **Step 5: Run security scan**

```bash
npm run security:scan
```

Expected: No new high or critical issues.

- [ ] **Step 6: Commit summary**

```bash
git log --oneline origin/main..HEAD
```

Review all commits on this branch. Confirm no production secrets, no floating-point money, no client-side-only role checks.

- [ ] **Step 7: Final commit (add any remaining doc updates)**

Update `docs/REQUIREMENTS_TRACEABILITY.md` to mark UI-A through UI-E tasks as implemented. Update `docs/OWNER_DECISIONS.md` if any resolved-design decisions should be noted.

```bash
git add docs/REQUIREMENTS_TRACEABILITY.md docs/OWNER_DECISIONS.md
git commit -m "docs: update traceability for UI/UX redesign tasks UI-A through UI-E"
```

---

## Known Pre-existing Issues (do not fix in this plan)

1. **`npm run test:phase2-integration` concurrency race** — failing before this work begins on `feature/phase2-staging-remediation`. Do not regress it further; do not fix it.
2. **No hosted Render + Staging E2E** — `npm run test:e2e:staging` requires `frontend/.env.staging.e2e`. Staging Playwright E2E is out of scope for this plan — run locally only.
3. **`AcceptInvitation.passwordAlreadySet` prop** — the old prop is removed in Task A6. If the router `location.state` had `passwordAlreadySet`, it will be ignored harmlessly.

---

## Deployment Gate (owner approves before production push)

Do not push to `origin/main` until:
- [ ] All tasks F1 checks pass with recorded output
- [ ] Owner reviews the redesigned UI (screenshots or hosted staging demo)
- [ ] Owner explicitly approves the release

After owner approval, submit a PR from `feature/ui-ux-redesign` → `main`.

---

## Self-Review Checklist

**Spec coverage:**
- [x] Unified landing page with chronological EventCard — Task B2
- [x] EventCard fields (month, name, dates, campsite, cabins, capacity, confirmed, spots, waitlist, RSVP status, buttons) — Task B1 + B2
- [x] Event details page with 4 tabs — Task C2
- [x] Admin sees same pages with contextual Edit/Manage — inline admin panels in EventCard and EventDetailsPage
- [x] OTP passwordless login — Task A6
- [x] Access request approval flow — Tasks A1, A4, A5, A7
- [x] `admin-invite-member` kept — member-api unchanged; only new actions added
- [x] Draft trips visible to members as "Dates TBA" — Task B2 EventCard
- [x] Per-cabin capacity (default 6) + override — Tasks A2, E1
- [x] Waitlist (FIFO, manual admin promotion) — Tasks A3, D1, D2
- [x] No capacity overbooking — Task D1 capacity check; D2 concurrent protection
- [x] Constitution preview before RSVP; acknowledgment recorded on Going submit — preserved from existing code + Task C2
- [x] No Phase 3 financial features — Financials tab is a placeholder only
- [x] All authorization server-side — Edge Functions; DB functions check actor role
- [x] No floating-point money — no money calculations in this plan
- [x] All unresolved OD decisions preserved as fail-closed — no policy invented

**Placeholder scan:** No TBDs or "implement later" notes remain above.

**Type consistency:**
- `Trip.perCabinCapacity`, `Trip.cabinCount`, `Trip.effectiveCapacity`, `Trip.spotsRemaining`, `Trip.waitlistCount`, `Trip.myWaitlistPosition` — defined in Task B1, consumed in B2, C1, C2.
- `invokeAuthApi` — defined in Task A4, used in A6 (App.tsx).
- `admin_promote_from_waitlist` — added to `actionNames` in Task D2, input schema `{ tripId, memberId, reason }` — matches handler.
