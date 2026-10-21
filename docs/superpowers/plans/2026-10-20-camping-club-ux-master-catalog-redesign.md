# Master Catalogs & Participant Experience Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the complete Admin Master Catalogs (Camping Gear with Individual/Shared filters, Food & Groceries, Responsibilities) with safe unlinking delete, and transform the participant trip view into a mobile-first "My Trip Hub" dashboard featuring high-contrast "Required Only" tasks (RSVP, $50 deposit toggle, 2× daily chores target with greying out) and voluntary "To-Do / Contributions" (shared gear, food volunteering, read-only personal packing checklist, and expense recording with full attendee names).

**Architecture:** 
- Supabase PostgreSQL durable tables (`master_gear`, `master_food_groceries`, `trip_commitments`, `trip_rsvps`), RPC boundary functions, and RLS policies default-denying client tampering.
- Backend Supabase Edge Function (`trip-api`) handling auto-seeding commitments on trip creation, deposit verification, and workload projections.
- React + TypeScript frontend with scoped design-system CSS in `frontend/src/styles.css` adhering to mobile-first vertical layout without horizontal overflow.

**Tech Stack:**
- PostgreSQL 15 (Supabase), Row Level Security (RLS), PL/pgSQL
- Supabase Edge Functions (Deno / TypeScript)
- React 19, TypeScript, Vite, React Router 7
- Vitest, Playwright (Desktop Chromium, iPhone WebKit, Android Chromium)

**Spec:** [docs/superpowers/specs/2026-10-20-camping-club-ux-master-catalog-redesign.md](file:///Users/veerrajuamanchi/IdeaProjects/amanchi-labs/camping-club/docs/superpowers/specs/2026-10-20-camping-club-ux-master-catalog-redesign.md)

---

## Global Constraints

- Use integer cents for every monetary value (`amount_cents`, `deposit_amount_cents`); zero floating-point arithmetic.
- Authenticate and authorize every privileged action server-side (`member_role IN ('admin', 'administrator')` and `account_status = 'active'`).
- Preserve historical trip data: `master_gear` and `master_food_groceries` link to `trip_commitments` with `ON DELETE SET NULL`; `master_responsibilities` deletes permanently if unused, or soft-retires (`active = FALSE`) if historically referenced.
- Attending cabin reservation payer (`camping_trips.cabin_payer_member_id`) is automatically deposit-exempt (never request self-payment).
- When a participant RSVPs "Going", rule acceptance is recorded automatically with content hash in `trip_rule_acknowledgments` without requiring separate signing steps.
- UI components must live in `frontend/src/` using `frontend/src/styles.css`; no Tailwind or unapproved dependencies.
- Mandatory Playwright browser acceptance (`npm run test:e2e`) passing across Desktop Chromium, iPhone Mobile WebKit, and Android Mobile Chromium with `workers: 1` and `page.reload()` persistence checks.

---

## Review Focus

1. **Master Catalog Deletion with Historical Trips**: Deleting a master gear item or grocery item must never cascade-delete or corrupt commitments in past completed trips.
   *Test*: `tests/database/master_catalogs_delete.test.ts` asserts `trip_commitments` retains `item_name` and sets `master_gear_id` to `NULL`.
2. **Cabin Payer Deposit Exemption**: When an attendee is designated as the trip's cabin payer, their deposit status must automatically be `'exempt'` and no payment prompt should appear.
   *Test*: `tests/functions/trip_api_deposit.test.ts` asserts `deposit_status === 'exempt'` for the cabin payer.
3. **Daily Chores 2× Workload Greying Out**: When a volunteer selects chores totaling ≥ 2.0x for a given day, remaining unselected chores on that day must be greyed out and disabled, while selected chores remain uncheckable.
   *Test*: `frontend/src/features/trips/__tests__/DailyChoresSelection.test.tsx` asserts non-selected chore checkboxes receive `disabled` and container receives disabled styling.
4. **Expense Split Full Attendee Names on Mobile**: Ensure participant checkboxes in the expense modal always render full names in a single-column stacked layout rather than truncated grid chips.
   *Test*: `frontend/src/features/trips/__tests__/TripFinancialsSplit.test.tsx` asserts attendee names are visible in document with associated checkbox.
5. **Mobile Viewport Overflow**: No horizontal scroll on phone screens (`scrollWidth <= innerWidth`).
   *Test*: `e2e/mobile-usability.spec.ts` asserts no horizontal overflow on iPhone WebKit and Android viewports.

---

## Task Decomposition

### Task 1: Database Migration for Master Catalogs, Commitments, & Deposit Tracking

**Files:**
- Create: `supabase/migrations/20261020140000_master_catalogs_and_deposit_status.sql`
- Test: `scripts/test-phase2-integration.mjs` (or `node --test tests/database/master_catalogs.test.mjs`)

**Interfaces:**
- Produces: 
  - Tables: `public.master_gear`, `public.master_food_groceries`
  - Columns: `trip_commitments.master_gear_id`, `trip_commitments.master_food_id`, `trip_commitments.commitment_type`, `trip_commitments.is_active`
  - Columns: `trip_rsvps.deposit_status`, `trip_rsvps.deposit_submitted_at`, `trip_rsvps.deposit_confirmed_at`, `trip_rsvps.deposit_confirmed_by`
  - Columns: `camping_trips.rules_markdown`
  - RPCs:
    - `public.admin_manage_master_gear(...)`
    - `public.admin_manage_master_food(...)`
    - `public.admin_delete_master_responsibility(p_id UUID)`
    - `public.submit_member_deposit(p_trip_id UUID)`
    - `public.verify_member_deposit(p_trip_id UUID, p_member_id UUID, p_status TEXT)`
    - `public.seed_trip_commitments_from_master(p_trip_id UUID)`

- [ ] **Step 1: Write integration test verifying master catalogs and deposit RPC boundaries**
  Create `tests/database/master_catalogs.test.mjs` verifying:
  - Admin can insert, update, and delete in `master_gear` and `master_food_groceries`.
  - Non-admin is rejected with permission error.
  - `submit_member_deposit` updates `trip_rsvps.deposit_status` to `'submitted_by_member'`.
  - Attending cabin payer resolves to `'exempt'`.
  - Deleting a master gear item sets `trip_commitments.master_gear_id` to NULL without deleting the commitment row.
  - Deleting an unused master responsibility deletes the row; deleting a used one soft-retires (`active = FALSE`).

- [ ] **Step 2: Run test to verify it fails**
  Run: `node --test tests/database/master_catalogs.test.mjs`
  Expected: FAIL (tables/functions do not exist yet).

- [ ] **Step 3: Implement `supabase/migrations/20261020140000_master_catalogs_and_deposit_status.sql`**
  Write DDL:
  - `CREATE TABLE public.master_gear` (with check constraints on `gear_type`, `category`).
  - `CREATE TABLE public.master_food_groceries` (with check constraints on `category`).
  - `ALTER TABLE public.trip_commitments` (drop & re-add category check, add `master_gear_id`, `master_food_id`, `commitment_type`, `is_active`).
  - `ALTER TABLE public.trip_rsvps` (add `deposit_status`, `deposit_submitted_at`, `deposit_confirmed_at`, `deposit_confirmed_by`).
  - `ALTER TABLE public.camping_trips` (add `rules_markdown`).
  - Implement RPCs with strict admin checks and `ON DELETE SET NULL` safety.
  - Add RLS policies: SELECT for active members, mutations for admins.
  - Seed initial master gear and food items.

- [ ] **Step 4: Push migration locally and run test to verify it passes**
  Run: `npx supabase db reset && node --test tests/database/master_catalogs.test.mjs`
  Expected: PASS

- [ ] **Step 5: Commit**
  ```bash
  git add supabase/migrations/ tests/database/
  git commit -m "feat(db): add master catalogs, commitments extension, and deposit tracking"
  ```

---

### Task 2: Backend Edge Function Extensions (`trip-api`)

**Files:**
- Modify: `supabase/functions/trip-api/index.ts`
- Test: `tests/functions/trip_api_catalogs.test.mjs`

**Interfaces:**
- Consumes: Database RPCs from Task 1
- Produces: 
  - `get_trip_details`: returns `depositStatus`, `cabinPayerMemberId`, `rulesMarkdown`, `commitmentsList`
  - `get_master_catalogs`: returns `{ gear: MasterGearItem[], food: MasterFoodItem[], responsibilities: MasterResponsibilityItem[] }`
  - `submit_deposit`: attendee marks deposit submitted
  - `verify_deposit`: admin marks deposit confirmed
  - `manage_trip_commitments`: admin toggles `is_active` for items or adds trip-specific items

- [ ] **Step 1: Write integration test for trip-api catalog & deposit actions**
  Create `tests/functions/trip_api_catalogs.test.mjs` testing:
  - Calling `get_trip_details` returns `depositStatus` for current user.
  - Calling `submit_deposit` updates deposit status.
  - Calling `get_master_catalogs` returns categorized gear, food, and responsibilities.

- [ ] **Step 2: Run test to verify it fails**
  Run: `node --test tests/functions/trip_api_catalogs.test.mjs`
  Expected: FAIL

- [ ] **Step 3: Implement catalog & deposit endpoints in `supabase/functions/trip-api/index.ts`**
  - Add `get_master_catalogs`, `admin_manage_master_gear`, `admin_manage_master_food`, `admin_delete_master_responsibility` routing.
  - Extend `get_trip_details` payload to include `depositStatus`, `rulesMarkdown`, and commitments categorized into `individual_pack` vs `shared_volunteer`.
  - Add `submit_deposit` and `verify_deposit` actions calling underlying RPCs.
  - In `create_trip` or `admin_configure_trip`, invoke `seed_trip_commitments_from_master`.

- [ ] **Step 4: Run test to verify it passes**
  Run: `node --test tests/functions/trip_api_catalogs.test.mjs`
  Expected: PASS

- [ ] **Step 5: Commit**
  ```bash
  git add supabase/functions/trip-api/ tests/functions/
  git commit -m "feat(api): add master catalogs and deposit tracking endpoints to trip-api"
  ```

---

### Task 3: Frontend Master Catalog Management Page

**Files:**
- Create: `frontend/src/features/admin/MasterCatalogPage.tsx`
- Modify: `frontend/src/app/AppRoutes.tsx` (add `/admin/catalogs` route)
- Modify: `frontend/src/features/members/MemberProfilePage.tsx` (or admin navigation link)
- Test: `frontend/src/features/admin/MasterCatalogPage.test.tsx`

**Interfaces:**
- Consumes: `trip-api` actions `get_master_catalogs`, `admin_manage_master_gear`, `admin_manage_master_food`, `admin_delete_master_responsibility`
- Produces: Master Catalog UI with tabs for `[Camping Gear]`, `[Food & Groceries]`, and `[Responsibilities]`.

- [ ] **Step 1: Write unit test for MasterCatalogPage**
  Test in `frontend/src/features/admin/MasterCatalogPage.test.tsx`:
  - Renders tabs: Camping Gear, Food & Groceries, Responsibilities.
  - Under Camping Gear, clicking filter pills `[All]`, `[Individual]`, `[Shared]` filters visible items.
  - Typing in search filters item names in real-time.
  - Clicking `[🗑️ Delete]` opens confirmation modal and sends delete action.

- [ ] **Step 2: Run test to verify it fails**
  Run: `npm --prefix frontend test MasterCatalogPage`
  Expected: FAIL

- [ ] **Step 3: Implement `MasterCatalogPage.tsx`**
  - Implement tab navigation (`activeTab === 'gear' | 'food' | 'responsibilities'`).
  - Implement Camping Gear filter pills (`gearFilter === 'all' | 'individual' | 'shared'`).
  - Implement Search input with debounce / instant state filtering.
  - Implement Add/Edit modal with form validation.
  - Implement Delete confirmation modal explaining safe unlinking.
  - Register route `/admin/catalogs` in `AppRoutes.tsx` and add link in admin navigation.

- [ ] **Step 4: Run test to verify it passes**
  Run: `npm --prefix frontend test MasterCatalogPage`
  Expected: PASS

- [ ] **Step 5: Commit**
  ```bash
  git add frontend/src/features/admin/MasterCatalogPage* frontend/src/app/AppRoutes.tsx
  git commit -m "feat(ui): add admin Master Catalog page with gear filters and delete modal"
  ```

---

### Task 4: Frontend Expense Split UI Improvements

**Files:**
- Modify: `frontend/src/features/trips/TripFinancialsTab.tsx`
- Test: `frontend/src/features/trips/__tests__/TripFinancialsSplit.test.tsx`

**Interfaces:**
- Consumes: `attendeesList` with `displayName` and `memberId`.
- Produces: Stacked, full-width attendee split list with visible names, Select All/Clear, and per-person split calculation.

- [ ] **Step 1: Write test for attendee split checkboxes in expense modal**
  Create `frontend/src/features/trips/__tests__/TripFinancialsSplit.test.tsx`:
  - Open Record Shared Expense modal.
  - Verify every confirmed attendee has their full name displayed next to their checkbox.
  - Clicking "Deselect All" unchecks all participants; clicking "Select All" checks all.
  - Verify per-person split preview displays correct amount.

- [ ] **Step 2: Run test to verify it fails**
  Run: `npm --prefix frontend test TripFinancialsSplit`
  Expected: FAIL

- [ ] **Step 3: Update `TripFinancialsTab.tsx` expense modal**
  - Replace `gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))"` with a vertical flex layout (`display: "flex", flexDirection: "column", gap: "0.5rem"`).
  - Ensure attendee names are rendered with bold, high-contrast text (`color: "#0f172a"`, `fontWeight: 600`), and fallback to `"Camper"` if empty.
  - Ensure Select All / Clear buttons work cleanly and update the allocation counter.
  - Enforce exact cent distribution using `calculateEqualAllocations`.

- [ ] **Step 4: Run test to verify it passes**
  Run: `npm --prefix frontend test TripFinancialsSplit`
  Expected: PASS

- [ ] **Step 5: Commit**
  ```bash
  git add frontend/src/features/trips/TripFinancialsTab.tsx frontend/src/features/trips/__tests__/TripFinancialsSplit.test.tsx
  git commit -m "fix(ui): improve expense split layout with prominent attendee names and Select All"
  ```

---

### Task 5: Frontend "My Trip Hub" Dashboard Refactor

**Files:**
- Modify: `frontend/src/features/trips/EventDetailsPage.tsx`
- Modify: `frontend/src/features/trips/TripTasksAndMealsTab.tsx`
- Modify: `frontend/src/features/trips/TripLogisticsTab.tsx`
- Test: `frontend/src/features/trips/__tests__/TripHubView.test.tsx`

**Interfaces:**
- Consumes: Trip details payload, RSVP status, deposit status, daily chores workload.
- Produces: Option A "My Trip Hub" layout:
  1. Top Banner: **⚡ Required From You**
     - Binary RSVP toggle
     - $50 Cabin Deposit status toggle (*"I Have Sent $50"* button / Pending / Confirmed / Exempt)
     - Daily Chores status indicator (2.0x target progress)
  2. Main Section: **📋 Trip To-Do & Contributions**
     - Shared Gear signup summary
     - Food & Groceries signup summary
     - Read-only Personal Packing Checklist modal/drawer
     - Record Shared Expense button
  3. Single-copy Constitution / Trip Notes read-only card.

- [ ] **Step 1: Write test for "My Trip Hub" view**
  Create `frontend/src/features/trips/__tests__/TripHubView.test.tsx`:
  - Verify "Required From You" banner renders RSVP, $50 deposit toggle, and chores progress.
  - Verify clicking "I Have Sent $50" triggers API call and updates status to submitted.
  - Verify attending cabin payer displays "Exempt (Cabin Payer)".
  - Verify "Trip To-Do & Contributions" renders cards for shared gear, food, packing checklist, and post expense.
  - Verify reaching daily chore target (2.0x) greys out unselected chores on that day.

- [ ] **Step 2: Run test to verify it fails**
  Run: `npm --prefix frontend test TripHubView`
  Expected: FAIL

- [ ] **Step 3: Implement "My Trip Hub" in `EventDetailsPage.tsx`**
  - Build the **"⚡ Required From You"** card directly in the Overview tab / main hero area.
  - Add the $50 Deposit row with the *"I Have Sent $50"* button for members, and admin verification indicators for admins.
  - Build the **"📋 Trip To-Do & Contributions"** section grouping:
    - Shared Community Gear (with claim button)
    - Food & Groceries (with volunteer button)
    - Personal Packing Checklist drawer/modal (listing individual packing items)
    - Post Shared Expense shortcut
  - Ensure chores selection in `TripTasksAndMealsTab.tsx` greys out remaining chores on any day where 2.0x target is met.
  - Render the single-copy rules text cleanly in the Camping Constitution section.

- [ ] **Step 4: Run test to verify it passes**
  Run: `npm --prefix frontend test TripHubView`
  Expected: PASS

- [ ] **Step 5: Commit**
  ```bash
  git add frontend/src/features/trips/EventDetailsPage.tsx frontend/src/features/trips/TripTasksAndMealsTab.tsx frontend/src/features/trips/__tests__/TripHubView.test.tsx
  git commit -m "feat(ui): implement 'My Trip Hub' dashboard with Required banner and To-Do lists"
  ```

---

### Task 6: End-to-End Browser QA Verification Gate

**Files:**
- Create: `e2e/trip-hub-and-catalogs.spec.ts`
- Modify: `e2e/mobile-usability.spec.ts`

**Interfaces:**
- Playwright testing Desktop Chromium, iPhone Mobile WebKit, and Android Mobile Chromium (`workers: 1`).

- [ ] **Step 1: Write Playwright acceptance test suite**
  Create `e2e/trip-hub-and-catalogs.spec.ts` verifying:
  - Admin logs in, opens `/admin/catalogs`, adds a new gear item (Individual), filters by `[🎒 Individual]`, and verifies item is visible.
  - Admin deletes a master item and verifies safe deletion without error.
  - Admin creates a trip, verifies catalog items are auto-included.
  - Member logs in, opens trip:
    - Submits RSVP "Going".
    - Clicks "I Have Sent $50" -> verifies deposit status updates to Submitted and persists after `page.reload()`.
    - Selects daily chores reaching 2.0x -> verifies remaining chores are disabled/greyed out and persists after `page.reload()`.
    - Opens expense modal -> verifies full attendee names are visible next to checkboxes, selects split, and saves.
  - Viewport verification: Assert `scrollWidth <= innerWidth` across iPhone WebKit and Android Chromium.

- [ ] **Step 2: Run Playwright test suite**
  Run: `npm run test:e2e -- e2e/trip-hub-and-catalogs.spec.ts`
  Expected: PASS across all devices with zero regressions.

- [ ] **Step 3: Run full verification suite**
  Run: `npm run verify`
  Expected: All typechecks, unit tests, integration tests, and security scans pass cleanly.

- [ ] **Step 4: Commit**
  ```bash
  git add e2e/
  git commit -m "test(e2e): add Playwright browser acceptance tests for Trip Hub, catalogs, and deposit"
  ```

---

## Plan Review & Handoff

Plan complete and saved to `docs/superpowers/plans/2026-10-20-camping-club-ux-master-catalog-redesign.md`.
