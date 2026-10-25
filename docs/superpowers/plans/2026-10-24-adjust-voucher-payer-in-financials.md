# Adjust Voucher Payer in Financials & Activities Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Overview
Enable administrators to adjust who paid for activity vouchers in the Financials ledger, allow accountants and administrators to specify the purchaser directly when entering vouchers in the Activities hub, and ensure two-way synchronization between `trip_expenses.payer_member_id` and `trip_activity_groups.purchaser_member_id`.

## User Stories
1. **As an Admin in Financials:** I see an "✏️ Edit" button on shared expense rows so I can adjust "Who Paid?" (reassigning the payer to the camper who actually purchased the vouchers) as well as the description, date, or amount.
2. **As an Admin or Accountant in Activities:** In the "+ Enter Voucher Details" modal, I see a "Who Paid / Purchased?" dropdown listing confirmed trip attendees so I can attribute multiple vouchers (such as 4 Groupons) to the camper who bought them, rather than defaulting to myself.
3. **As a Camper:** When the admin or accountant updates who purchased the voucher, my vehicle card in Activities and the shared expense ledger in Financials remain in sync with the correct purchaser's name.

---

## File Structure & Proposed Changes

| File | Responsibility |
|---|---|
| `supabase/migrations/20261024050000_sync_expense_payer_with_activity_group.sql` | Sync `trip_activity_groups.purchaser_member_id` when `phase5_manage_expense` updates `payer_member_id` on an expense linked via `expense_id`. |
| `frontend/src/features/trips/TripActivitiesTab.tsx` | Add "Who Paid / Purchased?" dropdown to `VoucherModal`, pre-selecting existing purchaser or current user; pass `purchaserMemberId` in `submit_activity_voucher`. |
| `frontend/src/features/trips/TripActivitiesTab.test.tsx` | Test that `VoucherModal` renders attendee dropdown and passes `purchaserMemberId` to API. |
| `frontend/src/features/trips/TripFinancialsTab.tsx` | Add "✏️ Edit" button to expense rows for Admins, along with an `EditExpenseModal` that updates description, payer (`payerMemberId`), amount, and date via `admin_manage_trip_expense`. |
| `frontend/src/features/trips/TripFinancials.test.tsx` | Test that Admin can edit an existing expense, change the payer, and submit the update. |
| `supabase/tests/sync_expense_payer_test.sql` | pgTAP tests verifying database update and two-way synchronization between `trip_expenses` and `trip_activity_groups`. |

---

## Tasks

### Task 1: Database Migration for Two-Way Payer Synchronization
- [ ] Create migration file `supabase/migrations/20261024050000_sync_expense_payer_with_activity_group.sql`.
- [ ] In `phase5_manage_expense` update branch (`p_action = 'update'`), if `p_payer_member_id` is supplied:
  - Update `public.trip_expenses.payer_member_id`.
  - Update `public.trip_activity_groups.purchaser_member_id = p_payer_member_id, updated_at = now()` WHERE `expense_id = p_expense_id`.
- [ ] Add pgTAP test `supabase/tests/sync_expense_payer_test.sql` proving:
  - Creating a voucher expense links to `trip_activity_groups`.
  - Updating `payer_member_id` via `phase5_manage_expense` automatically synchronizes `trip_activity_groups.purchaser_member_id`.
- [ ] Run `npm run test:db` to verify all tests pass.

### Task 2: Activities Hub "Who Paid / Purchased?" Dropdown
- [ ] Update `VoucherModal` in `frontend/src/features/trips/TripActivitiesTab.tsx`:
  - Accept `attendeesList: Array<{ memberId: string; displayName: string }>` in props.
  - Add state `purchaserMemberId` defaulting to `group.purchaser_member_id || currentMemberId`.
  - Render a `<select>` for "Who Paid / Purchased?" containing all confirmed attendees.
  - Pass `purchaserMemberId` in `onSubmit`.
- [ ] Update `handleSubmitVoucher` in `TripActivitiesTab.tsx` to include `purchaserMemberId` in the `submit_activity_voucher` API payload.
- [ ] Update tests in `TripActivitiesTab.test.tsx` to assert that the purchaser selector renders and passes the selected `purchaserMemberId`.
- [ ] Run `npm test` on `TripActivitiesTab.test.tsx`.

### Task 3: Financials Tab "✏️ Edit Expense" Feature
- [ ] In `frontend/src/features/trips/TripFinancialsTab.tsx`:
  - Add state: `editingExpense: TripExpense | null` and `showEditExpenseModal: boolean`.
  - On each expense row, if `isAdmin && !isFinalized`, render a `✏️ Edit` button.
  - Implement `handleOpenEditExpense(exp)` and `handleSaveEditExpense(e)`.
  - Implement `EditExpenseModal` allowing modification of `description`, `payerId` (from `attendeesList`), `amountDollars`, and `incurredDate`.
  - Call `api("admin_manage_trip_expense", { tripId, action: "update", expenseId, payerMemberId, description, amountCents, incurredDate })`.
  - Call `fetchFinancials()` on success.
- [ ] Update `TripFinancials.test.tsx` to verify:
  - Admin sees `✏️ Edit` button on shared expenses.
  - Clicking `✏️ Edit` opens the modal with existing values.
  - Submitting sends the updated `payerMemberId` to `admin_manage_trip_expense`.
- [ ] Run `npm test` on `TripFinancials.test.tsx`.

### Task 4: Full Verification Pipeline & Browser QA Certification
- [ ] Run `npm run typecheck` and `npm test`.
- [ ] Run `npm run test:db`.
- [ ] Run `node --test tests/functions/activities.test.mjs` and `tests/functions/accountant_and_dynamic_splits.test.mjs`.
- [ ] Run Playwright browser acceptance tests across Desktop Chromium, iPhone WebKit, and Android Mobile Chromium (`npm run test:e2e`).
- [ ] Run `npm run verify` (typecheck, tests, db tests, integration tests, build, client bundle security scan).

### Task 5: Production Deployment
- [ ] Commit changes to `main` and push to `origin/main`.
- [ ] Run `./scripts/deploy-production.sh` to push migration `20261024050000` and deploy edge functions to Supabase production project `kdxmwqxlhswcgwanlump`.
- [ ] Report completion with test and deployment evidence.
