# Private Camping Club Platform — Design

**Date:** 2026-10-08
**Status:** Design draft for user review
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

## 4. Trip and RSVP flow

- Maintain a rolling schedule of future monthly trips, with the approved round-robin campsite sequence and audited administrator overrides.
- Friday through Sunday is the default trip window; an administrator can set different dates.
- Deadlines use one administrator-configured club timezone and display the exact date and time to members.
- A poll has a fixed **Coming / Not coming** response. This is not a general-purpose survey builder.
- The default minimum is four Coming participants. Administrators can set a structured trip-specific minimum, such as five.
- At the registration deadline, the system evaluates the effective minimum. If met, it automatically confirms the club trip and notifies the registered attendees.
- If the trip is below the minimum, it remains pending and open to administrator-entered late participants. Reaching the minimum through a late entry automatically confirms the trip. An administrator can cancel it; it is not automatically cancelled just for being below the minimum.
- Confirmation means the club has enough participants to proceed. It does not prove a cabin was booked. Cabin booking and cancellation are recorded separately.
- An administrator can add late entries after member registration closes. They are included in the participant count and the later attendee roster.
- Administrators record available bed spaces for the trip. If the group exceeds them, the administrator can enter how many people the floor lottery should select.
- After each trip, an administrator records the actual attendee roster. Expense allocations can only reference actual attendees.
- Cancelling a trip does not advance or silently reset the rotation; the scheduled month retains its position by default.

### Assumptions to verify in written review

- Confirmation is evaluated at the registration deadline, then can occur after the deadline when an administrator adds enough late participants. It does not happen immediately before the deadline when the threshold is first reached.
- Late entries are existing active members. Adding a non-member guest is not part of the first design.

## 5. Rules and structured club policies

Administrators manage rules through the web app. Direct SQL can be used for setup or emergency maintenance, but normal rule changes use the audited interface.

Use a shared rule catalog for general rules and trip-only rules, with separate trip links and overrides:

- `rules` stores the rule text, category, scope, and any structured value needed by the application.
- Trip-specific rules link to a trip and have an expiry date, defaulting to the trip end.
- `trip_rule_overrides` links a trip to a general rule it changes and stores the trip's replacement value or text, reason, and expiry date.
- Expired trip rules and overrides are deleted. Current general rules remain active; historical trip rule text is not retained as a trip archive.
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
- These answers guide buying and meal preparation. They do not automatically determine expense allocations.

## 7. Responsibilities and lodging lottery

### Responsibilities

- Administrators prepare responsibility slots for each trip. Initial time blocks are Friday night, Saturday morning, Saturday night, and Sunday morning.
- Members choosing Coming must select an available responsibility in each time block during signup. Open slots are claimed first come, first served. Slot counts are configured by an administrator; the database must make simultaneous claims safe.
- Sunday-morning cleanup can have more or higher-weighted slots because it is the heaviest work period.
- Initial task examples include cutting vegetables, cleaning meat, cabin floor cleaning, bathroom cleaning, dishes, main dish, side dish, curry, and drinks.
- Administrators can add trip-specific or trip-wide tasks such as activity planning. Trip-wide tasks count toward workload but do not fill a required time-block selection unless the administrator assigns them to that block.
- Driving counts toward a person's workload. Administrators retain control and can override the suggestions.

### Floor-sleeping lottery

- If beds do not cover the group, an administrator enters how many people to select and runs the draw.
- A trusted server-side function randomly selects from confirmed participants and stores the active result for that trip.
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

## 9. Settlement and payment acknowledgments

- Use integer cents and deterministic remainder allocation; never use floating-point money arithmetic.
- Calculate net balances across approved expenses. Verify debits equal credits and that proposed transfers settle every balance.
- Minimize transfers exactly for small groups within a configured computation limit; use a deterministic documented fallback for larger groups.
- A trusted server function finalizes the settlement transactionally and records the actor and timestamp. The finalized result cannot be silently recalculated.
- Payment instructions include trip, payer, recipient, exact amount, recipient's preferred method and identifier, reference, deadline if configured, and the required warning to reconfirm details directly before sending.
- The payer may mark a transfer sent. The recipient or an administrator may record it received. Statuses are Pending, Marked Sent, Confirmed Received, and Disputed. Email delivery never implies payment.
- The app never initiates transfers.

## 10. WhatsApp and media

- Administrators create trip WhatsApp groups manually and paste the invitation link into the trip record.
- Only confirmed participants and administrators can see the link. Remove it when the trip is completed so old invitation links do not remain in history.
- The club can direct members to put trip photos and videos in WhatsApp. The app does not upload or retain trip media.
- Optional expense receipt attachments remain private and are deleted with detailed financial records.

## 11. Notifications and scheduled work

- Email supports invitations, poll opening and reminders, confirmation/cancellation, trip changes, expense reminders, settlement instructions, revisions, and payment acknowledgments.
- Use an outbox with idempotency keys and recorded delivery attempts. Retry transient failures safely.
- Supabase Cron closes member registration at deadlines, evaluates minimum-participant rules, processes notifications, checks overdue work, expires trip rules, and performs retention cleanup.
- Jobs are catch-up-safe: a later run scans for overdue work rather than assuming every scheduled invocation ran exactly on time.
- Notifications and admin alerts report failures. A missed deadline job must be visible to administrators.
- The email provider remains a technology choice for the implementation plan; evaluate its free tier, limits, and delivery behavior before adding it.

## 12. Data retention

- Long-term trip history keeps only campsite/location, trip dates, and attendees.
- Trip-only rules and overrides expire at the trip end by default. Packing responses, dietary selections, responsibility assignments, floor lottery results, RSVP details, and WhatsApp invite links are operational trip data, not historical archives, and are deleted when the trip closes.
- Detailed expenses, allocations, receipts, settlement transfers, payment identifiers copied into instructions, and payment acknowledgments remain while settlement is pending or disputed. After settlement closes, retain them for three months, then delete the detailed records and receipt files.
- Keep only the high-level trip summary after detailed data expires.
- Cleanup jobs must be idempotent and auditable. Backups and exports must respect the same retention policy.

## 13. Deployment, validation, and rollout

- Render serves the Vite build as a Static Site. Supabase holds durable application state; no production data is written to Render's filesystem.
- Keep schema migrations, Edge Functions, and scheduled-job definitions in source control. Use local Supabase for development and separate production configuration.
- Tests should cover RLS access, invitation and role boundaries, signup/late entry transitions, first-come responsibility claims, lottery behavior, exact financial arithmetic, settlement invariants, idempotent retries, and retention deletion while preserving trip summaries.
- Validate the complete member and administrator journeys before launch.
- Implement in phases: foundation and access; campsites and trip/RSVP flow; rules and signup preferences; transportation/responsibilities/lodging; expenses; settlement and acknowledgments; notifications; production readiness.
- No implementation begins until the user approves this written spec and a separate implementation plan is prepared.

### Free private pilot and pre-launch gate

Use Supabase Free for a private pilot. The current Supabase documentation says Free projects may pause after seven days of low database activity, and the production checklist says database backups are not available for download on Free. Cron provides scheduled jobs and run history, but the design must verify whether this activity prevents inactivity pausing. Before public launch, choose and test a recovery plan for paused projects and an independent backup/restore process. Do not certify production readiness until those are resolved.

References:

- [Supabase Free project pausing](https://supabase.com/docs/guides/platform/free-project-pausing)
- [Supabase production checklist](https://supabase.com/docs/guides/deployment/going-into-prod)
- [Supabase Cron](https://supabase.com/docs/guides/cron)
- [Scheduling Supabase Edge Functions](https://supabase.com/docs/guides/functions/schedule-functions)

## 14. Assumptions and review points

These defaults make the design implementable; revise any of them during written review:

1. The poll is a binary RSVP, not a configurable survey.
2. Automatic confirmation is checked at the registration deadline; a late administrator entry can subsequently meet the minimum and trigger confirmation. Under-minimum trips remain pending rather than being automatically cancelled.
3. The three-person carpool count includes the driver.
4. Admin-entered late participants are existing active members.
5. Each Coming participant claims one available responsibility for each of the four time blocks; admins configure enough slots and may add slots or override assignments.
6. The server lottery selects from confirmed participants; exchanges require both participants to accept.
7. General rule text represents the current rule. Trip-specific text and overrides are deleted at expiry; detailed trip rule history is not retained.
8. Meal preferences guide preparation but do not automatically decide who owes a particular expense.
9. A trip-specific exception to mileage or vehicle-count policy requires an administrator reason.
