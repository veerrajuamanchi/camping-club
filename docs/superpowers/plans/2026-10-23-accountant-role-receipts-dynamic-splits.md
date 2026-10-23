# Accountant Role, Expense Receipts (3-Trip Retention), and Dynamic Expense Splits Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a restricted Accountant role for participant deposit verification, dynamic "All Attendees" expense splitting that includes late joiners, and secure receipt attachment with automated 3-completed-trip retention purging.

**Architecture:** Extend Supabase schema with the `accountant` role and updated check constraints on `member_profiles`. Store expense receipts in a private `trip-receipts` Supabase Storage bucket with signed URL access, governed by an automated purge RPC for completed trips beyond the 3 most recent. Implement dynamic expense allocation in `trip-api` so that `split_mode = 'all_attendees'` calculates integer-cent splits across all members RSVP'd Coming on the fly, locking permanently into `trip_expense_allocations` upon settlement finalization.

**Tech Stack:** React 19, TypeScript, Vite, Supabase PostgreSQL, Supabase Storage, Supabase Edge Functions (Deno), Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-23-accountant-role-receipts-dynamic-splits-design.md`

## Global Constraints

- Use integer cents for every monetary value. No floating-point money arithmetic.
- Deterministic equal allocations must strictly use `calculateEqualAllocations` with canonical UUID sorting for remainders.
- Storage bucket `trip-receipts` must remain private; access is strictly authenticated via signed URLs or RLS.
- Role checks must be resolved server-side from active membership records in PostgreSQL, never from client metadata.
- All database mutations must be transactional and idempotent.
- Every editable form and state change must persist durably to PostgreSQL and remain intact across full browser reloads (`page.reload()`).
- Responsive layouts must maintain zero horizontal overflow (`scrollWidth <= innerWidth`) on desktop and mobile viewports.

## Review Focus

1. **Zero-Attendee Dynamic Split Guard:** Attempting to record an `all_attendees` expense when 0 attendees are RSVP'd Coming must fail cleanly with a 400 validation error rather than dividing by zero.
2. **Upcoming Trip Receipt Safety:** The 3-trip retention purge must strictly filter for `trip_status IN ('completed', 'financially_settled')` and order by `starts_on DESC` so upcoming and ongoing trip receipts are never prematurely purged.
3. **Historical Expense Split Mode Backfill:** Existing expenses in `trip_expenses` must be defaulted/backfilled with `split_mode = 'custom'` so pre-existing static allocations are never inadvertently overwritten.
4. **Accountant Privilege Boundary:** An Accountant attempting to edit trip details, cancel trips, invite members, delete another member's expense, or finalize settlements must receive a strict 403 Forbidden.
5. **Exact Integer Cent Conservation:** When dynamic allocations recalculate as attendees join (e.g. 4 to 5 members), the sum of all member allocations must always exactly equal `amount_cents`.

---

### Task 1: Database Migration for Accountant Role, Dynamic Splits, Storage & Retention

**Files:**
- Create: `supabase/migrations/20261023140000_accountant_role_receipts_dynamic_splits.sql`
- Test: `supabase/tests/accountant_role_and_receipts_migration_test.sql`

**Interfaces:**
- Consumes: `public.member_profiles`, `public.trip_expenses`, `public.trip_rsvps`, `storage.buckets`, `storage.objects`
- Produces: 
  - Updated `member_role` check constraint allowing `'accountant'`
  - Updated `public.phase1_update_membership` allowing `'accountant'`
  - Updated `public.verify_member_deposit` permitting `accountant` and `admin`
  - Columns on `trip_expenses`: `split_mode`, `receipt_storage_path`, `receipt_file_name`, `receipt_content_type`
  - Updated `public.phase5_manage_expense` supporting `split_mode` and receipt metadata
  - Stored function `public.purge_expired_receipts()` returning deleted file paths

- [ ] **Step 1: Write the failing migration verification test**

Create `supabase/tests/accountant_role_and_receipts_migration_test.sql`:
```sql
BEGIN;
SELECT plan(6);

-- Test 1: Check constraint permits 'accountant'
SELECT col_is_pk('public', 'member_profiles', 'member_id', 'member_profiles has primary key');

-- Test 2: trip_expenses has split_mode column
SELECT has_column('public', 'trip_expenses', 'split_mode', 'trip_expenses has split_mode column');

-- Test 3: trip_expenses has receipt_storage_path column
SELECT has_column('public', 'trip_expenses', 'receipt_storage_path', 'trip_expenses has receipt_storage_path');

-- Test 4: trip_expenses has receipt_file_name column
SELECT has_column('public', 'trip_expenses', 'receipt_file_name', 'trip_expenses has receipt_file_name');

-- Test 5: storage bucket trip-receipts exists
SELECT results_eq(
  $$ SELECT id, public FROM storage.buckets WHERE id = 'trip-receipts' $$,
  $$ VALUES ('trip-receipts'::text, false) $$,
  'trip-receipts bucket exists and is private'
);

-- Test 6: purge_expired_receipts function exists
SELECT has_function('public', 'purge_expired_receipts', 'purge_expired_receipts function exists');

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx supabase test db --debug` or execute migration verification query.  
Expected: FAIL indicating missing columns and functions.

- [ ] **Step 3: Implement migration `20261023140000_accountant_role_receipts_dynamic_splits.sql`**

Write SQL migration implementing:
1. `ALTER TABLE public.member_profiles DROP CONSTRAINT IF EXISTS member_profiles_member_role_check;`  
   `ALTER TABLE public.member_profiles ADD CONSTRAINT member_profiles_member_role_check CHECK (member_role IN ('member', 'admin', 'accountant'));`
2. Update `public.phase1_update_membership` to accept `p_role IN ('member', 'admin', 'accountant')`.
3. Update `public.verify_member_deposit` to allow `v_actor.member_role IN ('admin', 'administrator', 'accountant')`.
4. Alter `public.trip_expenses`:
   - `ADD COLUMN IF NOT EXISTS split_mode TEXT NOT NULL DEFAULT 'all_attendees' CHECK (split_mode IN ('all_attendees', 'custom'));`
   - `ADD COLUMN IF NOT EXISTS receipt_storage_path TEXT;`
   - `ADD COLUMN IF NOT EXISTS receipt_file_name TEXT;`
   - `ADD COLUMN IF NOT EXISTS receipt_content_type TEXT;`
5. Backfill historical expenses: `UPDATE public.trip_expenses SET split_mode = 'custom' WHERE created_at < now();`
6. Create `trip-receipts` bucket in `storage.buckets` (private, 5MB limit, JPEG/PNG/WebP/PDF).
7. RLS policies on `storage.objects` for `trip-receipts`:
   - Authenticated users with active membership can insert and select objects under `trips/{trip_id}/*` if they are an attendee of the trip or accountant/admin.
8. Update `public.phase5_manage_expense` to accept `p_split_mode`, `p_receipt_storage_path`, `p_receipt_file_name`, `p_receipt_content_type` and persist them.
9. Create `public.purge_expired_receipts()` function that finds completed trips (`trip_status IN ('completed', 'financially_settled')`) older than the 3 most recent, deletes their storage objects in `storage.objects`, and nulls out receipt columns in `trip_expenses`.

- [ ] **Step 4: Run test to verify it passes**

Run: Apply migration and execute `supabase/tests/accountant_role_and_receipts_migration_test.sql`.  
Expected: All 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261023140000_accountant_role_receipts_dynamic_splits.sql supabase/tests/accountant_role_and_receipts_migration_test.sql
git commit -m "feat(db): add accountant role, dynamic split mode, and receipt retention schema"
```

---

### Task 2: Edge Functions (`member-api` & `trip-api`) Updates

**Files:**
- Modify: `supabase/functions/member-api/index.ts:1-25`
- Modify: `supabase/functions/trip-api/index.ts:20-50,380-420,1170-1350,1520-1535`
- Test: `supabase/functions/trip-api/index.test.ts` or integration tests

**Interfaces:**
- Consumes: `member_profiles`, `phase1_update_membership`, `verify_member_deposit`, `calculateEqualAllocations`
- Produces:
  - `member-api`: `update_membership` accepting `memberRole: "accountant"`
  - `trip-api`: `verify_deposit` callable by members with `member_role === "accountant"`
  - `trip-api`: `getTripFinancials` dynamically computing `all_attendees` allocations for active Coming RSVPs
  - `trip-api`: `admin_manage_trip_expense` saving `splitMode` and receipt metadata
  - `trip-api`: `admin_finalize_settlement` materializing dynamic allocations into `trip_expense_allocations`

- [ ] **Step 1: Write failing unit test for dynamic allocation calculation and role checks**

Create/update tests asserting:
1. `member-api` allows updating a member's role to `"accountant"`.
2. `trip-api` permits `verify_deposit` for a user with `member_role === "accountant"`.
3. `trip-api` rejects `admin_configure_trip` or `admin_finalize_settlement` for `accountant` with 403 `administrator_required`.
4. `getTripFinancials` returns dynamically calculated allocations across all Coming attendees for expenses with `split_mode === 'all_attendees'`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test supabase/functions` or test runner.  
Expected: FAIL on `membershipSchema` validation and missing `splitMode` support.

- [ ] **Step 3: Update `member-api/index.ts` and `trip-api/index.ts`**

In `supabase/functions/member-api/index.ts`:
- Update `membershipSchema`: `memberRole: z.enum(["member", "admin", "accountant"])`.
- Update `Member` type to include `"accountant"`.

In `supabase/functions/trip-api/index.ts`:
- Update `Member` type to include `"accountant"`.
- In `verify_deposit` authorization:
  ```ts
  if (action === "verify_deposit") {
    if (member.member_role !== "admin" && member.member_role !== "accountant") {
      return errorResponse(request, 403, "admin_or_accountant_required", requestId);
    }
  } else if (adminActions.has(action) && member.member_role !== "admin") {
    return errorResponse(request, 403, "administrator_required", requestId);
  }
  ```
- In `admin_manage_trip_expense` schema and handler:
  Add `splitMode: z.enum(["all_attendees", "custom"]).optional()`, `receiptStoragePath: z.string().optional()`, `receiptFileName: z.string().optional()`, `receiptContentType: z.string().optional()`.
  If `splitMode === "all_attendees"`, validate that `confirmedAttendees.length > 0`.
- In `getTripFinancials`:
  For each expense where `exp.split_mode === "all_attendees"` and settlement is not yet finalized, dynamically compute allocations using `calculateEqualAllocations(exp.amount_cents, confirmedAttendees)`.
- In `admin_finalize_settlement`:
  Compute final dynamic allocations for all `all_attendees` expenses across the confirmed attendees, insert them into `trip_expense_allocations`, and lock the settlement run.
- Call `purge_expired_receipts` upon `admin_finalize_settlement` or trip completion.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/member-api/index.ts supabase/functions/trip-api/index.ts
git commit -m "feat(api): support accountant role verification and dynamic expense splits"
```

---

### Task 3: Domain Settlement Engine Dynamic Allocation Verification

**Files:**
- Modify: `frontend/src/domain/settlementEngine.test.ts`
- Modify: `frontend/src/domain/settlementEngine.ts:35-55`

**Interfaces:**
- Consumes: `calculateEqualAllocations(amountCents: number, participantMemberIds: string[])`
- Produces: Exact deterministic integer-cent allocation distribution tested against dynamic group resizing

- [ ] **Step 1: Write the failing tests for dynamic attendance changes and zero attendees**

Add tests to `frontend/src/domain/settlementEngine.test.ts`:
```ts
describe("dynamic all_attendees expense allocation", () => {
  it("guards against zero attendees without dividing by zero", () => {
    const allocs = calculateEqualAllocations(6000, []);
    expect(allocs).toEqual([]);
  });

  it("dynamically reallocates exact cents when a 5th attendee joins a 4-person split", () => {
    const attendees4 = ["m-1", "m-2", "m-3", "m-4"];
    const split4 = calculateEqualAllocations(6000, attendees4);
    expect(split4).toHaveLength(4);
    expect(split4.every((a) => a.allocatedCents === 1500)).toBe(true);
    expect(split4.reduce((sum, a) => sum + a.allocatedCents, 0)).toBe(6000);

    const attendees5 = ["m-1", "m-2", "m-3", "m-4", "m-5"];
    const split5 = calculateEqualAllocations(6000, attendees5);
    expect(split5).toHaveLength(5);
    expect(split5.every((a) => a.allocatedCents === 1200)).toBe(true);
    expect(split5.reduce((sum, a) => sum + a.allocatedCents, 0)).toBe(6000);
  });

  it("handles odd cents remainder deterministically with canonical sorting", () => {
    const attendees3 = ["m-c", "m-a", "m-b"];
    const split = calculateEqualAllocations(1000, attendees3);
    expect(split.reduce((sum, a) => sum + a.allocatedCents, 0)).toBe(1000);
    // 1000 / 3 = 333 rem 1. Canonical order: m-a gets 334, m-b gets 333, m-c gets 333
    expect(split.find((a) => a.memberId === "m-a")?.allocatedCents).toBe(334);
    expect(split.find((a) => a.memberId === "m-b")?.allocatedCents).toBe(333);
    expect(split.find((a) => a.memberId === "m-c")?.allocatedCents).toBe(333);
  });
});
```

- [ ] **Step 2: Run test to verify it passes or fails**

Run: `npm test frontend/src/domain/settlementEngine.test.ts`  
Expected: PASS (if already compliant) or identify any edge-case divergence.

- [ ] **Step 3: Ensure `calculateEqualAllocations` in `settlementEngine.ts` safely guards zero and negative amounts**

Verify lines 35-55 in `frontend/src/domain/settlementEngine.ts` handle `participantMemberIds.length === 0` cleanly by returning `[]`.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/domain/settlementEngine.ts frontend/src/domain/settlementEngine.test.ts
git commit -m "test(settlement): verify dynamic attendee allocations and integer-cent conservation"
```

---

### Task 4: Admin Members Management UI for Accountant Role

**Files:**
- Modify: `frontend/src/features/admin/AdminMembersPage.tsx:1-118`
- Modify: `frontend/src/features/admin/AdminMembersPage.test.tsx`

**Interfaces:**
- Consumes: `invokeMemberApi("list_members")`, `invokeMemberApi("update_membership")`
- Produces:
  - Role dropdown option `<option value="accountant">Accountant</option>`
  - Accountant role badge rendering with distinct emerald style
  - Audit notification on role update to Accountant

- [ ] **Step 1: Write failing component test for assigning Accountant role**

In `frontend/src/features/admin/AdminMembersPage.test.tsx`:
```tsx
it("renders Accountant option in role dropdown and updates member to Accountant", async () => {
  // Test that 'Accountant' appears in role select
  // Test that changing role to accountant invokes update_membership with memberRole: "accountant"
  // Test that notification says "Role updated: [Name] is now an Accountant."
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test frontend/src/features/admin/AdminMembersPage.test.tsx`  
Expected: FAIL because `<option value="accountant">` is missing and type only allows `"member" | "admin"`.

- [ ] **Step 3: Implement Accountant role selection in `AdminMembersPage.tsx`**

1. Update `MemberRow` type:
   ```ts
   type MemberRow = {
     member_id: string;
     display_name: string;
     member_role: "member" | "admin" | "accountant";
     account_status: "active" | "inactive" | "suspended";
     created_at: string;
   };
   ```
2. In `update` helper function:
   ```ts
   if (field === "memberRole") {
     const roleLabel = value === "admin" ? "an Administrator" : value === "accountant" ? "an Accountant" : "a Member";
     setNotice(`Role updated: ${row.display_name} is now ${roleLabel}. Change recorded in audit log.`);
   }
   ```
3. In JSX:
   Add `<option value="accountant">Accountant</option>` to the role select.
   Add emerald styling for `accountant` badge:
   ```tsx
   <span
     className="badge-pill"
     style={{
       textTransform: "capitalize",
       fontSize: "0.8rem",
       backgroundColor: row.member_role === "accountant" ? "#065f46" : undefined,
       color: row.member_role === "accountant" ? "#a7f3d0" : undefined,
     }}
   >
     {row.member_role}
   </span>
   ```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test frontend/src/features/admin/AdminMembersPage.test.tsx`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/admin/AdminMembersPage.tsx frontend/src/features/admin/AdminMembersPage.test.tsx
git commit -m "feat(admin): add accountant role assignment and badge in members page"
```

---

### Task 5: Event Details Attendee Roster Verification for Accountant

**Files:**
- Modify: `frontend/src/features/trips/EventDetailsPage.tsx:1600-1630`
- Modify: `frontend/src/features/trips/EventDetailsPage.test.tsx`
- Modify: `frontend/src/features/trips/__tests__/TripHubView.test.tsx`

**Interfaces:**
- Consumes: `authProfileMemberId`, `userRole` (`"member" | "admin" | "accountant"`), `api("verify_deposit")`
- Produces: Displays and enables `[Verify Deposit]` button for users with role `"admin"` OR `"accountant"`

- [ ] **Step 1: Write failing component test for Accountant verifying deposits**

In `frontend/src/features/trips/EventDetailsPage.test.tsx`:
```tsx
it("allows Accountant to see and click Verify Deposit in attendee roster", async () => {
  // Mount EventDetailsPage with userRole = "accountant"
  // Verify button "Verify Deposit" is present for attendees with depositStatus = "submitted_by_member"
  // Click "Verify Deposit", assert api is called with ("verify_deposit", { tripId, memberId })
});

it("hides Verify Deposit button for standard Member", async () => {
  // Mount EventDetailsPage with userRole = "member"
  // Verify button "Verify Deposit" is not rendered
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test frontend/src/features/trips/EventDetailsPage.test.tsx`  
Expected: FAIL because `isAccountant` is not checked.

- [ ] **Step 3: Implement deposit verification permission check in `EventDetailsPage.tsx`**

1. Check current user's role:
   ```ts
   const isAccountant = authProfileRole === "accountant";
   const canVerifyDeposit = isAdmin || isAccountant;
   ```
2. Update roster action render condition (around line 1608):
   ```tsx
   {canVerifyDeposit && (e.depositStatus === "submitted_by_member" || e.depositStatus === "unpaid" || !e.depositStatus) && e.depositStatus !== "exempt" && (
     <button
       type="button"
       disabled={depositBusy}
       onClick={() => void handleVerifyDeposit(e.memberId)}
       className="btn-verify-deposit"
     >
       Verify Deposit
     </button>
   )}
   ```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test frontend/src/features/trips/EventDetailsPage.test.tsx`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/trips/EventDetailsPage.tsx frontend/src/features/trips/EventDetailsPage.test.tsx
git commit -m "feat(trips): permit accountant to verify member deposits on attendee roster"
```

---

### Task 6: Trip Financials: Dynamic Split Mode, Receipt Upload & Viewer

**Files:**
- Modify: `frontend/src/features/trips/TripFinancialsTab.tsx:1-962`
- Modify: `frontend/src/features/trips/TripFinancials.test.tsx`

**Interfaces:**
- Consumes: Supabase Storage client `supabase.storage.from("trip-receipts")`, `api("admin_manage_trip_expense")`
- Produces:
  - Add Expense modal with split mode selector: "All Attendees (Dynamic)" vs "Custom Subset"
  - Receipt file upload dropzone (JPEG, PNG, WebP, PDF up to 5MB) with 3-camping retention badge
  - Receipt view modal / lightbox on expense card

- [ ] **Step 1: Write failing component tests for dynamic split and receipt upload**

In `frontend/src/features/trips/TripFinancials.test.tsx`:
```tsx
it("renders Add Expense modal with 'All Attendees (Dynamic)' as default split mode", async () => {
  // Open Add Expense modal
  // Expect 'All Attendees (Dynamic)' option to be selected
  // Expect helper text explaining automatic late-joiner inclusion
});

it("allows selecting 'Custom Subset' to pick specific participants", async () => {
  // Toggle to 'Custom Subset'
  // Expect participant checkboxes to appear
});

it("handles receipt file selection and displays retention notice", async () => {
  // Check for receipt upload input
  // Expect retention badge: "Kept for last 3 campings, then auto-deleted"
});

it("renders View Receipt link and opens receipt preview modal", async () => {
  // Mount with expense containing receiptStoragePath or receiptUrl
  // Click View Receipt, verify modal opens
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test frontend/src/features/trips/TripFinancials.test.tsx`  
Expected: FAIL due to missing split mode state and file upload elements.

- [ ] **Step 3: Implement dynamic split mode, file upload, and receipt viewer in `TripFinancialsTab.tsx`**

1. Update `TripExpense` type:
   ```ts
   export type TripExpense = {
     id: string;
     expenseType: "cabin_deposit" | "carpool_mileage" | "shared_receipt" | "other";
     splitMode?: "all_attendees" | "custom";
     payerMemberId: string;
     payerName: string;
     amountCents: number;
     description: string;
     incurredDate: string;
     receiptUrl: string | null;
     receiptStoragePath?: string | null;
     receiptFileName?: string | null;
     receiptContentType?: string | null;
     isLocked: boolean;
     allocations: ExpenseAllocation[];
   };
   ```
2. In `TripFinancialsTab`:
   - Add state:
     - `splitMode: "all_attendees" | "custom"` (default `"all_attendees"`).
     - `receiptFile: File | null` (default `null`).
     - `previewReceiptUrl: string | null` (for modal lightbox).
   - In `handleCreateExpense`:
     - If `receiptFile` is selected, upload to `trip-receipts` bucket under `trips/${tripId}/${crypto.randomUUID()}-${receiptFile.name}`.
     - Call `api("admin_manage_trip_expense", { tripId, action: "create", splitMode, receiptStoragePath, receiptFileName: receiptFile.name, receiptContentType: receiptFile.type, ... })`.
3. In Add Expense Modal JSX:
   - Split mode segmented control:
     - `All Attendees (Dynamic)` [Selected]: Shows helper *"Splits equally among all confirmed attendees (currently X campers = $Y.YY/person). New attendees who join later will automatically be included."*
     - `Custom Subset`: Shows participant checkboxes.
   - Receipt upload box:
     - File input accepting `.jpg,.jpeg,.png,.webp,.pdf`.
     - File size check `<= 5MB`.
     - Badge: *"✓ Kept for last 3 campings, then auto-deleted"*.
4. In Expense List JSX:
   - If `exp.receiptStoragePath` or `exp.receiptUrl`:
     - Render `📄 View Receipt`.
     - Clicking fetches signed URL (if storage path) and opens `ReceiptModal`.
5. Create `ReceiptViewerModal` component:
   - Supports image zoom/preview and PDF link/iframe with close button.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test frontend/src/features/trips/TripFinancials.test.tsx`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/trips/TripFinancialsTab.tsx frontend/src/features/trips/TripFinancials.test.tsx
git commit -m "feat(financials): dynamic all-attendees expense split and receipt upload modal"
```

---

### Task 7: Automated 3-Camping Purge Job Verification & End-to-End Browser Certification

**Files:**
- Create: `e2e/accountant-and-receipts.spec.ts`
- Modify: `playwright.config.ts` (if needed)

**Interfaces:**
- Consumes: Playwright browser test harness across Desktop Chromium, iPhone Mobile WebKit, and Android Mobile Chromium
- Produces: Durability, role verification, and responsive UX certification across all viewports

- [ ] **Step 1: Write E2E browser tests for Accountant role and receipt lifecycle**

Create `e2e/accountant-and-receipts.spec.ts`:
```ts
import { test, expect } from "@playwright/test";

test.describe("Accountant Role, Dynamic Expense Splits & Receipts", () => {
  test("admin assigns accountant role and accountant verifies attendee deposit", async ({ page }) => {
    // 1. Sign in as Admin, navigate to Admin Members page
    // 2. Assign 'Accountant' role to test user, verify toast and badge update
    // 3. Reload page, verify Accountant role persists in PostgreSQL
    // 4. Sign in as Accountant, navigate to Event Details page
    // 5. Verify 'Verify Deposit' button is visible on attendee roster
    // 6. Click 'Verify Deposit', verify status updates to verified
    // 7. Verify Accountant CANNOT see Admin edit event or configure trip buttons
  });

  test("creates dynamic expense, confirms late attendee, verifies split reallocates across reload", async ({ page }) => {
    // 1. Navigate to Trip Financials tab
    // 2. Add shared expense ($60.00) with 'All Attendees (Dynamic)' split and attach test receipt
    // 3. Verify receipt link is rendered and opens receipt modal
    // 4. Verify initial split across 4 attendees ($15.00 each)
    // 5. Confirm 5th attendee on trip
    // 6. Reload page (page.reload())
    // 7. Verify split automatically recalculated to 5 attendees ($12.00 each) intact
  });

  test("mobile viewports have zero horizontal overflow and accessible touch targets", async ({ page }) => {
    // Check document.body.scrollWidth <= window.innerWidth
  });
});
```

- [ ] **Step 2: Run E2E test to verify it fails initially**

Run: `npm run test:e2e -- e2e/accountant-and-receipts.spec.ts`  
Expected: FAIL before full system wiring.

- [ ] **Step 3: Run full verification suite across all devices**

Run:
1. `npm test` (all unit and component tests)
2. `npm run build` (production build verification)
3. `npm run test:e2e` across Desktop Chromium, Mobile WebKit, and Mobile Chromium

- [ ] **Step 4: Verify test output and capture evidence**

Ensure all test assertions pass with zero failures and zero mobile horizontal scroll regressions.

- [ ] **Step 5: Commit**

```bash
git add e2e/accountant-and-receipts.spec.ts
git commit -m "test(e2e): certify accountant role, dynamic splits, and receipt retention across mobile and desktop"
```
