# Phase C Certification Report: Volunteering, Driver Workload Credits & Member-Facing Tasks & Meals Tab

**Date:** 2026-10-11  
**Branch:** `feature/responsibilities-meals-matrix`  
**Status:** Certified & Ready for Merge  

---

## 1. Scope & Implementation Summary

Phase C implements the volunteer claiming system, concurrency protections, driver workload credits, and the 5th member-facing **Tasks & Meals** tab on the Event Details page.

### A. Database Schema & Invariants (`20261010182000_trip_duty_assignments_and_driver_credits.sql`)
1. **`public.trip_duty_assignments`**:
   - Stores volunteer assignment records (`claimed`, `assigned_by_admin`, `dropped`, `reassigned`).
   - Foreign key protection: `ON DELETE RESTRICT` on both `slot_duty_id` and `member_id` to guarantee the 12-month data retention invariant.
   - Partial unique index `trip_duty_assignments_active_unique` enforces that a member cannot hold multiple active claims on the same duty.
   - Concurrency-safe claiming via PL/pgSQL RPC with row-level locking (`FOR UPDATE`).
2. **`public.trip_driver_credits`**:
   - Stores administrator-approved driver workload credits (numeric 0.1 to 5.0, default 1.0).
   - Unique on `(trip_id, member_id)`.
3. **Transactional RPCs**:
   - `phase3_claim_duty`: Checks active account status, confirmed attendee status (`coming`), soft-disabled slots/duties, existing duty claim, and capacity limits with row-level locks. Supports overlap detection for same-time-block duties with explicit acknowledgment.
   - `phase3_drop_duty`: Allows the claiming member or an administrator to release a duty while preserving historical assignment and reason in audit events.
   - `phase3_admin_assign_duty`: Allows administrators to assign confirmed attendees to open duties.
   - `phase3_admin_reassign_duty`: Allows administrators to reassign a duty from one member to another.
   - `phase3_admin_set_driver_credit`: Allows administrators to approve or revoke driver workload credits.
   - `phase3_get_member_quota_progress`: Calculates a camper's duty workload points plus approved driver credits against the trip's quota target.

### B. Backend Edge Function Actions (`trip-api/index.ts`)
- **`get_trip_task_matrix`**: Reads enabled time slots, duties, active assignments with member display names, approved driver credits, confirmed attendees roster, and current member's quota progress.
- **Mutating Actions**: `claim_duty`, `drop_duty`, `admin_assign_duty`, `admin_reassign_duty`, and `admin_set_driver_credit` with Zod schema validation, administrator authorization guards, and idempotency key enforcement.

### C. Frontend Member Experience (`TripTasksAndMealsTab.tsx` & `EventDetailsPage.tsx`)
- **5th Tab**: "Tasks & Meals" tab added to the Event Details page.
- **Trip Responsibility Quota Banner**: Displays progress as *"X of Y responsibilities selected (Target reached)"* or *"X of Y responsibilities selected"* without incorrectly claiming tasks are "completed" before the trip.
- **Driver Credits Card**: Displays approved driver workload credits with carpool notes and an administrator grant modal.
- **Chronological Date Matrix**: Time slots grouped chronologically with meal/chore badges, volunteer rosters, open spots counter, and responsive action buttons.
- **Schedule Overlap Warning Modal**: Prompts the camper if they attempt to volunteer for two duties occurring in the same time block.

---

## 2. Test Verification & Evidence

| Test Suite | Result | Details |
| :--- | :--- | :--- |
| **Database pgTAP (`npm run test:db`)** | **PASS (100%)** | 13 of 13 test files passed, 289 of 289 tests passed (including 28 tests in `phase13_duty_assignments_and_driver_credits.sql`) |
| **Frontend Unit & Component (`npm test`)** | **PASS (100%)** | 19 of 19 test files passed, 150 of 150 tests passed (including 7 new tests in `TripTasksAndMealsTab.test.tsx`) |
| **TypeScript Typecheck (`npm run typecheck`)** | **PASS** | 0 errors across frontend and Edge Functions |
| **Production Build (`npm run build`)** | **PASS** | Vite production bundle built cleanly in 153ms |

---

## 3. Concurrency & Security Verifications

1. **Transactional Row Locking**: In `phase3_claim_duty`, `SELECT * INTO v_duty FROM public.trip_slot_duties WHERE id = p_slot_duty_id FOR UPDATE` serializes concurrent claims to ensure capacity is never exceeded.
2. **Duplicate Claim Rejection**: Verified by pgTAP test 9 (`23505` unique violation).
3. **Full Capacity Guard**: Verified by pgTAP test 10 (`23514` check violation).
4. **Attendance Guard**: Members who are Not Going, waitlisted, or unconfirmed are blocked by pgTAP test 6 (`42501` unauthorized).
5. **Direct Client Write Rejection**: Direct INSERT into `trip_duty_assignments` by authenticated role is denied by RLS (pgTAP test 5).
6. **Audit Trail**: Every claim, drop, admin assignment, and driver credit approval logs an immutable event in `audit_events`.
