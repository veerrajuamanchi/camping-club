# Private Camping Club Platform — Design

**Date:** 2026-10-08
**Status:** Targeted design amendment for user review
**Scope:** Full private camping coordination platform

## 1. Purpose

The application replaces scattered trip planning, attendance tracking, expense reconciliation, and payment coordination. A polls-only site would not meet the club's needs. The full product remains in scope and will be built in phases before any public launch.

The app coordinates trips and reimbursements. It does not process or transfer money. Trip photos and videos will be shared in manually created WhatsApp groups, not uploaded to the app.

## 2. Architecture

Use a modular application on one approved stack:

- **Frontend:** React, TypeScript, and Vite, deployed as a static site on Render.
- **Identity and data:** Supabase Auth and PostgreSQL, with Row Level Security (RLS).
- **Trusted operations:** Supabase Edge Functions for privileged actions; database transactions or narrowly scoped functions for atomic writes.
- **Scheduled work:** Supabase Cron invokes database functions and Edge Functions.
- **Settlement calculations:** A pure TypeScript package, independent of browser, database, and email services; the server performs authoritative finalization.
- **Availability research:** Optional local Python utility that creates a reviewable import for an administrator.

Do not add an always-running application server, payment processor, WhatsApp API integration, or trip photo/video storage to the initial architecture.

### Application modules

1. Membership, invitations, profile, and payment preferences.
2. Campsites, rotation, trips, RSVPs, and cabin reservation status.
3. General and trip-specific rules.
4. Packing, meal preferences, transport, lodging lottery, and responsibilities.
5. Expense submission, review, settlement, and payment acknowledgments.
6. Notifications, audit events, and operational monitoring.

These are boundaries within one application and database, not separate deployable services.

## 3. Membership and access

- Visitors can see the public introduction and any constitution content the administrator chooses to publish. They cannot see membership, trip attendance, or financial records.
- Club membership is invitation-based. Administrators invite members; members authenticate using verified email.
- Roles are member and administrator. The client cannot grant or change roles.
- RLS limits profile and trip data by role and membership.
- Payment identifiers are visible only to the relevant payer, recipient, and administrators.
- Privileged operations, including role changes, trip decisions, expense approval, settlement finalization, and cleanup, run through trusted server-side paths.
- Secrets for email delivery and privileged database operations never enter the frontend bundle.

### Access matrix

RLS is defined and tested for every table. These table groups are the minimum design boundary; the implementation plan must map each concrete table to one row here:

| Data group | Visitor | Active member | Administrator |
| --- | --- | --- | --- |
| Published constitution and public campsite information | Read published fields | Read | Read/write |
| Profile and membership | None | Read own; update limited profile fields | Read/write membership and roles through trusted operation |
| Trips, RSVP roster, signup preferences, responsibilities, transport, lodging | None | Read trip details and roster for active trips; write own RSVP/preferences/claims | Read/write all; override with audit reason |
| Expenses and allocations | None | Read trip expense summaries; read/write own submissions and allocations they participate in | Read/write/review all |
| Settlement ledger and payment instructions | None | Read only transfers where member is payer or recipient; update own sent status; recipients confirm receipt | Read all; finalize/resolve through trusted operation |
| Audit, email outbox, operational jobs | None | None | Read; system-only writes, with restricted admin actions |

Direct client writes are denied for roles, trip lifecycle state, cabin booking/cancellation state, approved expenses, settlement versions/transfers, audit events, and deletion/retention jobs. Admin and member access both use server-side authorization for privileged state transitions; RLS remains the database boundary if an endpoint is bypassed.

### Cabin reservation tracking

Each trip has a reservation record with reservation reference, provider/contact, booking status, amount/currency, contractual full-refund cancellation deadline, calculated club registration cutoff, safety buffer, and change history. Cabin booking states are **Not booked**, **Booked**, **Cancellation requested**, **Cancellation confirmed**, and **Unresolved / escalated**. When cancellation is required, record request time, actor, provider response/evidence, confirmation time, and any refund or credit amount/status. The trip lifecycle and reservation lifecycle remain independent. An unresolved booking generates administrator reminders before the contractual deadline and stays visible until confirmation or an explicit resolution.

## 4. Trip and RSVP flow

- Maintain a rolling schedule of future monthly trips, with the approved round-robin campsite sequence and audited administrator overrides.
- Friday through Sunday is the default trip window; an administrator can set different dates.
- Deadlines use one administrator-configured club timezone and display the exact date and time to members.
- A poll has a fixed **Coming / Not coming** response. This is not a general-purpose survey builder.
- The default minimum is four Coming participants. Administrators can set a structured trip-specific minimum, such as five.
- The default registration cutoff is 35 days before the trip. The effective cutoff is the earlier of that date and the cabin reservation's contractual cancellation deadline minus a configurable safety buffer. The default five-day buffer gives the club time to act before a one-month full-refund deadline.
- At the cutoff, the system evaluates the effective minimum. If met, it confirms the club trip and notifies the registered attendees. If fewer than the minimum are committed, it marks the trip **Cancelled — minimum not met**, queues email to attendees and administrators, and opens the cabin cancellation task. Cancellation emails are tracked individually; failures alert administrators and remain retryable.
- Trip cancellation and cabin cancellation are separate states. The app records the cancellation request and follows it until a person records confirmation from the campsite or booking provider.
- Administrators can add late entries to confirmed trips after the member cutoff. A trip automatically cancelled for missing the minimum can accept late entries only after an explicit administrator reinstatement and fresh verification that the cabin is still available.
- Administrators record available bed spaces for the trip. If the group exceeds them, the administrator can enter how many people the floor lottery should select.
- After each trip, an administrator records the actual attendee roster. Expense allocations can only reference actual attendees.
- Cancelling a trip does not advance or silently reset the rotation; the scheduled month retains its position by default.
- If attendance drops below the minimum after confirmation, the trip stays confirmed until an administrator explicitly decides to proceed or cancel. The decision, reason, member notifications, and any cabin action are recorded.
- A Coming RSVP creates a cabin commitment of at least $50 per participant. Whether a deposit must be paid before it counts toward the minimum, and whether it is refundable when someone withdraws, is a required product decision before implementation.
- Members can withdraw their RSVP. A withdrawal before the cutoff releases unclaimed responsibility slots and updates the projected minimum; a withdrawal after confirmation alerts the administrator and never silently cancels the trip. Record who changed the RSVP and when. Any remaining cabin contribution, refund, or cost allocation follows the deposit policy that must be decided before implementation.

### Assumptions to verify in written review

- The registration cutoff is derived from both the 35-day default and the contractual cabin deadline. Below-minimum trips are automatically cancelled at that cutoff.
- Late entries are existing active members. Adding a non-member guest is not part of the first design.

## 5. Rules and structured club policies

Administrators manage rules through the web app. Direct SQL can be used for setup or emergency maintenance, but normal rule changes use the audited interface.

Use a shared rule catalog for general rules and trip-only rules, with separate trip links and overrides:

- `rules` stores the rule text, category, scope, and any structured value needed by the application.
- Trip-specific rules link to a trip and have an operational expiry date, defaulting to the trip end.
- `trip_rule_overrides` links a trip to a general rule it changes and stores the trip's replacement value or text, reason, and operational expiry date.
- Expired trip rules and overrides stop affecting current operations and can be removed from active views. At trip confirmation, persist an immutable minimal snapshot of the effective Constitution version and all structured policies/overrides that affect the trip, including financial policy values. Associate that snapshot with the trip's financial ledger so later disputes can establish which rules applied.
- Behavior must use structured values, not parse prose. For example, minimum attendees, cents per mile, and per-person budget targets are typed values with a human-readable rule alongside them.

Initial structured policies:

- Minimum Coming participants: 4 by default; trip-specific override allowed.
- Driver reimbursement: 76 cents per mile when the vehicle meets the carpool threshold; an administrator can record a trip-specific exception with a reason.
- Car wash contribution: $5 per participant per trip, included in the travel target.
- Budget targets per participant per trip: $50 shared food and non-alcoholic drinks, $50 travel, and $60 cabin. These are soft targets: show totals and warnings but do not block an expense. Four participants produce targets of $200, $200, and $240 respectively ($640 total).

### Transportation

- Record each trip vehicle, driver, assigned occupants, mileage, and reimbursement eligibility.
- Default carpool threshold is three people per vehicle. **Assumption:** this includes the driver.
- Four participants should normally travel in one van. For five, use one van if it can fit everyone; otherwise an administrator can record the exception and use an additional vehicle.
- For groups up to eight, plan for no more than two vans by default. A third van requires an administrator exception and reason.
- Driving counts as workload. The responsibility view should highlight people with fewer other duties when administrators assign drivers.

## 6. Signup preferences and trip preparation

When a member responds Coming, the trip signup collects:

- **Packing:** Show a reusable checklist containing the club's common items, including pillow, blanket, water shorts, swimming goggles, towel, clothing, toothbrush and paste, optional sleeping bag, shoes, sandals, and sunglasses. Administrators can add trip-specific items.
- **Coffee and tea:** Separate Saturday-morning and Sunday-morning preferences; choices include coffee, tea, neither, and no preference.
- **Diet:** A trip-wide vegetarian/non-vegetarian default with per-meal overrides. Members can mark a planned meal as not eating. Administrators configure the planned meal slots for that trip.
- Administrators set a meal-preference cutoff before grocery shopping. After it, preferences are frozen for purchasing; changes require an administrator edit and audit note.
- These answers guide buying and meal preparation. They do not automatically determine expense allocations.

## 7. Responsibilities and lodging lottery

### Responsibilities

- Administrators prepare responsibility slots for each trip. Initial time blocks are Friday night, Saturday morning, Saturday night, and Sunday morning.
- Members choosing Coming must select an available responsibility in each time block during signup. Open slots are claimed first come, first served. Slot counts are configured by an administrator; the database must make simultaneous claims safe.
- If a time block has no available slot, do not block or discard the RSVP. Save the signup as **Needs assignment**; alert the administrator to add a slot or assign a task. The member sees the outstanding selection and can complete it once capacity exists. Admin exceptions are audited.
- Sunday-morning cleanup can have more or higher-weighted slots because it is the heaviest work period.
- Initial task examples include cutting vegetables, cleaning meat, cabin floor cleaning, bathroom cleaning, dishes, main dish, side dish, curry, and drinks.
- Administrators can add trip-specific or trip-wide tasks such as activity planning. Trip-wide tasks count toward workload but do not fill a required time-block selection unless the administrator assigns them to that block.
- Driving counts toward a person's workload. Administrators retain control and can override the suggestions.

### Floor-sleeping lottery

- If beds do not cover the group, an administrator enters how many people to select and runs the draw.
- A trusted server-side function randomly selects from eligible confirmed participants and records the eligible roster, requested count, draw time, and result. People already assigned a bed are excluded when known; administrators record a reason for any eligibility override.
- The first completed draw is authoritative. A rerun requires an administrator reason (for example, a roster change), retains the prior draw in the audit record, and produces a new recorded draw. Administrators can review the active and prior draws.
- A selected participant can exchange with another participant. **Assumption:** both people confirm the exchange in the app before the assignment changes.
- The draw and exchanges are trip operations, not long-term trip history. An administrator override must include a reason.

## 8. Food policy and expense entry

- The $50 shared food budget is for planned food and non-alcoholic drinks bought upfront.
- Alcohol is outside the shared food budget. Members may buy their own or coordinate an expense among people who explicitly opt in. Costs cannot be assigned to non-drinkers because a majority shared the purchase.
- The application does not create a club credit card or spend under a group account. Each expense records the individual payer.
- During-trip individual or subgroup purchases are entered with date, description, category, amount, payer, receipt if available, and the people actually involved.
- A member may propose an allocation, but cannot charge every attendee without administrator approval. Alcohol allocations are limited to the people who opted in.
- Administrators review expenses before settlement, can correct or reject entries with an explanation, and can resolve disputes.
- Equal sharing is the default. The engine also supports custom amounts, percentages, individual expenses, driver reimbursements, and documented administrator adjustments. Allocations must sum exactly to the expense amount.
- Each trip has an administrator-configurable expense submission deadline. The admin reviews entries and allocations, records disputed or rejected items with reasons, and locks the expense set before settlement preview. After lock, only an administrator can reopen or change it, with an audit event.
- Availability research imports must validate file type/size and required fields, flag stale source data and duplicate campsite/date records, and remain drafts until an administrator approves them. A failed or partially parsed import must not create trips automatically.

## 9. Settlement and payment acknowledgments

- Use integer cents and deterministic remainder allocation; never use floating-point money arithmetic.
- Aggregate all approved expenses and allocations for the trip before netting balances; do not optimize each expense independently. For example, a six-person trip may have four people sharing groceries, three sharing fuel, and all six sharing the cabin. Combine those obligations, then calculate member net balances.
- Verify debits equal credits and proposed transfers settle every balance. The payer need not be included in the expense allocation; payer reimbursement is represented by the net ledger.
- Minimize the number of transfers as the primary objective, exactly for small groups within a configured computation limit. Treat payment-method compatibility as a secondary preference. Use a deterministic documented fallback for larger groups.
- Expense lifecycle: **Collecting → Admin review → Locked → Settlement preview → Finalized version → Payment tracking → Closed**. A trusted server function, available only to an administrator, finalizes a version transactionally and records actor, timestamp, policy snapshot reference, expense-set hash, and transfer set. A finalized version is immutable.
- If an error is found after payments have begun, do not delete or rewrite the finalized version or its transfers. Create a numbered adjustment version that references the prior version, preserves every sent/received payment, calculates remaining obligations or credits, and explains the correction. Confirmed receipts remain attached to the version in which they occurred.
- Close only when all transfers are confirmed or the administrator explicitly resolves outstanding transfers with a reason. Keep a minimal immutable ledger of settlement versions, member obligations, payment states/timestamps, adjustments, and resolution notes for 12 months after closure.
- Payment instructions include trip, payer, recipient, exact amount, recipient's preferred method and identifier, reference, deadline if configured, and the required warning to reconfirm details directly before sending.
- The payer may mark a transfer sent. The recipient or an administrator may record it received. Statuses are Pending, Marked Sent, Confirmed Received, and Disputed. Email delivery never implies payment.
- The app never initiates transfers.

## 10. WhatsApp and media

- Administrators create trip WhatsApp groups manually and paste the invitation link into the trip record.
- Only confirmed participants and administrators can see the link. Remove it when the trip is completed so old invitation links do not remain in history.
- The club can direct members to put trip photos and videos in WhatsApp. The app does not upload or retain trip media.
- Optional expense receipt attachments remain private, accessible only to the payer, allocated participants, and administrators, and are deleted after three months from settlement closure (or after dispute resolution if later). Do not retain payment account identifiers in the long-term ledger; retain only the method label needed to understand the transfer record.

## 11. Notifications and scheduled work

- Email supports invitations, poll opening and reminders, confirmation/cancellation, trip changes, expense reminders, settlement instructions, revisions, and payment acknowledgments.
- Use an outbox with idempotency keys and recorded delivery attempts. Retry transient failures safely.
- Supabase Cron runs deadline and outbox checks every five minutes, then daily cleanup and schedule replenishment. Jobs close registration, evaluate the minimum, queue notices, check booking cancellation actions, process retries, expire operational rules, and run retention cleanup. Persist the last successful run and job outcome.
- Jobs are idempotent and catch-up-safe: a later run scans for due or overdue work rather than assuming each invocation ran on time. A missed run must not create duplicate notices, trips, or settlement actions.
- Monitor job success from outside the Supabase project as well as through Cron run history. Alert administrators through email (and show an in-app alert) for missed deadline processing, failed cancellation notices, unresolved cabin cancellation, exhausted email retries, and failed cleanup. An email provider accepting a message is recorded as **accepted**, not proof it was delivered or read. Admins can see per-recipient status and correct invalid addresses.
- Generate the next rolling 12 months with a unique month key and transaction-safe upsert. A catch-up task fills any missing months without duplicates and preserves the round-robin position when an individual trip is cancelled.
- The email provider remains a technology choice for the implementation plan; evaluate its free tier, limits, and delivery behavior before adding it.

## 12. Data retention

- Long-term trip history keeps campsite/location, trip dates, and attendees. Inactive members are deactivated rather than deleted where historical attendance, obligations, or ledger references depend on them; their login is revoked and profile fields are minimized.
- Operational trip data (packing and meal responses, responsibility assignments, floor lottery draw and rerun history, detailed RSVP changes, and WhatsApp invite links) expires at trip closure, subject to unresolved disputes or active settlement needs. Remove the WhatsApp link when the trip completes.
- Detailed expense submissions, allocations, and receipt files are retained while settlement is pending/disputed. After closure, delete receipts and sensitive payment instructions/identifiers after three months. Retain the minimal immutable settlement ledger and effective policy snapshot for 12 months after closure; if unresolved, start that period after resolution. Keep the high-level trip summary after detailed data expires.
- Cleanup jobs must be idempotent and auditable. Backup/export retention and access must be documented separately; backups can outlive in-app deletion and must expire according to the backup provider's retention window.

## 13. Deployment, validation, and rollout

- Render serves the Vite build as a Static Site. Supabase holds durable application state; no production data is written to Render's filesystem.
- Keep schema migrations, Edge Functions, and scheduled-job definitions in source control. Use local Supabase for development and separate production configuration.
- Maintain separate development and production Supabase configurations, with no production credentials or member data in previews. Validate pull-request builds/deployments using Render previews where available or an equivalent isolated preview, and verify production configuration before release.
- Apply database changes through versioned migrations. Test migrations against a disposable database seeded with representative data; maintain a forward-fix or restore procedure for each production migration. Render code rollback does not roll back database changes, so coordinate application and schema compatibility explicitly.
- Automated acceptance coverage must include RLS for every table, invitation/role boundaries, deadline calculation and catch-up, cancellation notices and retry failure, post-confirmation withdrawal, first-come responsibility claims and full-slot handling, lottery draw/rerun/exchange, meal freeze, exact financial arithmetic, payer-excluded allocation, multi-subset global settlement, partial payment, versioned correction, idempotent jobs, and retention while preserving trip summaries and the policy snapshot.
- Proposed recovery objectives for the private pilot are RPO of 24 hours and RTO of one business day. Produce a nightly off-site logical database export, keep it access-restricted and encrypted, and rehearse restore at least quarterly. Reassess these targets before launch based on actual operations.
- Validate the complete member and administrator journeys before launch.
- Implement in phases: foundation and access; campsites and trip/RSVP flow; rules and signup preferences; transportation/responsibilities/lodging; expenses; settlement and acknowledgments; notifications; production readiness.
- No implementation begins until the user approves this written spec and a separate implementation plan is prepared.

### Free private pilot and pre-launch gate

Use Supabase Free for a private pilot. Free projects may pause after seven days with insufficient database activity; do not assume Cron activity prevents a pause. Current Supabase backup guidance recommends that Free projects regularly export data with the CLI and keep off-site backups. A paused database cannot run its deadline jobs, so until an independent scheduler and end-to-end deadline recovery have been tested, an administrator must also check a separate club calendar at the cutoff and confirm cabin cancellation manually. Before public launch, test off-site export/restore, deadline catch-up after a simulated outage, external monitoring, and a practical recovery runbook. The $0 pilot is not cleared for trips whose cabin cancellation deadline depends solely on an unverified scheduled job.

References:

- [Supabase Free project pausing](https://supabase.com/docs/guides/platform/free-project-pausing)
- [Supabase database backups and Free-plan exports](https://supabase.com/docs/guides/platform/backups)
- [Supabase production checklist](https://supabase.com/docs/guides/deployment/going-into-prod)
- [Supabase Cron](https://supabase.com/docs/guides/cron)
- [Scheduling Supabase Edge Functions](https://supabase.com/docs/guides/functions/schedule-functions)
- [Render static sites and pull-request previews](https://render.com/docs/static-sites)
- [Render rollbacks](https://render.com/docs/rollbacks)

## 14. Assumptions and review points

These defaults make the design implementable; revise any of them during written review:

1. The poll is a binary RSVP, not a configurable survey.
2. The registration cutoff is the earlier of 35 days before the trip and the contractual cabin cancellation deadline minus a five-day safety buffer by default. Below-minimum trips are automatically cancelled and email is queued at the cutoff. Reinstatement requires an administrator to verify cabin availability.
3. The three-person carpool count includes the driver.
4. Admin-entered late participants are existing active members.
5. Each Coming participant selects one responsibility in each of the four time blocks; when slots fill, the RSVP is saved as Needs assignment and the administrator adds capacity or assigns the task.
6. The server lottery selects from eligible confirmed participants; each draw is retained as an audit record and exchanges require both participants to accept.
7. General rule text represents the current rule. Operational trip rules expire, while a minimal immutable snapshot of the rules that applied to a trip remains with its financial ledger for 12 months after settlement closure.
8. Meal preferences guide preparation but do not automatically decide who owes a particular expense; they freeze at the administrator-set shopping cutoff.
9. A trip-specific exception to mileage or vehicle-count policy requires an administrator reason.
10. Attendance below the minimum after confirmation requires an administrator decision; the trip is not silently cancelled.
11. Minimal settlement ledger and applicable policy snapshot retention is 12 months after closure; receipts and sensitive payment instructions/identifiers are deleted after three months.
12. The $50 cabin commitment's payment timing, whether it gates the minimum, and withdrawal/refund treatment must be decided before implementation.
