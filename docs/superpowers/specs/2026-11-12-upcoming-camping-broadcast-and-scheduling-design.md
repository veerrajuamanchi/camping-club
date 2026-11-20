# Upcoming Camping Broadcast Email & Scheduling Design

**Date:** 2026-11-12  
**Status:** In Review  
**Topic:** Admin Broadcast Email for Upcoming Campings with Immediate Dispatch & Scheduling  

---

## 1. Intent & The Why

Administrators need a fast, dependable way to broadcast upcoming camping trip reminders and recruitment announcements to the entire active club membership—not just already-confirmed attendees. This drives RSVP awareness, informs members of available spots before cutoff, and allows administrators to share custom trip context (e.g. highlights of activities, coastal hiking, weather tips).

Furthermore, while immediate manual sending is the default workflow, administrators require the flexibility to schedule announcements ahead of time (e.g. setting an announcement to go out two days prior to an RSVP deadline without needing to be online at that exact moment).

---

## 2. Goals, Non-Goals & Anti-Goals

### Goals
- **Full Club Reach**: Send an upcoming trip announcement to all active, confirmed members of the private camping club.
- **Automated Trip Summary**: Automatically assemble key trip facts: campsite name and address, trip dates, confirmation status, cabin booking capacity, current confirmed attendee count, remaining spots, and the structured RSVP deadline.
- **Custom Context Note**: Provide an editable message field for organizers to include tailored trip context, excitement, or specific guidance.
- **Flexible Delivery Timing**:
  - **Manual / Send Immediately (Default)**: Dispatches the email to all active members immediately.
  - **Scheduled Delivery**: Allows specifying a future date and time for automated dispatch.
- **Side-by-Side Live Preview**: Render a live HTML preview of the email directly in the composer modal so the administrator sees the exact email campers will receive before sending or scheduling.
- **Scheduled Management**: Enable administrators to view scheduled announcements for a trip and cancel/unschedule pending ones if plans change.

### Non-Goals
- Replacing the existing **Trip Briefing Email** (`admin_send_trip_summary_email`), which is an operational checklist (carpools, chores, meals, shared gear) sent strictly to confirmed attendees right before departure.
- Allowing members to unsubscribe from essential official club trip announcements (all active members receive official trip notices).
- Creating an external email newsletter marketing suite (no unauthenticated drip campaigns or public mailing lists).

### Anti-Goals
- No silent failures: scheduled or immediate emails must record clear delivery status (`sent`, `scheduled`, `cancelled`, `failed`) and recipient counts.
- No direct client-side email dispatch: browser bundles must never contact mail servers or possess provider credentials; all dispatches run through the trusted `trip-api` Supabase Edge Function.
- No dependency on web traffic for scheduled dispatches: overdue scheduled announcements must be processable via cron / background catch-up jobs.

---

## 3. Constraints & Guardrails

1. **Security & Authorization**:
   - Only authenticated members with `member_role = 'admin'` may compose, dispatch, schedule, or cancel trip announcements.
   - All database tables enforce Row Level Security (RLS) with explicit grants.
2. **Mail Dispatch Architecture & Privacy**:
   - Dispatches use the established `_shared/mailer.ts` infrastructure (Gmail SMTP via `nodemailer` with Resend fallback).
   - Recipient emails are resolved securely server-side from `auth.users` via `service.auth.admin.listUsers()` matched against active `member_profiles`.
   - **Member Privacy**: Full club broadcasts place active member email addresses in the **`Bcc:`** header (chunked to a maximum of 50 recipients per batch) with the sender in `To:` to prevent exposing private email addresses and eliminate accidental reply-all storms.
3. **Environment & Reliability**:
   - Frontend is deployed on Render Static Sites; production database and functions are on Supabase (`kdxmwqxlhswcgwanlump`).
   - Scheduled jobs run idempotently. A scheduled announcement has a unique status state machine (`scheduled` -> `processing` -> `sent` / `cancelled` / `failed`) with an optimistic transactional claim (`status = 'processing'`) so it is never delivered twice.
   - **Trip Lifecycle Guards**: When a scheduled announcement fires, if the trip has since been cancelled or archived, the dispatch automatically aborts and transitions to `cancelled` with reason `trip_cancelled_or_archived`.
   - **Dynamic Real-Time Data**: The email body is always rendered with the live database counts (actual confirmed campers, capacity, remaining spots) at the exact moment of dispatch.
   - **Scheduler Authorization**: The due announcements processor accepts requests authorized either by an active administrator session or an internal `x-scheduler-secret` header matching `Deno.env.get("SCHEDULER_SECRET")`.

---

## 4. User Experience & Workflow

### 4.1 Launching the Broadcast Composer
On the **Event Details Page** (`frontend/src/features/trips/EventDetailsPage.tsx`) and **Trip Hub**, administrators will see a dedicated action button:
`📢 Broadcast Trip Reminder` (placed alongside the existing `📧 Send Briefing Email` button).

### 4.2 Composer Modal
Clicking the button opens the **Trip Announcement Broadcast Modal**:
1. **Audience Badge**: Clearly indicates `👥 All Active Club Members (X members)` and explains that all active club members will receive this notification.
2. **Subject Line**: Pre-filled with a dynamic, informative subject:
   `🏕️ Reminder: [Trip Title] ([Dates]) - [N] Spots Left!` (or `Trip Confirmed` if full). Fully editable by admin.
3. **Custom Context Note**: Textarea pre-filled with an inspiring message (e.g. *"Monterey is always a fantastic destination, and we're looking forward to another great weekend of camping, hiking, campfire conversations, and enjoying the coast together."*). Admin can edit, expand, or clear this.
4. **Delivery Timing Switch**:
   - **Send Immediately (Default)**: Primary action button labeled `🚀 Send Broadcast Email Now`.
   - **Schedule for Later**: Reveals a date/time picker defaulted to local time (e.g. 24 hours prior to RSVP deadline). Primary action button changes to `⏰ Schedule Broadcast`.
5. **Live Email Preview Panel**:
   - On desktop, displayed side-by-side with the composer controls.
   - On mobile viewports, available via a "Preview Email" toggle tab or scrollable preview container.
   - Displays real-time updates as the administrator edits the subject line or custom context note.

### 4.3 Scheduled Broadcasts Queue
Within the modal (or on an expandable section below the composer):
- Lists any pending announcements for this trip (`Scheduled for Nov 12, 2026, 9:00 AM PST`).
- Provides a `❌ Cancel Schedule` action button to abort a pending dispatch.
- Displays past sent broadcast records with timestamp and recipient counts for auditability.

---

## 5. Email Template & Design

The email uses clean, responsive HTML compatible with mobile email clients (Apple Mail, Gmail, Outlook):

- **Header**: `🏕️ Private Camping Club — Upcoming Trip Reminder`
- **Greeting**: `Hello Everyone,`
- **Intro**: `Just a friendly reminder about our upcoming [Trip Title]!`
- **Custom Note Callout Box**: Light-blue styled blockquote featuring the administrator's custom message.
- **Event Details Card**:
  - **Location**: Campsite name + full street address
  - **Dates**: Formatted trip start and end dates (Pacific Time)
  - **Status**: Status badge (e.g. `✅ Confirmed`)
- **Capacity & RSVP Status Grid**:
  - **Accommodations Box**: Booked cabin count, total camper capacity.
  - **Current Attendance Box**: Confirmed attendee count, **highlighted spots remaining**.
- **RSVP Deadline Callout**:
  - Prominent amber alert box detailing exact RSVP cutoff date and time.
  - Notice explaining waitlist policy once remaining spots fill.
- **Footer**: `See you there! Happy Camping 🌲` with a direct link to the club portal event page.

---

## 6. Database Schema & State Machine

### 6.1 Table: `public.trip_announcements`

```sql
CREATE TABLE public.trip_announcements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES public.camping_trips(id) ON DELETE CASCADE,
  created_by_member_id UUID NOT NULL REFERENCES public.member_profiles(id),
  subject TEXT NOT NULL,
  custom_note TEXT,
  delivery_timing TEXT NOT NULL CHECK (delivery_timing IN ('immediate', 'scheduled')),
  scheduled_for TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'processing', 'sent', 'cancelled', 'failed')),
  is_test BOOLEAN NOT NULL DEFAULT FALSE,
  sent_at TIMESTAMPTZ,
  recipient_count INTEGER DEFAULT 0,
  recipients_snapshot JSONB,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_trip_announcements_trip ON public.trip_announcements(trip_id);
CREATE INDEX idx_trip_announcements_due ON public.trip_announcements(scheduled_for, status)
  WHERE status = 'scheduled';
```

### 6.2 Status State Transitions
```
[Immediate]  ---> 'processing' ---> 'sent' (or 'failed')
[Scheduled]  ---> 'scheduled'  ---> 'processing' ---> 'sent' (or 'failed')
                    │
                    └─── (Admin Cancel) ---> 'cancelled'
```

### 6.3 Security & RLS
- RLS enabled on `trip_announcements`.
- `SELECT`: Allowed for administrators (`auth.uid()` mapped to active admin profile).
- `INSERT`: Allowed only for administrators.
- `UPDATE`: Allowed only for administrators (for cancelling pending rows) and service role.

---

## 7. Trusted API & Edge Function Specifications

In `supabase/functions/trip-api/index.ts`:

1. **`admin_broadcast_upcoming_trip_email`**:
   - **Schema**:
     ```typescript
     admin_broadcast_upcoming_trip_email: z.object({
       tripId: z.string().uuid(),
       subject: z.string().min(5).max(200),
       customNote: z.string().max(2000).optional(),
       deliveryTiming: z.enum(["immediate", "scheduled"]).default("immediate"),
       scheduledFor: z.string().datetime().optional(), // required if scheduled
       testOnly: z.boolean().optional(), // if true, sends only to requesting admin
     })
     ```
   - **Immediate Flow**:
     - Inserts record into `trip_announcements` with `status = 'processing'`.
     - Queries all active members (`account_status = 'active'`) and auth emails.
     - Dispatches formatted HTML email via `sendEmail()`.
     - Updates record: `status = 'sent'`, `sent_at = NOW()`, `recipient_count = count`.
     - Returns `{ sent: true, recipientCount, announcementId }`.
   - **Scheduled Flow**:
     - Inserts record with `status = 'scheduled'`, `scheduled_for = scheduledFor`.
     - Returns `{ scheduled: true, scheduledFor, announcementId }`.

2. **`admin_get_trip_announcements`**:
   - Fetches announcement history and pending schedules for a `tripId`.

3. **`admin_cancel_trip_announcement`**:
   - Updates a pending announcement (`status = 'scheduled'`) to `status = 'cancelled'`.

4. **`admin_process_due_announcements`** (Catch-up / Cron Endpoint):
   - Atomically claims pending rows (`status = 'scheduled'` AND `scheduled_for <= NOW()`).
   - Dispatches emails and marks them `sent` or `failed`.
   - Exposed as an authenticated admin endpoint and runnable via Supabase cron / pg_net.

---

## 8. What's Left to the Builder (Implementation Details)

- Exact formatting helper functions for date formatting in the preview modal.
- Handling responsive layout breakdown for mobile devices in the modal (stacking settings and preview vertically).
- Graceful error messaging if SMTP credentials fail or rate limits are encountered.

---

## 9. Verification & Certification Gates

1. **Unit & Function Tests**:
   - Zod schema validation tests for `admin_broadcast_upcoming_trip_email`.
   - Email HTML renderer tests verifying subject, address, dates, spots remaining, and custom note insertion.
   - Immediate vs Scheduled state transition tests.
2. **Frontend Component Tests**:
   - Rendering modal with pre-populated subject and custom note.
   - Toggling between "Send Immediately" and "Schedule for Later".
   - Live preview updating on textarea input change.
   - Cancelling a scheduled announcement.
3. **End-to-End Build**:
   - `npm run typecheck` passes with 0 errors.
   - `npm test` passes 100% of test suites.
   - `npm run build` succeeds cleanly.
