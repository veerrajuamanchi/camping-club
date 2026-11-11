# Customizable Trip Briefing Email Sections, Carpool Meeting Details & Activity Vehicle Pairings

## Overview
Allows the administrator to customize which sections are included in the Trip Briefing Email dispatch modal via checkboxes. The email includes standard trip header details (title, dates, location), with selectable sections:
1. **Who's Coming (Confirmed Attendees)** (Default: Checked)
2. **Carpools & Transit** (Default: Checked, enhanced with Meeting Time and Meeting Location)
3. **Activity Pool Vehicle Pairings** (Default: Checked, showing vehicle/group pairings clean like carpool without voucher/purchaser clutter)
4. **Trip Commitments & Supplies** (Default: Unchecked)
5. **Activity Vouchers & Order Codes** (Default: Unchecked)

Also enhances Carpools with optional `meeting_time` and `meeting_location` fields in the database schema, RPC, and UI.
Deploys to both Staging (`rwmizunhxszjvcsaqkre`) and Production (`kdxmwqxlhswcgwanlump`).

---

## Proposed Changes

### 1. Database Migration
File: `supabase/migrations/20261110000000_carpool_meeting_details.sql`
- Add `meeting_time TEXT` and `meeting_location TEXT` columns to `public.trip_carpools`.
- Update `public.phase4_manage_carpool` RPC to accept `p_meeting_time TEXT DEFAULT NULL` and `p_meeting_location TEXT DEFAULT NULL` and persist them during `admin_create_carpool` and `admin_update_carpool`.

### 2. Backend Edge Function: `trip-api`
File: `supabase/functions/trip-api/index.ts`
- Update `actionSchemas.admin_manage_carpool`:
  - `meetingTime: z.string().max(100).nullable().optional()`
  - `meetingLocation: z.string().max(200).nullable().optional()`
- Pass `p_meeting_time` and `p_meeting_location` in `rpcArgs` for `admin_manage_carpool`.
- Update `actionSchemas.admin_send_trip_summary_email`:
  - `sections: z.object({ whosComing: z.boolean().optional(), carpools: z.boolean().optional(), activityPairings: z.boolean().optional(), commitments: z.boolean().optional(), activityVouchers: z.boolean().optional() }).optional()`
- Update `sendTripSummaryEmail(authUser, tripId, recipientType, sections)`:
  - Query `meeting_time` and `meeting_location` in `trip_carpools` query.
  - Query `unit_label` and `address` in `trip_activities` query.
  - Format Carpools to clearly highlight `⏰ Meeting Time` and `📍 Meeting Location` if present.
  - Create new `activityPairingsHtml` displaying vehicle/unit pairings (e.g. `🏎️ GoCar #1: Harish, Veerraju Amanchi`) cleanly like carpools.
  - Conditionally include sections based on `selectedSections`:
    - `whosComing`: default `true`
    - `carpools`: default `true`
    - `activityPairings`: default `true`
    - `commitments`: default `false`
    - `activityVouchers`: default `false`

### 3. Frontend: Carpools Meeting Details
File: `frontend/src/features/trips/TripLogisticsTab.tsx`
- Add `meetingTime` and `meetingLocation` to `TripCarpool` type.
- Add form inputs for `Meeting Time` and `Meeting Location` in Add/Edit Carpool modal.
- Display `Meeting Time` and `Meeting Location` in Carpool card.

### 4. Frontend: Email Modal Section Selection
File: `frontend/src/features/trips/EventDetailsPage.tsx`
- Replace static "Included Sections" text in `showEmailModal` with interactive checkboxes:
  - `[x] Who's Coming (Confirmed Attendees)`
  - `[x] Carpools & Transit`
  - `[x] Activity Pool Vehicle Pairings`
  - `[ ] Trip Commitments & Supplies`
  - `[ ] Activity Vouchers & Order Codes`
- Pass `sections` object in `api("admin_send_trip_summary_email", { tripId, recipientType, sections })`.

### 5. Automated Verification
- Unit & component tests:
  - `frontend/src/features/trips/EventDetailsPage.test.tsx`
  - `frontend/src/features/trips/TripLogisticsTab.test.tsx`
- Typecheck & test suite (`npm run typecheck`, `npm test`).

### 6. Deployment to Staging and Production
- Run migration and deploy Edge Functions to Staging:
  - `npx supabase db push --project-ref rwmizunhxszjvcsaqkre`
  - `npx supabase functions deploy trip-api --project-ref rwmizunhxszjvcsaqkre --import-map supabase/functions/deno.json --use-api`
- Run migration and deploy Edge Functions to Production:
  - `npx supabase db push --project-ref kdxmwqxlhswcgwanlump`
  - `npx supabase functions deploy trip-api --project-ref kdxmwqxlhswcgwanlump --import-map supabase/functions/deno.json --use-api`
- Commit & push to `main` branch to trigger Render auto-deploy for frontend.
