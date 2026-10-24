# Activity UX, Booking URL & Pairing Enhancements Plan

## Overview
Based on user feedback, this plan implements:
1. **Dedicated Booking / Signup URL (`booking_url`)**: First-class support for Groupon/operator booking links across schema, RPCs, Edge Functions, Master Catalog UI, and Trip Activities UI.
2. **Overview Page Enhancements**:
   - Make Scorecard Item #5 ("Signature Activity") a clickable link that switches to the `🎯 Activities` tab.
   - Add a compact Activity Card directly after the Trip Readiness Scorecard and before the RSVP Actions card (thumbnail on left, 3 lines on right: Title, Schedule, Address, plus direct booking and pairings buttons).
3. **Participant-Focused Activities View**:
   - Non-admin campers ONLY see their assigned vehicle card (with their partner's name, voucher entry button, and swap request button), or an unassigned status card if not yet paired.
   - Prominent "🎟️ Buy on Groupon / Booking Link" button right on the activity banner so campers know where to sign up.
4. **Admin Multi-Vehicle Management**:
   - `+ Add Vehicle` button to create additional vehicle groups directly without needing Auto-Shuffle.
   - `Assign Campers` modal on each vehicle allowing the admin to manually select 2 attending campers from dropdowns.
   - `Delete Vehicle` button for empty/unused vehicles.

---

## Tasks

### Task 1: Database Migration & RPCs for `booking_url` & Vehicle Management
- Create migration `20261024010000_add_activity_booking_url.sql`:
  - Add `booking_url TEXT` to `public.master_activities` and `public.trip_activities`.
  - Update `phase6_manage_master_activity` and `phase6_manage_trip_activity` to accept and persist `booking_url`.
  - Update `phase6_manage_activity_pairings` to support action `'create_group'` with custom or auto-incremented group numbers, and `'assign_members'` for directly setting a vehicle's campers.
- Add pgTAP tests in `supabase/tests/phase20_activity_booking_url_and_pairing_rpc.sql`.

### Task 2: Edge Functions (`trip-api`) API Updates
- Update `supabase/functions/trip-api/index.ts`:
  - Add `bookingUrl: optionalUrl` to `admin_manage_master_activity` and `admin_manage_trip_activity` Zod schemas.
  - Return `booking_url` in `get_trip_activities` and `get_master_catalogs`.
  - Support `admin_manage_activity_pairings` action `'create_group'` and `'set_group_members'`.
- Verify tests in `supabase/functions/trip-api/activities.test.mjs`.

### Task 3: Overview Page Scorecard Link & Compact Activity Card
- In `frontend/src/features/trips/EventDetailsPage.tsx`:
  - Item #5 in `RequiredFromYou` becomes a clickable element with pointer cursor calling `setTab("activities")`.
  - Add the Compact Activity Card between the Scorecard and RSVP section:
    - Small thumbnail on left (`summary-thumb`, object-cover, rounded corners).
    - Line 1: Activity Title (clickable to activities tab) + Category pill.
    - Line 2: `📅 <Date> • <StartTime> – <EndTime>`.
    - Line 3: `📍 <LocationName / Address>`.
    - Action buttons: `[View Activity & Pairings →]` (switches tab to activities) and `[🎟️ Buy on Groupon / Booking Link →]` (opens `booking_url` in new tab).
- Update unit tests in `EventDetailsPage.test.tsx`.

### Task 4: Participant Focused Vehicle View & Signup Button
- In `frontend/src/features/trips/TripActivitiesTab.tsx`:
  - Add prominent `🎟️ Buy Voucher on Groupon` button to the activity hero header.
  - For non-admin participants:
    - If assigned to a vehicle, filter and display ONLY their assigned vehicle card (with their partner's name, `+ Enter Voucher Details` and `⇄ Request Swap`).
    - If confirmed attending but unassigned, display a friendly status card: *"🚗 You are confirmed for this tour! The trip organizer will assign your vehicle shortly."*
    - If opted out, display the opted-out status banner.
  - Ensure assigned campers have voucher entry and partner swap buttons working cleanly.
- Update unit tests in `TripActivitiesTab.test.tsx`.

### Task 5: Admin Multi-Vehicle Controls & Manual Assignment Modal
- In `frontend/src/features/trips/TripActivitiesTab.tsx`:
  - Add `+ Add Vehicle` button in the Admin toolbar (calls `admin_manage_activity_pairings` with action `'create_group'`).
  - Add `Assign Campers` modal:
    - Lists dropdowns for Slot 1 and Slot 2 populated with all attending campers.
    - Calls `admin_manage_activity_pairings` to assign selected campers to that specific group.
  - Add `Delete Vehicle` button to remove a vehicle group.
  - Add `Booking / Signup URL (e.g. Groupon)` field to Master Catalog Add/Edit modal and Trip Activity Add/Edit modal.
- Update unit tests in `TripActivitiesTab.test.tsx` and `MasterActivitiesTab.test.tsx`.

### Task 6: Multi-Browser E2E Verification & Deployment
- Update `e2e/trip-activities.spec.ts` to test:
  - Creating activity with `booking_url`.
  - Viewing compact activity card on overview and clicking through to activities tab.
  - Admin adding Vehicle #2 and manually assigning members.
  - Participant seeing ONLY their assigned vehicle card and entering voucher details.
  - Running multi-browser Playwright test (`node scripts/run-e2e.mjs e2e/trip-activities.spec.ts`).
  - Running `npm run verify`.
- Push to remote `origin/main` (`git push origin main`) and deploy to production (`npm run deploy:prod`).
