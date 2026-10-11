# Camping Club Enhancements A–E — Remediated Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver enhanced RSVP confirmation, master responsibilities directory, candidate meal & chore time-slot matrix, volunteer tasks tab with driver credits, scheduled contractual cutoff safeguards, and a private backend notification outbox with reliable transactional delivery.

**Architecture:** 
- Frontend: React 19 + TypeScript 5.8 + Vite responsive web application deployed as a Render Static Site.
- Database & Backend: Supabase PostgreSQL with strict Row Level Security (RLS), SECURITY DEFINER transactional functions in private schemas, and Supabase Edge Functions with Zod schema validation.
- Concurrency & Storage: Concurrency-safe first-come volunteer claiming with `FOR UPDATE` locking, integer cent financial amounts, and 12-month data retention for duty assignments (`ON DELETE RESTRICT`).
- Financial Integrity: Canonical append-only cabin contribution model (`cabin_contributions` and `cabin_contribution_events`). RSVP checkbox appends a `sent` assertion event; recipient/admin verifies via an audited `received` event. No mutable financial fields in `trip_rsvps`.
- Notifications: Non-exposed `private.notification_outbox` and `private.notification_delivery_attempts` with worker leasing (`FOR UPDATE SKIP LOCKED`), crash recovery, idempotency keys, exponential backoff, and reliable HTTPS transactional provider adapter (with SMTP fallback).

**Tech Stack:** React 19, TypeScript 5.8, Vite, Supabase Auth/Postgres, Deno (Edge Functions), Zod 3, pgTAP (DB tests), Vitest (UI tests).

---

## 1. Schema Compatibility Matrix

Inspected against deployed migrations (Phase 1, Phase 2, UI/UX migrations) and `docs/DATABASE_SCHEMA.md`:

| Object Name | Schema | Operation | Source in Docs / Repo | Details & Compatibility Invariants |
| :--- | :--- | :--- | :--- | :--- |
| `master_responsibilities` | `public` | **CREATE** | Replaces unmigrated `trip_responsibility_definitions` | Reusable directory of tasks (prep, cook, clean, activity, driver, other) with weights, default capacity, active/retired flag. `ON DELETE RESTRICT` protects historical assignments. |
| `trip_time_slots` | `public` | **CREATE** | Reconciles unmigrated `trip_meal_slots` | Replaces single-meal concept with flexible time slots (`slot_date`, `time_block`, `label`, `is_enabled`, `sort_order`). Allows multiple chores and multiple meal tasks per date/time. |
| `trip_slot_duties` | `public` | **CREATE** | Replaces unmigrated `trip_responsibility_slots` | Attaches `master_responsibilities` to `trip_time_slots` with capacity. Soft-disabled via `is_active` rather than cascading deletes. |
| `trip_duty_assignments` | `public` | **CREATE** | Reconciles `responsibility_assignments` | Records volunteer claim/drop, driver credit (`driver_credit`), `assigned_by`, and `assigned_at`. Foreign key `ON DELETE RESTRICT` enforces 12-month retention. |
| `trip_rsvps` | `public` | **REUSE / UNCHANGED** | Deployed in Phase 2 | **No financial columns added.** Preserves clean binary RSVP (`coming` / `not_coming`) and immutable `rule_acknowledgment_id`. |
| `camping_trips` | `public` | **ALTER** | Deployed in Phase 2 | Add `deposit_amount_cents bigint default 5000`, `contractual_refund_deadline date`, `cancellation_safety_buffer_days int default 5`, `task_quota_target int default 2`, `task_quota_max int`. |
| `cabin_contributions` | `public` | **CREATE** | `DATABASE_SCHEMA.md:96` | Canonical obligation fact: `trip_id`, `member_id`, `amount_due_cents`, `recipient_assignment_id`. Unique(`trip_id`, `member_id`). |
| `cabin_contribution_events` | `public` | **CREATE** | `DATABASE_SCHEMA.md:97` | Append-only events: `event_type` (`sent` = member assertion, `received` = verified receipt, `booking_coverage_acknowledged`, `refund_sent`, `refund_received`), `amount_cents`, `actor_id`, `occurred_at`. |
| `cabin_reservations` | `public` | **CREATE** | `DATABASE_SCHEMA.md:93` | Tracks cabin booking reference, contractual deadline, safety buffer, and provider cancellation status independently from club trip lifecycle. |
| `private.notification_outbox` | `private` | **CREATE** | `DATABASE_SCHEMA.md:104`, `STATE_PERSISTENCE_MATRIX.md:25` | Private non-Data-API table: `event_type`, `recipient_email`, `payload`, `idempotency_key`, `status` (`queued`, `leased`, `sent`, `failed`), `lease_expires_at`, `worker_id`. |
| `private.notification_delivery_attempts` | `private` | **CREATE** | `DATABASE_SCHEMA.md:104` | Immutable attempt audit: `outbox_id`, `attempt_no`, `worker_id`, `status`, `provider_message_id`, `error_details`, `occurred_at`. |
| `trip_admin_action_audit` | `public` | **CREATE** | `STATE_MACHINES.md:120` | Immutable audit log for early confirmations, overrides, cancellations, and reinstatements. |

---

## 2. Financial Model Reconciliation

### Preserving Canonical Accounting Architecture
1. **Separation of Concerns**:
   - `trip_rsvps`: Tracks participation intent (`coming` vs `not_coming`) and exact immutable Constitution rule bundle acknowledgment (`rule_acknowledgment_id`).
   - `cabin_contributions`: Canonical table tracking the financial obligation for confirmed trips.
   - `cabin_contribution_events`: Append-only event log for all money movement and assertions:
     - Member checking *"I have sent my deposit"* in the RSVP modal triggers a `sent` event (`actor_id = member_id`, `amount_cents = deposit_amount_cents`). This is an unverified assertion.
     - Assigned cabin payer or administrator confirming payment triggers a `received` event (`actor_id = admin_or_payer_id`, `amount_cents = verified_cents`).
2. **Reconciliation with Owner Decisions**:
   - **OD-01**: Minimum four calculation remains guarded. The minimum basis is not chosen here; neither basis is forced.
   - **OD-02**: Attending cabin payer's booking coverage posts as a non-posting marker (`booking_coverage_acknowledged`), never double-counted.
   - **OD-06**: Any premature/extra receipts remain unresolved pending owner policy.
   - **Configurable Deposit Policy**: `camping_trips.deposit_amount_cents` defaults to `5000` ($50). It reflects versioned trip policy at creation time. Changing it on a trip never retroactively modifies existing `cabin_contributions` or prior trip events.

---

## 3. Meal & Chore Slot Architecture (Resolving Issue 3)

### Multi-Duty, Multi-Chore Time-Slot Structure
Rather than constraining `trip_meal_slots` to `unique(trip_id, slot_date, meal_type)`, we decouple **Time Slots** from **Responsibilities**:

```
[trip_time_slots]
  id: uuid
  trip_id: uuid
  slot_date: date (e.g. 2026-11-13)
  time_block: text ('friday_evening', 'friday_dinner', 'saturday_morning', 'saturday_lunch', 'saturday_dinner', 'sunday_morning')
  label: text ('Friday Dinner', 'Friday Evening Campfire & Setup', 'Saturday Morning Cleanup')
  is_enabled: boolean (default true)
  sort_order: integer
       │
       ▼ (1 : N)
[trip_slot_duties]
  id: uuid
  time_slot_id: uuid references trip_time_slots(id)
  master_responsibility_id: uuid references master_responsibilities(id)
  capacity: integer (e.g. 2)
  is_active: boolean (default true)
       │
       ▼ (1 : N)
[trip_duty_assignments]
  id: uuid
  slot_duty_id: uuid references trip_slot_duties(id) on delete restrict
  member_id: uuid references member_profiles(member_id) on delete restrict
  driver_credit: boolean (default false)
  assigned_by: uuid references member_profiles(member_id)
  assigned_at: timestamptz
```

**Benefits**:
- Friday Evening can have `Campfire Setup` (2) AND `Vegetable Chopping` (2).
- Friday Dinner can have `Dinner Cook` (2) AND `Dishes & Cleanup` (2).
- Sunday Morning can have multiple separate general chores (`Cabin Cleanup`, `Vehicle Loading`, `Trash Disposal`).
- Disabling a slot or duty sets `is_enabled = false` / `is_active = false`. Existing `trip_duty_assignments` are preserved for 12 months for dispute/audit integrity (`ON DELETE RESTRICT`).

---

## 4. Responsibility Quota Semantics (Resolving Issue 4)

- **Default Minimum Target**: `2` responsibilities per attending member (configurable per trip via `camping_trips.task_quota_target`).
- **Optional Maximum**: Configurable via `camping_trips.task_quota_max` (defaults to null = no hard cap).
- **Driver Workload Credit**: Approved drivers receive workload credit equal to the driver template weight (default 1.0 or 2.0). If a driver template weight is 2.0 and quota target is 2, the driver's quota is automatically satisfied!
- **Non-Blocking Invariant**: Full responsibility slots NEVER block an RSVP from completing. If all slots are full, attendees remain confirmed Coming and can be assigned by administrators or assist with general camp tasks.
- **UI Copy Standard**: The UI displays *"1 of 2 responsibilities selected"* or *"2 of 2 responsibilities selected (Target reached)"*. It does **NOT** display *"completed"* before the camping trip has occurred.

---

## 5. Cutoff Automation & Audited Safeguards (Resolving Issue 5)

### Contractual Deadline Calculation & Safeguard Logic
```
Cutoff = LEAST(
  starts_on - INTERVAL '35 days',
  contractual_refund_deadline - (safety_buffer_days * INTERVAL '1 day')
)
```
Interpreted strictly within club timezone `America/Los_Angeles` (per OD direction 2026-10-08).

### Scheduled Cutoff Processor (`process_trip_cutoffs`)
- Runs via Supabase Cron / Edge Function every 5 minutes.
- Idempotent and catch-up safe: scans all trips in `registration_open` where `now() >= calculated_cutoff`.
- If trip participation is below threshold (under approved basis):
  - Transition trip to `cancelled_insufficient_participants`.
  - Transactionally enqueue cancellation notices to `private.notification_outbox`.
  - Record provider booking cancellation alert in `cabin_reservations` (`status = 'cancellation_requested'`).
- If threshold is met:
  - Transition trip to `confirmed`.
  - Transactionally enqueue confirmation notices with deposit payment instructions.

### Audited Administrative Overrides
Early confirmation, cancellation, minimum overrides, and reinstatement are guarded by strict checks:
1. `admin_confirm_trip_early`:
   - Requires explicit non-empty `reason`.
   - Records current count and count basis.
   - Verifies cabin booking status in `cabin_reservations`.
   - Requires second confirmation flag (`confirm_minimum_override: true`) if active count is below threshold.
   - Appends immutable record to `trip_admin_action_audit`.
2. `admin_reinstate_trip`:
   - Admin-only action. Requires fresh cabin availability verification and explicit audit reason.

---

## 6. Private Notification Outbox Architecture (Resolving Issue 6)

### Outbox Schema & Worker Leasing
Protected in non-exposed `private` schema. No Data API access.

```sql
create table private.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  recipient_email text not null,
  recipient_name text,
  subject text not null,
  body_text text not null,
  body_html text,
  idempotency_key text not null unique,
  status text not null default 'queued' check (status in ('queued','leased','sent','delivered','bounced','failed')),
  attempts integer not null default 0,
  leased_at timestamptz,
  lease_expires_at timestamptz,
  worker_id text,
  last_error text,
  next_retry_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create table private.notification_delivery_attempts (
  id uuid primary key default gen_random_uuid(),
  outbox_id uuid not null references private.notification_outbox(id) on delete cascade,
  attempt_no integer not null,
  worker_id text not null,
  status text not null,
  provider_message_id text,
  error_details text,
  occurred_at timestamptz not null default now()
);
```

### Worker Lease & Delivery Transport
- **Lease Mechanism**: Worker queries `WHERE status in ('queued','failed') AND next_retry_at <= now() AND (lease_expires_at is null OR lease_expires_at < now()) FOR UPDATE SKIP LOCKED` and sets `status = 'leased'`, `lease_expires_at = now() + interval '5 minutes'`. This ensures crash-safe recovery if an Edge Function execution terminates abruptly.
- **Provider Adapter**:
  - Primary transport: HTTPS API adapter (Resend / SendGrid / standard transactional provider) configured via Edge Function secrets. This eliminates raw TCP SMTP port blocking and TLS socket instability in serverless runtimes.
  - Fallback: Standard SMTP transport using Deno SMTP library where network permits.
  - No credentials or provider keys exposed to frontend bundles.

---

## 7. Dependency-Corrected Implementation Sequence

```
Phase 0: Compatibility & Architecture Reconciliation
  ├── Inspect existing tables and apply schema compatibility matrix
  └── Validate RLS & private schema boundaries

Phase A: Master Responsibilities Directory
  ├── Task 1: Migration for master_responsibilities & seed templates
  ├── Task 2: Edge Function trip-api actions for master directory
  └── Task 3: Admin UI: MasterResponsibilitiesPage & navigation

Phase B: Meal & Chore Time-Slots Matrix
  ├── Task 4: Migration for trip_time_slots & trip_slot_duties
  ├── Task 5: Candidate slot generator based on trip dates
  ├── Task 6: Edge Function actions with volunteer protection guards
  └── Task 7: Admin UI: Time Slot & Duty Manager modal

Phase C: Volunteering & Tasks Tab
  ├── Task 8: Migration for trip_duty_assignments & concurrency claims
  ├── Task 9: Driver credit & quota progress tracking
  ├── Task 10: Edge Function actions (claim, drop, assign)
  └── Task 11: Frontend UI: Tasks & Meals 5th tab on Event Details

Phase D: Canonical RSVP Confirmation & Deposit Assertion
  ├── Task 12: Migration for cabin_contributions & cabin_contribution_events
  ├── Task 13: Edge Function submit_rsvp (payment-sent assertion event)
  ├── Task 14: Edge Function admin_verify_deposit (receipt event)
  └── Task 15: Frontend UI: Accessible RSVP modal (left checkbox, deposit assertion)

Phase E: Private Notification Outbox Architecture
  ├── Task 16: Migration for private.notification_outbox & delivery attempts
  └── Task 17: Database enqueue helper (enqueue_notification)

Phase F: Trip Cutoff Automation & Scheduled Processor
  ├── Task 18: Migration for cutoff calculation & cabin_reservations
  ├── Task 19: Scheduled processor function process_trip_cutoffs
  └── Task 20: Audited admin actions (confirm early, cancel, reinstate)

Phase G: Notification Delivery Worker & HTTPS/SMTP Adapter
  ├── Task 21: Edge Function notify-dispatcher with worker lease & retries
  └── Task 22: HTTPS provider adapter & delivery status updates

Phase H: Full Certification & Hosted Staging Acceptance Tests
  ├── Task 23: Complete migration compatibility test against Phase 2 schema
  ├── Task 24: Hosted staging acceptance test execution (14 scenarios)
  └── Task 25: Comprehensive certification report & gate sign-off
```

---

## 8. Hosted Staging Acceptance Matrix (14 Scenarios)

| # | Test Scenario | Steps | Expected Result | Gate |
| :--- | :--- | :--- | :--- | :--- |
| **S-01** | Member clicks Yes | Click "Going" on trip event card | RSVP modal opens showing exact applicable Constitution bundle | Phase D |
| **S-02** | Unacknowledged rules | Attempt submit without checking Constitution acknowledgment | Submission blocked. Checkbox highlighted on left. | Phase D |
| **S-03** | Rules acknowledged | Check box and submit Going | RSVP succeeds. Exact immutable bundle ID & version hash recorded in `trip_rsvps`. | Phase D |
| **S-04** | Deposit sent assertion | Check "I have sent my deposit" during RSVP | Append-only `sent` event recorded in `cabin_contribution_events`. `trip_rsvps` remains unpolluted. | Phase D |
| **S-05** | Admin confirms deposit | Admin reviews payment and clicks "Verify Receipt" | Append-only `received` event recorded in `cabin_contribution_events`. Status badge shows "Verified". | Phase D |
| **S-06** | Master task directory | Admin creates and edits master tasks in `/admin/responsibilities` | Templates appear in directory with weight and capacity; retired tasks remain visible in past trips. | Phase A |
| **S-07** | Candidate slot generation | Create trip for Fri–Sun | Friday Dinner, Saturday Breakfast/Lunch/Dinner, Sunday Breakfast/Cleanup candidate slots generated. | Phase B |
| **S-08** | Multi-chore slot support | Admin adds both "Dinner Cook" and "Dishes" to Friday Dinner | Both duties coexist on the same time slot with independent volunteer capacities. | Phase B |
| **S-09** | Concurrent task claiming | 2 members claim the final open spot simultaneously | Exactly 1 member succeeds; 2nd member receives `task_capacity_reached` without blocking their RSVP. | Phase C |
| **S-10** | Volunteer withdraws from task | Member clicks "Drop Task" | Assignment removed; spot immediately becomes open for other attendees. | Phase C |
| **S-11** | Driver workload credit | Member assigned as driver with weight 2.0 | Progress indicator updates to "2 of 2 responsibilities selected (Target reached)". | Phase C |
| **S-12** | Admin disables assigned slot | Admin attempts to disable a slot with volunteer assignments | Warning modal requires explicit confirmation. History preserved with `is_enabled = false`. | Phase B |
| **S-13** | Cutoff deadline automated processing | Simulate cutoff time reached via scheduled processor | Evaluates LEAST(35-day, contractual-buffer). Below minimum triggers automated cancellation & outbox notices. | Phase F |
| **S-14** | Reload & persistence journey | Full page browser reload after all interactions | Saved RSVPs, rule acknowledgments, deposit events, meal slots, and task assignments reload identically. | Phase H |

---

## 9. Remaining Owner Decisions Register Check

- **OD-01 (Minimum Participation Basis)**: Stays **PENDING**. The plan does not force `coming_rsvp` or `received_contribution`. Registration cutoff checks use the configured trip basis or fail-safe.
- **OD-02 (Cabin Payer Vendor Coverage)**: Stays **PENDING**. Vendor coverage is marked via non-posting `booking_coverage_acknowledged`.
- **OD-06 (Unresolved Receipts on Cancellation)**: Stays **PENDING**. Funds received remain unapplied in immutable event logs; financial close remains blocked pending owner disposition.
- **OD-08 (Withdrawn Member Contribution)**: Stays **PENDING**. Remains recorded and non-refundable to member, but unapplied to group accounting pending owner allocation policy.

---

## 10. Readiness Assessment

**Assessment:** **PASS** (Ready for Phase 0 / Phase A authorization upon owner review).
- All 6 architectural issues resolved.
- Existing database tables inspected and protected.
- Canonical financial architecture preserved with append-only events.
- Time slots decoupled from multi-duty chores.
- Private outbox architecture specified with crash-safe leasing.

Please review this remediated plan and indicate if you authorize proceeding with **Phase A** implementation on branch `feature/responsibilities-meals-matrix`.
