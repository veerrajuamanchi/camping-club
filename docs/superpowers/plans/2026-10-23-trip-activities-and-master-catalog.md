# Trip Activities, Vehicle Pairings & Master Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the complete signature activity coordination system featuring a Master Activity Catalog, multi-activity trip scheduling, upfront readiness scorecard opt-in/opt-out, vehicle group pairings with personalized rider badges (`✓ You are Riding with <Name>`), voucher tracking with automatic dynamic ledger posting, tour operator call sheets, and mutual partner swaps with partner protection.

**Architecture:** A durable PostgreSQL schema with Row Level Security and trusted RPCs handles activities, pairings, vouchers, and swap requests. `trip-api` exposes validated endpoints with credential masking for non-assigned campers. The React frontend introduces a Master Activity Catalog tab under `/admin/catalogs`, a 5th standard requirement in the Trip Hub readiness scorecard, and a full-featured `TripActivitiesTab`.

**Tech Stack:** React 19, TypeScript, Vite, Supabase PostgreSQL, Supabase Edge Functions (Deno), Vitest, pgTAP, Playwright.

**Spec:** [`docs/superpowers/specs/2026-10-23-trip-activities-and-master-catalog-design.md`](file:///Users/veerrajuamanchi/IdeaProjects/amanchi-labs/camping-club/docs/superpowers/specs/2026-10-23-trip-activities-and-master-catalog-design.md)

## Global Constraints

- Use integer cents (`amount_cents`) for all monetary values; no floating-point financial arithmetic.
- Strict Supabase Row Level Security with default-deny policies.
- Voucher codes and security PINs must only be visible in plain text to assigned vehicle riders and administrators; masked for others.
- All FK columns indexed with `ON DELETE CASCADE` or `RESTRICT` on financial/member records.
- Playwright multi-browser acceptance tests (`workers: 1`) must pass across Desktop Chromium, iPhone Mobile WebKit, and Android Mobile Chromium with reload persistence.
- Zero horizontal scroll overflow on mobile viewports (`scrollWidth <= innerWidth`).

## Review Focus

1. **Purchased Voucher Partner Protection:** A camper attempting to opt out after their car partner entered a purchased voucher must be blocked under `locked_on_voucher` policy with a clear warning explaining their financial commitment.
2. **Dynamic Ledger Split Synchronization:** Entering a voucher cost (e.g. $174.60) must automatically post a `trip_expenses` record that dynamically splits across confirmed attendees who have opted in, excluding opted-out campers.
3. **Partner Swap Atomicity & Voucher Lock:** Two campers executing a mutual partner swap must exchange vehicle memberships in a single transaction; swaps must be rejected if either vehicle has already purchased a voucher.
4. **Credential Masking:** An authenticated member querying trip activities who is NOT in Car #1 must receive `null` or `***` for Car #1's voucher code and security PIN, while seeing the pairing and status.
5. **Scorecard Progress Integrity:** When a trip has scheduled activities, completing the activity participation prompt brings the readiness scorecard to 5 of 5 (100%).

---

### Task 1: Database Migration for Master Catalog & Trip Activities Schema

**Files:**
- Create: `supabase/migrations/20261024000000_trip_activities_and_master_catalog.sql`
- Test: `supabase/tests/phase19_trip_activities_and_master_catalog.sql`

**Interfaces:**
- Produces: Tables `master_activities`, `trip_activities`, `trip_activity_participants`, `trip_activity_groups`, `trip_activity_group_members`, `trip_activity_swap_requests` with indexes and RLS.

- [ ] **Step 1: Write the failing pgTAP test**

Create `supabase/tests/phase19_trip_activities_and_master_catalog.sql` testing table existence, column types, foreign keys, and RLS default-deny behavior for anonymous users.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:db`  
Expected: FAIL (tables `master_activities` and `trip_activities` do not exist).

- [ ] **Step 3: Implement migration `20261024000000_trip_activities_and_master_catalog.sql`**

Create the 6 tables defined in Section 5.1 of the design spec with RLS enabled:
- `master_activities` (id, title, category, image_url, location_name, address, directions_url, unit_label, unit_capacity, booking_notes, is_active).
- `trip_activities` (trip_id, master_activity_id, title, category, image_url, activity_date, start_time, end_time, location_name, address, directions_url, unit_label, unit_capacity, booking_notes, opt_out_policy, is_pairings_locked).
- `trip_activity_participants` (activity_id, member_id, status CHECK ('attending', 'opted_out'), notes).
- `trip_activity_groups` (activity_id, group_number, group_name, purchaser_member_id, purchase_date, amount_cents, expense_id, order_reference_number, voucher_code, security_pin, voucher_status CHECK ('pending', 'purchased', 'verified')).
- `trip_activity_group_members` (group_id, member_id).
- `trip_activity_swap_requests` (activity_id, requester_member_id, target_member_id, status CHECK ('pending', 'accepted', 'declined', 'cancelled')).
- Indexes on all foreign key columns.
- RLS read policies for authenticated club members on activities and public pairings; write policies restricted to admins or assigned group members.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:db`  
Expected: PASS (all tests pass).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261024000000_trip_activities_and_master_catalog.sql supabase/tests/phase19_trip_activities_and_master_catalog.sql
git commit -m "feat(activities): database schema and RLS for master catalog, trip activities, and vehicle pairings"
```

---

### Task 2: Database RPC Functions & Dynamic Ledger Integration

**Files:**
- Modify: `supabase/migrations/20261024000000_trip_activities_and_master_catalog.sql`
- Test: `supabase/tests/phase19_trip_activities_and_master_catalog.sql`

**Interfaces:**
- Produces:
  - `public.phase6_manage_master_activity(p_action TEXT, p_id UUID, p_payload JSONB, p_actor_id UUID)`
  - `public.phase6_manage_trip_activity(p_action TEXT, p_trip_id UUID, p_activity_id UUID, p_payload JSONB, p_actor_id UUID)`
  - `public.phase6_set_activity_participation(p_activity_id UUID, p_member_id UUID, p_status TEXT, p_actor_id UUID)`
  - `public.phase6_manage_activity_pairings(p_activity_id UUID, p_action TEXT, p_payload JSONB, p_actor_id UUID)`
  - `public.phase6_submit_voucher(p_group_id UUID, p_purchaser_member_id UUID, p_purchase_date DATE, p_amount_cents INTEGER, p_order_ref TEXT, p_voucher_code TEXT, p_security_pin TEXT, p_actor_id UUID)`
  - `public.phase6_request_partner_swap(p_activity_id UUID, p_requester_id UUID, p_target_id UUID)`
  - `public.phase6_respond_partner_swap(p_request_id UUID, p_action TEXT, p_actor_id UUID)`

- [ ] **Step 1: Write failing pgTAP tests for activity RPCs**

Extend `supabase/tests/phase19_trip_activities_and_master_catalog.sql` to test:
- Admin creating master activity and cloning to a trip.
- Member setting participation to `attending` vs `opted_out`.
- Blocking opt-out when `opt_out_policy = 'locked_on_voucher'` and voucher is already purchased.
- Purchaser submitting voucher with `amount_cents` automatically creating a linked record in `public.trip_expenses`.
- Partner swap request and atomic acceptance exchanging group members.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:db`  
Expected: FAIL (RPC functions not found).

- [ ] **Step 3: Implement RPC functions in migration**

Write PL/pgSQL functions:
- `phase6_manage_master_activity`: create/update/delete master catalog items.
- `phase6_manage_trip_activity`: create/update/delete trip activities, clone from master catalog, auto-initialize groups matching `unit_capacity`.
- `phase6_set_activity_participation`: validates `opt_out_policy` (rejects opt-out if locked on voucher unless admin), upserts `trip_activity_participants`.
- `phase6_submit_voucher`: updates group voucher details; if `p_amount_cents > 0`, invokes `phase5_manage_expense` to create/update a `trip_expenses` record paid by `p_purchaser_member_id` with `split_mode = 'all_attendees'` dynamically covering opted-in attendees. Links `expense_id` back to `trip_activity_groups`.
- `phase6_request_partner_swap`: validates neither vehicle has a purchased voucher, inserts pending swap request.
- `phase6_respond_partner_swap`: validates target actor, atomically swaps the two members in `trip_activity_group_members`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:db`  
Expected: PASS (all tests pass).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261024000000_trip_activities_and_master_catalog.sql supabase/tests/phase19_trip_activities_and_master_catalog.sql
git commit -m "feat(activities): transactional RPCs for activities, dynamic voucher expense posting, and partner swaps"
```

---

### Task 3: Edge Functions (`trip-api` & `member-api`) API Endpoints & Schemas

**Files:**
- Modify: `supabase/functions/trip-api/index.ts`
- Modify: `supabase/functions/member-api/index.ts`
- Test: `supabase/functions/trip-api/activities.test.mjs`

**Interfaces:**
- Consumes: RPCs from Task 2.
- Produces: API actions `get_trip_activities`, `admin_manage_master_activity`, `admin_manage_trip_activity`, `set_activity_participation`, `admin_manage_activity_pairings`, `submit_activity_voucher`, `request_partner_swap`, `respond_partner_swap`.

- [ ] **Step 1: Write failing Node test for API endpoints**

Create `supabase/functions/trip-api/activities.test.mjs` verifying input schema validation, action dispatch, and voucher credential masking (Voucher Code and PIN masked with `***` unless caller is assigned rider or admin).

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test supabase/functions/trip-api/activities.test.mjs`  
Expected: FAIL (actions not supported).

- [ ] **Step 3: Implement handlers in `trip-api/index.ts` and `member-api/index.ts`**

- Add Zod input schemas for each activity action.
- Implement `get_trip_activities(tripId, memberId)`: retrieves trip activities, participants, groups, and assigned members. Masks `voucher_code` and `security_pin` to `null` if caller is not assigned to the group and not an admin.
- Route actions to corresponding `phase6_*` database functions.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test supabase/functions/trip-api/activities.test.mjs`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/trip-api/ supabase/functions/member-api/
git commit -m "feat(api): activity management, voucher submission, and masked credential endpoints"
```

---

### Task 4: Master Activity Catalog UI (`MasterActivitiesTab.tsx`)

**Files:**
- Create: `frontend/src/features/admin/MasterActivitiesTab.tsx`
- Modify: `frontend/src/features/admin/MasterCatalogPage.tsx`
- Test: `frontend/src/features/admin/MasterActivitiesTab.test.tsx`

**Interfaces:**
- Consumes: `admin_manage_master_activity` API.
- Produces: Master activity management tab with create/edit/delete modal and capacity selectors.

- [ ] **Step 1: Write failing unit test**

Create `frontend/src/features/admin/MasterActivitiesTab.test.tsx` testing rendering of master activities, opening "+ Add Activity Template" modal, filling fields (title, image URL, address, capacity), and submitting to API.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix frontend test -- src/features/admin/MasterActivitiesTab.test.tsx --run`  
Expected: FAIL.

- [ ] **Step 3: Implement `MasterActivitiesTab.tsx` and integrate into `MasterCatalogPage.tsx`**

- Add **🎯 Activities** tab to `MasterCatalogPage.tsx` next to Responsibilities and Packing Items.
- Render cards with activity photo, address, unit capacity badge (e.g. 2 per GoCar, 1 per ATV), and edit/delete actions.
- Add Add/Edit modal with image URL preview, category select, address, directions link, and capacity options.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix frontend test -- src/features/admin/MasterActivitiesTab.test.tsx --run`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/admin/
git commit -m "feat(admin): master activity catalog UI for reusable event templates"
```

---

### Task 5: Trip Readiness Scorecard Integration (5th Required Item)

**Files:**
- Modify: `frontend/src/features/trips/EventDetailsPage.tsx`
- Modify: `frontend/src/features/trips/EventDetailsPage.test.tsx`

**Interfaces:**
- Consumes: `get_trip_activities`, `set_activity_participation`.
- Produces: Updated 5-item scorecard (`⚡ Required From You (X of 5 Completed)`) with prompt to choose `[Count Me In! 🚗]` or `[Opt Out 🏕️]`.

- [ ] **Step 1: Write failing unit test**

Add test case in `EventDetailsPage.test.tsx`:
- Verifies scorecard displays 5 items when an activity is scheduled.
- Clicking `Count Me In!` calls `set_activity_participation` with `status: 'attending'` and updates score from 4 of 5 to 5 of 5 (100%).
- Clicking `Opt Out` calls `status: 'opted_out'` and also marks item as complete.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix frontend test -- src/features/trips/EventDetailsPage.test.tsx --run`  
Expected: FAIL.

- [ ] **Step 3: Update `EventDetailsPage.tsx`**

- Fetch trip activities alongside event data.
- Add Item #5 to `RequiredFromYou` checklist:
  - If member has answered (`attending` or `opted_out`), display green checkmark with status (`✓ Participating in Monterey GoCar` or `✓ Opted Out (Relaxing at Camp)`).
  - If unanswered, display action card with buttons `[✓ Count Me In! (Ride 🚗)]` and `[Opt Out (Stay at Camp 🏕️)]`.
- Update gauge calculation to evaluate 5 items.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix frontend test -- src/features/trips/EventDetailsPage.test.tsx --run`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/trips/EventDetailsPage.tsx frontend/src/features/trips/EventDetailsPage.test.tsx
git commit -m "feat(trips): 5-item readiness scorecard with upfront activity opt-in/opt-out choice"
```

---

### Task 6: Trip Activity Hub & Pairings UI (`TripActivitiesTab.tsx`)

**Files:**
- Create: `frontend/src/features/trips/TripActivitiesTab.tsx`
- Create: `frontend/src/features/trips/TripActivitiesTab.test.tsx`
- Modify: `frontend/src/features/trips/EventDetailsPage.tsx` (add "🎯 Activities" tab)

**Interfaces:**
- Consumes: Activity endpoints from Task 3.
- Produces: Complete activity timeline, personalized badges (`✓ You are Riding with <Name>`), voucher modal, operator call sheet table, and partner swap modal.

- [ ] **Step 1: Write failing unit test**

Create `frontend/src/features/trips/TripActivitiesTab.test.tsx` testing:
- Renders activity banner image, address, schedule, and Groupon deal tip.
- Displays personalized badge: `✓ You are Riding with Veerraju Amanchi (Car #1)`.
- Opens "+ Enter Voucher Details" modal, submits voucher codes, and updates status to `✓ READY`.
- Opens "Tour Operator Call Sheet" modal with formatted table and copy button.
- Displays incoming partner swap banner with Accept and Decline buttons.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix frontend test -- src/features/trips/TripActivitiesTab.test.tsx --run`  
Expected: FAIL.

- [ ] **Step 3: Implement `TripActivitiesTab.tsx`**

- Activity Card list with hero photo banner, schedule strip, directions link, and deal strategy banner.
- Group pairing cards with vehicle numbers, attendee names, and voucher status.
- Participant voucher entry modal (Purchase Date, Purchaser, Amount Paid, Order #, Voucher Code, Security PIN).
- Tour Operator Call Sheet view with aggregated table and `📋 Copy All to Clipboard`.
- Partner Swap Request modal & recipient approval banner.
- Admin controls: `+ Add Activity` (with clone from master catalog), `🎲 Auto-Shuffle`, `👥 Manage Pairings`, and `🔒 Lock Pairings`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix frontend test -- src/features/trips/TripActivitiesTab.test.tsx --run`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/trips/TripActivitiesTab.tsx frontend/src/features/trips/TripActivitiesTab.test.tsx frontend/src/features/trips/EventDetailsPage.tsx
git commit -m "feat(trips): trip activities tab with vehicle pairings, voucher entry, call sheet, and partner swaps"
```

---

### Task 7: Multi-Browser E2E Browser Acceptance Gate (Playwright)

**Files:**
- Create: `e2e/trip-activities.spec.ts`

**Interfaces:**
- Verifies: Complete vertical slice across Desktop Chromium, iPhone Mobile WebKit, and Android Mobile Chromium with `workers: 1`.

- [ ] **Step 1: Write Playwright E2E test `e2e/trip-activities.spec.ts`**

Implement automated browser flow:
1. Admin navigates to `/admin/catalogs`, opens Activities tab, and creates a master activity "Monterey GoCar Full-Day Tour" (capacity: 2, image URL, address).
2. Admin opens Trip Hub, creates a trip, and clones the GoCar activity into Saturday.
3. Member logs in, views 5-item readiness scorecard, clicks `Count Me In!`, and verifies scorecard updates to 5 of 5.
4. Member opens Activities tab, sees assigned vehicle and partner badge: `✓ You are Riding with <Admin>`.
5. Member clicks `🎟️ Enter Voucher Details`, enters Purchase Date, Order #, Voucher Code `GP-102948-A`, PIN `4819`, and Amount `$174.60`.
6. Reloads page (`page.reload()`) and verifies voucher status remains `✓ READY` and persists from PostgreSQL.
7. Checks Settlement & Expenses tab to verify that the $174.60 voucher was automatically posted as a shared expense and split dynamically across attending campers.
8. Admin views Tour Operator Call Sheet and verifies all 4 fields display correctly.
9. Asserts no horizontal overflow (`scrollWidth <= innerWidth`) across Desktop Chromium, iPhone Mobile WebKit, and Android Mobile Chromium.

- [ ] **Step 2: Run Playwright acceptance test suite**

Run: `node scripts/run-e2e.mjs e2e/trip-activities.spec.ts`  
Expected: PASS across all 3 viewports.

- [ ] **Step 3: Run full verification suite**

Run: `npm run verify`  
Expected: PASS (typecheck, tests, database pgTAP, integration, build, security scan).

- [ ] **Step 4: Commit**

```bash
git add e2e/trip-activities.spec.ts
git commit -m "test(e2e): multi-browser acceptance suite for master activities, trip pairings, and voucher reload persistence"
```
