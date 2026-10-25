# Camping Club — Architecture

> This document describes the system architecture as implemented. For product scope see `PRODUCT_VISION.md`; for database schema see `DATABASE_SCHEMA.md`; for security rules see `SECURITY_ARCHITECTURE.md`.

---

## 1. Technology Stack

| Layer | Technology | Hosting |
|---|---|---|
| Frontend SPA | React 18 + TypeScript + Vite | Render Static Site |
| Authentication | Supabase Auth (OTP magic-link) | Supabase (managed) |
| Database | PostgreSQL via Supabase | Supabase (managed) |
| Row-Level Security | Supabase RLS + SECURITY INVOKER views | Supabase |
| Server-side logic | Supabase Edge Functions (Deno / TypeScript) | Supabase (managed) |
| Scheduled jobs | Supabase pg_cron | Supabase (managed) |
| Settlement engine | Pure deterministic TypeScript package (`src/domain/settlementEngine.ts`) | Bundled in frontend + Edge Functions |
| Optional data import | Python utility (local only; reviewed before import) | Developer machine only |

---

## 2. Deployment Topology

```
┌──────────────────────────────────┐      ┌─────────────────────────────────────────────────┐
│        User's Browser            │      │                  Supabase Project                │
│                                  │      │                                                  │
│  React + Vite SPA                │      │  ┌────────────────┐   ┌──────────────────────┐  │
│  (served from Render Static CDN) │─────▶│  │  Supabase Auth │   │  Edge Functions      │  │
│                                  │      │  │  (OTP/magic)   │   │  trip-api            │  │
│  - No secrets in bundle          │      │  └───────┬────────┘   │  member-api          │  │
│  - VITE_SUPABASE_URL             │      │          │            │  auth-api            │  │
│  - VITE_SUPABASE_ANON_KEY        │      │          │            │  bootstrap-admin     │  │
└──────────────────────────────────┘      │  ┌───────▼────────────▼──────────────────────┐  │
                                          │  │              PostgreSQL                    │  │
                                          │  │  schema: public   (RLS enforced)           │  │
                                          │  │  schema: private  (no anon grant)          │  │
                                          │  │  pg_cron jobs (deadline, settlement)       │  │
                                          │  └───────────────────────────────────────────┘  │
                                          └─────────────────────────────────────────────────┘
```

**Render filesystem is ephemeral** — all persistent production records live in Supabase.

---

## 3. Edge Functions

All privileged server-side operations are handled by Supabase Edge Functions (Deno runtime, TypeScript). The browser **never** calls the Postgres Data API directly for write operations on financial or lifecycle tables.

| Function | Responsibility |
|---|---|
| `trip-api` | Trip RSVP, waitlist, event config, financials, settlement, activities, pairings, vouchers, waivers, tasks & meals, commitments, carpool |
| `member-api` | Member profile, invitation, role management, access requests, membership update |
| `auth-api` | Access check (approve/pending/new), OTP flow orchestration |
| `bootstrap-admin` | One-time first-admin setup |

All functions:
- Resolve the calling user via `auth.uid()` server-side.
- Verify active membership and role server-side before acting.
- Use integer cents for all monetary values — no floating-point arithmetic.
- Apply idempotency keys on financial mutations where appropriate.

---

## 4. Database Schema Organization

| Schema | Access | Purpose |
|---|---|---|
| `public` | Exposed via Data API with explicit grants + RLS | Trip calendar, RSVPs, members, commitments, duties, activities, pairings, settlement |
| `private` | No anon/authenticated grant; accessible only from SECURITY DEFINER functions | Payment identifiers, encrypted receipt metadata |

### Key table families (see `DATABASE_SCHEMA.md` for full schema)

- **Members & Auth**: `members`, `membership_audit_log`, `access_requests`
- **Trip Lifecycle**: `trips`, `trip_configurations`, `rsvp_responses`, `rsvp_acknowledgments`
- **Cabin & Deposit**: `cabin_reservations`, `deposit_records`
- **Finances**: `trip_expenses`, `expense_allocations`, `settlement_runs`, `settlement_transfers`, `contribution_receipts`
- **Tasks & Meals**: `trip_time_slots`, `slot_duties`, `duty_assignments`, `meal_preferences`
- **Activities**: `trip_activities`, `activity_participants`, `activity_groups`, `master_activities`
- **Logistics**: `trip_carpools`, `carpool_riders`, `trip_commitments`
- **Catalog**: `master_gear`, `master_food`, `master_responsibilities`
- **Constitution**: `rule_definitions`, `rule_bundles`, `bundle_rules`, `rsvp_rule_acknowledgments`
- **Campsites**: `campsites`, `campsite_rotation`
- **Scheduling**: `club_configuration`

---

## 5. Security Model

- **Default-deny**: All public tables have RLS enabled. Anonymous access is denied unless explicitly permitted.
- **Role resolution**: Roles (`admin`, `member`, `accountant`) are resolved server-side from the JWT + database record, never from client-provided data.
- **Financial writes**: All financial and lifecycle mutations go through Edge Functions. Direct browser writes to financial tables are denied by RLS.
- **Immutable facts**: Payment events and settlement runs are append-only. Corrections append a new versioned record.
- **SECURITY DEFINER**: Used only where necessary for RLS helper functions; placed in the `private` schema with `search_path` fixed and PUBLIC execute revoked.
- **UPDATE policies**: All tables with UPDATE access use both `USING` and `WITH CHECK` clauses.
- **FK indexes**: All foreign key columns are indexed.

See `SECURITY_ARCHITECTURE.md` for the full threat model and control inventory.

---

## 6. Authentication & Access Flow

```
1. User visits app  →  SPA loads (no auth required to render shell)
2. User enters email  →  auth-api.check_access validates membership
3. Supabase sends OTP magic-link email
4. User enters OTP  →  supabase.auth.verifyOtp() → session JWT issued
5. AuthProvider reads JWT + calls member-api to resolve profile + role
6. AppRoutes gates routes by role (admin / member / accountant)
7. New user with no account  →  /accept-invitation  →  MemberProfileForm
```

**Roles:**

| Role | Capabilities |
|---|---|
| `member` | RSVP, view trips, logistics, tasks, activities, submit deposits, enter vouchers, sign waivers |
| `accountant` | All member capabilities + verify deposits, view full financial tab, confirm settlement transfers |
| `admin` | All capabilities + full admin panel, trip configuration, roster management, settlement finalization |

---

## 7. Data Flow — Typical Request

```
Browser (React)
    │  invokeTripApi("submit_rsvp", { tripId, response, bundleId })
    ▼
Supabase Edge Function: trip-api
    │  1. Verify JWT → auth.uid()
    │  2. Resolve active membership + role
    │  3. Run business logic (state machine checks)
    │  4. Call PostgreSQL RPC (SECURITY INVOKER)
    │  5. Append audit event
    ▼
PostgreSQL
    │  RPC validates constraints (optimistic version, idempotency)
    │  Writes to rsvp_responses + rsvp_rule_acknowledgments
    ▼
Edge Function returns { success, waitlisted?, position? }
    ▼
Browser updates local state + re-fetches trip details
```

---

## 8. Settlement Engine

The settlement engine is a **pure deterministic TypeScript package** (`src/domain/settlementEngine.ts`):

- Accepts normalized expense allocations (all in integer cents).
- Asserts: each allocation sums to its expense total; aggregate net balances sum to zero.
- Runs an exact dynamic-programming solver (bounded by the limit in `SETTLEMENT_ENGINE_SPEC.md`); falls back to greedy if limit exceeded.
- Produces a minimal transfer list to clear all balances.
- Outputs are hashed with the input for immutable audit trails.
- **Finalization is admin-only** and server-side. The frontend uses the same package for live preview only.

See `SETTLEMENT_ENGINE_SPEC.md` and `FINANCIAL_WORKED_EXAMPLES.md` for exact algorithm and worked examples.

---

## 9. Scheduling & Operational Jobs

Supabase pg_cron handles:
- **Registration deadline check**: Scans trips approaching cutoff; cancels below-minimum trips; sends notices.
- **Duty / task heartbeat**: Ensures meal and chore slots stay current.

All cron jobs are:
- **Idempotent** — safe to re-run.
- **Independent of website traffic** — no web request needed to trigger.
- **Monitored externally** — a Supabase-external heartbeat monitor is required per `OPERATIONS_AND_RECOVERY.md`.

**Manual fallbacks** exist for cabin cancellation deadlines during the Free pilot phase.

---

## 10. Key Subsystems Summary

| Subsystem | Entry point | Key tables |
|---|---|---|
| Member identity & invitations | `member-api` | `members`, `access_requests` |
| Trip lifecycle & RSVP | `trip-api` (rsvp actions) | `trips`, `rsvp_responses`, `rsvp_rule_acknowledgments` |
| Cabin reservation & deposits | `trip-api` (deposit actions) | `cabin_reservations`, `deposit_records` |
| Waitlist | `trip-api` (waitlist actions) | `waitlist_entries` |
| Constitution & rules ack | `trip-api` (constitution actions) | `rule_bundles`, `rsvp_rule_acknowledgments` |
| Activities, pairings & waivers | `trip-api` (activity actions) | `trip_activities`, `activity_participants`, `activity_groups` |
| Voucher tracking | `trip-api` (voucher actions) | `activity_participants` (voucher columns) |
| Waiver tracking | `trip-api` (waiver actions) | `activity_participants` (`waiver_clicked_at`, `waiver_signed_at`) |
| Tasks, meals & duties | `trip-api` (duty/meal actions) | `trip_time_slots`, `slot_duties`, `duty_assignments`, `meal_preferences` |
| Carpool & logistics | `trip-api` (carpool/commitment actions) | `trip_carpools`, `carpool_riders`, `trip_commitments` |
| Expenses & settlement | `trip-api` (financial actions) | `trip_expenses`, `settlement_runs`, `settlement_transfers` |
| Master catalogs | `trip-api` (catalog actions) | `master_gear`, `master_food`, `master_responsibilities`, `master_activities` |
| Campsite directory | `trip-api` (campsite actions) | `campsites`, `campsite_rotation` |

---

## 11. Frontend Architecture

```
frontend/src/
├── app/
│   ├── App.tsx               — BrowserRouter shell
│   ├── AppRoutes.tsx         — Route definitions, header, role-gated nav
│   └── AuthProvider.tsx      — Auth context (session, membership, profile)
├── features/
│   ├── auth/                 — SignInPage, AcceptInvitation, AccessBoundary
│   ├── admin/                — Admin-only pages (Members, Campsites, Constitution, Catalogs, …)
│   ├── trips/                — TripCalendarPage, EventDetailsPage, tab components
│   └── members/              — MemberProfileForm
├── domain/
│   └── settlementEngine.ts   — Pure settlement calculation (no side effects)
└── lib/
    └── supabase.ts           — Supabase client, invokeTripApi, invokeMemberApi, invokeAuthApi
```

State management is local React state + server re-fetch after mutations (no global store). All API calls go through the typed `invoke*Api` helpers that attach the Supabase session JWT automatically.
