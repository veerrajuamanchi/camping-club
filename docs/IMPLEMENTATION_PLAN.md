# Private Camping Club Platform — Implementation Plan

**Status:** Remediated planning draft. Phase 1/2 source is already present on `main`; this plan does not authorize new application coding or deployment.
**Authoritative product source:** [Approved platform design](superpowers/specs/2026-10-08-camping-club-platform-design.md)
**Related standards:** [Technology Guardrails](../TECHNOLOGY_GUARDRAILS.md), [Product Vision](PRODUCT_VISION.md)

**Remediation artifacts:** [Consistency report](CONSISTENCY_REMEDIATION_REPORT.md), [owner decision record](OWNER_DECISIONS.md), [state persistence matrix](STATE_PERSISTENCE_MATRIX.md), [financial worked examples](FINANCIAL_WORKED_EXAMPLES.md).

## Goal

Deliver the approved full private camping coordination platform as a modular monolith, with verified security and financial behavior and a documented operations/recovery certification before launch.

## Architecture

A React, TypeScript, and Vite browser application is deployed as a Render Static Site. Supabase Auth and PostgreSQL with RLS hold all durable state. Supabase Edge Functions and narrowly scoped transactional database operations enforce privileged lifecycle and financial transitions. A pure TypeScript settlement package computes deterministic results. Optional campsite research runs as a local Python utility. There is no always-running application server, in-app money movement, WhatsApp API integration, or app photo/video store.

## Technology

- Frontend: React, TypeScript, Vite, responsive browser UI.
- Hosting: Render Static Site, HTTPS, SPA rewrite to index.html.
- Identity/data: Supabase Auth and PostgreSQL, explicit grants and RLS.
- Privileged operations: Supabase Edge Functions and transactional database operations.
- Scheduling: Supabase Cron plus independent monitoring and a manual cabin-deadline fallback.
- Settlement: pure TypeScript package, integer cents, server-authoritative finalization.
- Availability research: optional local Python utility; validated imports require administrator approval.
- Email: transactional provider selected after checking current free-tier limits, sender verification, delivery status, and cost.
- Use locked dependencies and commit lockfiles. Recheck current Supabase documentation and changelog before implementing platform-specific interfaces.

## Global constraints

- Preserve the approved full product scope; this is not a polls-only release.
- Do not start application feature development until the owner approves this plan.
- Do not use SQLite for production persistence.
- Do not add an always-running app server or paid service without approval.
- Keep all authoritative role, trip lifecycle, cancellation, expense approval, settlement, payment state, and notification dispatch operations server-side.
- Use integer cents and deterministic remainder allocation for all monetary values.
- Keep all client-exposed tables protected by explicit grants and RLS; no frontend service-role or secret keys.
- Do not use user-editable auth metadata for authorization.
- Keep payment movement external to the app; record sent/received/refund acknowledgments only.
- Rule acknowledgment applies to Coming signup: persist exactly which immutable rule bundle the participant saw. Later rule edits do not force re-acknowledgment; notify without replacing the prior record.
- Persist no trip photos or videos. WhatsApp groups are created manually.
- Scheduled work must be idempotent, catch-up-safe, visible to administrators, and independent of website traffic.
- Supabase Free pausing and backup limits are operational risks, not availability guarantees.
- Implementation phase exit criteria and certification gates are cumulative; an unreached critical gate blocks public launch.

## Artifact map

| Artifact | Responsibility |
| --- | --- |
| This document | Ordered phases, dependencies, deliverables, exit criteria, risks, launch gates |
| [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md) | Entities, relationships, constraints, indexes, RLS intent |
| [API_CONTRACTS.md](API_CONTRACTS.md) | User and system Edge Function/database operation contracts |
| [STATE_MACHINES.md](STATE_MACHINES.md) | Lifecycle states, transition authority, side effects, failure paths |
| [SETTLEMENT_ENGINE_SPEC.md](SETTLEMENT_ENGINE_SPEC.md) | Exact transfer optimization, fallback, invariants, versioned accounting |
| [SECURITY_ARCHITECTURE.md](SECURITY_ARCHITECTURE.md) | Table-level access, authorization, payment identifier protection, security gates |
| [OPERATIONS_AND_RECOVERY.md](OPERATIONS_AND_RECOVERY.md) | Render, Supabase Cron, monitoring, email, backups, recovery, manual deadline runbook |
| [TEST_STRATEGY.md](TEST_STRATEGY.md) | Automated tests mapped to requirements and phase acceptance |
| [REQUIREMENTS_TRACEABILITY.md](REQUIREMENTS_TRACEABILITY.md) | Product requirement → phase → tests → certification evidence |
| [../AGENTS.md](../AGENTS.md) | Repo-wide implementation constraints for agents and contributors |

## Decision register and safe planning assumptions

### Decisions already fixed by the owner

- Fewer than the configured minimum at registration cutoff automatically cancels the trip and queues email. The threshold is four by default, but the minimum-count basis is unresolved and neither policy is approved: active Coming RSVPs, or active Coming RSVPs with a recorded $50 receipt.
- Registration cutoff is the earlier of 35 days before the trip and contractual cabin-cancellation deadline minus a five-day safety buffer by default.
- A $50 cabin contribution applies to each attendee; its request timing and whether receipt gates the cutoff minimum remain unresolved.
- The administrator assigns the cabin payment recipient per trip. Attendees pay externally as soon as confirmation is emailed.
- A member's $50 contribution remains due after a post-confirmation withdrawal and is non-refundable if that member withdraws. Apply it only under an owner-approved cabin reconciliation policy; any excess remains unapplied and blocks settlement closure.
- Rule acknowledgment is required to submit Coming. It records the exact rule bundle shown. If rules change later, the old acknowledgment remains; re-acknowledgment is not required.
- Rule acknowledgment applies to Coming only; Not coming does not require acknowledgment. A suggested statement is “I have reviewed and acknowledge the applicable club and trip rules shown above.”
- Keep a minimal finalized settlement ledger and applicable policy snapshot 12 months after closure; delete receipt images and sensitive payment instructions/identifiers after three months.
- Administrators alone finalize expenses/settlements. Recipients or admins confirm receipt.
- First-come responsibility claims are concurrency-safe; a full slot must not deadlock RSVP.
- Supabase Free is for a private pilot only, subject to inactivity, backup, and manual cabin-deadline controls.

### Policy decisions still requiring owner approval

These are not safe to invent in application code; the [Owner Decision Record](OWNER_DECISIONS.md) is the canonical pending-choice register. See the named blocked gates below.

1. Select the minimum-count basis: active Coming RSVPs, or active Coming RSVPs whose $50 is recorded received. The latter requires collection before cutoff. Neither is approved. Also decide how to resolve received contributions if that basis causes an automatic insufficient-participation cancellation.
2. If a confirmed trip is later cancelled by the club for insufficient attendance, decide whether contributions are returned, retained against a documented non-refundable cabin loss, or handled another way. The system must not silently forfeit or refund.
3. Decide how the fixed $50 cabin contribution is reconciled when collected contributions exceed the actual cabin invoice or an attendee's cabin share. Retain excess as an unapplied, auditable balance and block settlement closure until approved.
4. Approve the contribution treatment for a member who withdraws after paying $50 if the non-refundable amount exceeds the documented cabin cancellation cost or actual cabin invoice. Do not reassign such funds to another budget category without approval.
5. Approve the proposed exact optimizer ceiling of 12 non-zero net balances and deterministic greedy fallback above it.
6. Confirm whether payment-method compatibility is an optimization tie-breaker based on sender-supported methods. The current profile only defines a receiving preference; sender compatibility cannot be measured without additional capabilities.

## Sequential implementation phases

### Phase 0 — Planning approval, policy decisions, and project baseline

**Objective:** Approve this plan, close or explicitly defer the financial policy questions, and establish a reproducible development/review baseline before feature coding.

**Features and work**
- Owner approves this plan and confirms which financial decisions are resolved now versus deferred to their phase gates.
- Record owner choices in `docs/OWNER_DECISIONS.md`; reviewer recommendations remain pending until the owner explicitly selects them.
- Reconcile the earlier amended received-$50 threshold with the later Coming-RSVP threshold and decide what happens to pre-cutoff receipts if the paid threshold is missed.
- Decide whether post-confirmation withdrawal requires administrator approval and whether the optional cabin-verification gate / legacy `Closed — Pending Decision` state remains.
- Use clear acknowledgment wording that identifies the immutable rule bundle; acknowledgment is required only for Coming, and later rule edits do not require re-acknowledgment.
- Recheck current Supabase changelog, Data API exposure behavior, CLI, Edge Function authentication patterns, Cron behavior, Free pausing and backup documentation; record versions/links in implementation notes.
- Define environment names and secret ownership. No production data or secret keys enter previews.
- Approve requirements traceability and architecture certification gates.

**Database changes:** None. Freeze the initial entity catalog and identify unresolved policy fields that must remain configurable/statused rather than guessed.

**API/function changes:** None.

**Frontend changes:** None.

**Security requirements**
- Review the threat boundary and table-level RLS matrix before DDL.
- Select no packages or provider on the basis of an unverified free-tier claim.
- Use a user-owned version-control branch and protect default branch merges.

**Automated tests:** None in this planning phase. The test design is in TEST_STRATEGY.md; do not claim the application is tested.

**Dependencies:** Owner review of this plan and decision register.

**Deliverables**
- Approved plan and approved policy decisions.
- Dependency/version baseline checklist.
- Requirements traceability baseline.

**Exit criteria**
- Plan approval is recorded.
- A1/A2/A3 decisions needed for later finance work have explicit owner choices.
- Feature work is still not started until plan approval.

**Risks and mitigations**
- Risk: ambiguous cancellation or contribution rules become database behavior. Mitigation: block affected API/schema code paths until approved; store outcome as pending-resolution meanwhile.
- Risk: Supabase/Render feature details change. Mitigation: revalidate official documentation immediately before implementation.

### Phase 1 — Repository foundation, identity, profiles, and deployment skeleton

**Objective:** Establish the modular monolith, authentication, profiles, development/test infrastructure, and safe static deployment without implementing trip features.

**Features**
- React/TypeScript/Vite shell with member and admin route boundaries.
- Supabase Auth invitation/verified-email sign-in.
- Member profile, active/inactive/suspended state, protected payment preferences.
- Initial Render Static Site deployment shape and isolated development configuration.
- Admin role bootstrapping through a trusted operation and auditable event.

**Database changes**
- Baseline migrations and generated type workflow.
- Member profile, protected payment-method, audit, and application-settings entities from DATABASE_SCHEMA.md.
- Explicit grants, RLS policies, role checks, and indexes for the baseline entities.
- No client-maintained role columns or user metadata authorization.

**API/function changes**
- Invite member, accept invitation/profile initialization, update own profile, update payment preference, deactivate member, set administrator role.
- All role-changing operations are trusted and audited.
- Error envelope, correlation ID, authentication, and idempotency conventions.

**Frontend changes**
- Sign-in, invite acceptance, profile, payment-method form, access-denied/admin shell.
- Clear “payment identifiers are used to prepare instructions; the app never sends money” copy.

**Security requirements**
- RLS and least-privilege grants tested on every exposed entity.
- Public/signed-out access only to explicitly published content.
- Service credentials confined to Edge Function secrets; client contains only public project URL and publishable key.
- Role authorization reads an authoritative server/database source; reject user-metadata role claims.

**Automated tests**
- Auth invitation and verified-email requirements.
- Self-profile read/update allow; other-member profile/payment-identifier access deny.
- Admin role grant/revoke requires trusted operation and produces audit record.
- Anonymous access tests for every public table/view.
- Static build has no secret-key strings or server-only credentials.

**Dependencies:** Phase 0 approval.

**Deliverables**
- Working local environment, first migration set, member/admin shell, Render static deployment, CI build/type checks, baseline RLS tests.

**Exit criteria**
- A new invited user can join and complete a profile.
- Inactive/suspended users are denied member actions.
- Direct unauthorized role/payment identifier operations fail at the database boundary.
- Preview and production configuration are separate and use no shared privileged secrets.

**Risks and mitigations**
- Risk: role checks recurse through RLS or trust stale JWT metadata. Mitigation: use reviewed authorization helpers with fixed search path and explicit execute grants, or server-side profile lookup; test revocation latency.
- Risk: the static frontend accidentally receives a secret key. Mitigation: build artifact secret scan and environment allowlist.

### Phase 2 — Campsites, rolling calendar, trips, RSVP, and rule acknowledgment

**Objective:** Implement the core trip calendar and RSVP while capturing exactly which rules the participant reviewed.

**Features**
- Seven-site rotation, rolling 12-month schedule, audited overrides and no duplicate months.
- Friday–Sunday defaults, club timezone, administrator date/deadline configuration.
- Coming / Not coming poll and configurable trip minimum.
- Minimum-count basis stored per trip only after owner decision. Opening registration is rejected while it is unset; no default count basis is assumed.
- RSVP withdrawal and admin late entries for confirmed trips.
- Persist a post-confirmation withdrawal request separately; keep it pending until the owner selects immediate effect or administrator approval.
- General rule catalog, trip-specific rules, overrides, effective rule-bundle versioning.
- Coming signup displays all applicable general and trip-specific rule text plus structured values; member must acknowledge before Coming is saved.
- Acknowledgment stores member, trip, immutable rule-set ID/hash, timestamp, and disclosure version. Later rule edits do not invalidate or overwrite it; send informational notices according to notification policy.
- The trip confirmation policy snapshot is distinct from the bundle each participant acknowledged.

**Database changes**
- Campsites, rotation configuration, trips/month keys, RSVP, rule catalog/version, trip-rule associations/overrides, effective rule snapshots, rule acknowledgments, trip history identity.
- Unique trip month key; FK indexes; constraints on dates, threshold, status and acknowledged-version linkage.
- `minimum_basis` enum (`coming_rsvp`, `received_contribution`) and explicit `cabin_payer_coverage_counts_toward_minimum` when basis is `received_contribution`; require all applicable policy choices before trip opens and lock them once registration begins.

**API/function changes**
- Create/edit trip, generate rolling schedule idempotently, submit/update RSVP with required acknowledgment, withdraw, add late entry, apply rule revisions, snapshot effective rules.
- Admin may not open registration until the unresolved basis policy has been explicitly set; scheduler blocks and alerts if a due trip has no basis.
- Use transaction/locking for month generation and RSVP/capacity changes.

**Frontend changes**
- Calendar, campsite rotation display, trip details, binary RSVP, rule bundle review/acknowledgment, RSVP history, admin schedule/rule editor.
- Show rule revision ID/date and acknowledgment receipt in member trip view.

**Security requirements**
- Only active members view member trip data.
- Members can change their own RSVP only while allowed; no browser write to trip lifecycle, minimum, rotation, rule version or acknowledgment timestamp.
- No member may forge another member’s acknowledgment.
- Admin rule updates are versioned and audited; no post-signup re-ack gate per owner decision.

**Automated tests**
- Round-robin and 12-month catch-up produce unique months and preserve canceled month position.
- RSVP concurrency and update/withdraw transitions.
- Coming rejected without acknowledgment; Not coming is permitted without acknowledgment.
- Acknowledgment binds to exact effective rule set/hash and remains unchanged after a later revision.
- Revisions produce informational change notices but do not change prior acknowledgment or require new acceptance.
- Test both minimum-basis variants, missing-basis fail-closed handling, both withdrawal-policy variants after owner selection, and any retained booking-verification gate.
- RLS: member sees permitted trip fields and own RSVP/ack; cannot update another member or admin-controlled fields.

**Dependencies:** Phase 1.

**Deliverables**
- Calendar/trips/RSVP/rules flows; schema and API contract implementation; generated client types; RLS and state tests.

**Exit criteria**
- Every Coming RSVP has a durable acknowledgment of the exact rules shown.
- No trip opens or reaches cutoff without its explicitly selected minimum basis; basis cannot change after registration opens.
- Registration and trip lifecycle are separate; the legacy `Closed — Pending Decision` label is not used until the optional booking gate is decided.
- Duplicate generation, racing RSVP changes and stale updates are safe.
- Tests prove visitors cannot enumerate member participation.

**Risks and mitigations**
- Risk: human-readable rule text and machine behavior diverge. Mitigation: version text and structured fields together, validate typed values, show both from one immutable bundle.
- Risk: member sees older rules than current. Mitigation: preserve prior acknowledgment and show an informational rule-change notice without rewriting history.

### Phase 3 — Cabin reservation, lifecycle automation, and reliable email

**Objective:** Implement the owner-selected minimum-count basis, deadline confirm/cancel behavior, cabin tracking, $50 collection timing for that basis, and durable notification delivery.

**Features**
- Cabin booking record, booking amount/reference, contractual refund deadline, five-day safety buffer, derived registration cutoff.
- At cutoff, count only according to immutable per-trip settings: `coming_rsvp` counts active Coming responses; `received_contribution` counts active Coming with a full $50 recipient-confirmed receipt, plus payer booking-coverage marker only if explicitly approved. If the selected count meets minimum, confirm; otherwise automatically cancel and notify. If any required basis setting is missing, block the transition and alert primary/backup administrators.
- Post-confirmation attendance drop below minimum triggers an administrator proceed/cancel decision; never auto-cancel.
- Late additions to confirmed trip; explicit administrator reinstatement after cabin availability verification for an auto-cancelled trip.
- Per-trip assigned cabin payment recipient and accepted payment method/instructions, required before registration opens.
- For `coming_rsvp`, create/request the $50 contribution after confirmation. For `received_contribution`, request it at Coming signup and send reminders before cutoff; only recipient-confirmed receipt counts, not member-marked-sent or provider email acceptance. Payer booking coverage follows the separate explicit setting.
- Cabin cancellation requested/confirmed/refund amount tracking separate from club trip state.
- Transactional email outbox, idempotency, delivery attempts, retry, invalid-address admin workflow, recipient status and admin escalation.
- Scheduled deadline/outbox processing every five minutes with catch-up scan and durable run results.

**Database changes**
- Cabin reservations, trip decisions, lifecycle events, contribution obligations/events/refund-resolution fields, notification outbox/delivery attempts, scheduled-job runs, operations alerts, immutable rule snapshots.
- Contribution amount is 5000 cents for this approved design.
- Under `coming_rsvp`, no contribution is due before confirmation. Under `received_contribution`, obligations/receipts can exist before confirmation; if the trip cancels for insufficient paid participation, preserve them as unresolved and block close until an owner-approved refund/credit policy is applied.
- Confirmed-trip cancellation contribution resolution remains an explicit owner policy; schema can represent refund, cabin-cost credit, or unresolved without automatic choice.

**API/function changes**
- Registration cutoff process, administrator reinstate/decision, manual cabin-cancellation confirmation/refund recording, assign cabin recipient, generate confirmation/cancellation email, record contribution sent/received, retry outbox.
- Cron functions are idempotent and protected using current documented service-to-service authentication. User functions use verified user auth and caller RLS context.
- Each function enforces legal state transitions transactionally and writes audit/outbox records in the same commit.

**Frontend changes**
- Admin reservation editor and cancellation action checklist.
- Member status page with confirmation, $50 amount, assigned recipient, accepted channel, safety warning, payment status.
- Admin delivery attempts, per-recipient failures, contribution status and manual reconciliation view.

**Security requirements**
- Only an admin changes trip/cabin lifecycle, cancellation request, recipient assignment or refund decisions.
- Member can mark only their own contribution sent; assigned recipient/admin can confirm receipt.
- No public access to cabin references, payment identifiers, delivery payloads, or outbox.
- No scheduled endpoint trusts an unauthenticated browser request.

**Automated tests**
- Exact cutoff derivation and boundary timezone behavior.
- Conditional basis A tests: four Coming confirms; three Coming cancels, with contributions requested only after confirmation.
- Conditional basis B tests: four Coming with qualifying full receipts confirms; four Coming with only three qualifying contributions cancels. Test payer booking marker both ways under explicit policy setting; marked-sent is not received. Cancellation with pre-cutoff receipts remains unresolved and cannot close absent an owner policy.
- Duplicate/missed Cron invocation is idempotent and catch-up recovers.
- Member add and post-confirmation drop, admin decision, reinstatement requires verified availability.
- Confirmation email includes assigned payer, amount and payment instruction; failed email remains queued and escalates.
- Receipt, withdrawal, refund and unresolved cancellation state transitions are audit-complete.

**Dependencies:** Phase 2 and an explicit owner decision on minimum-count basis and contribution timing. Post-confirmation and insufficient-paid-participation cancellation resolution require separate owner-approved policies before automated financial disposition.

**Deliverables**
- Trip lifecycle and cabin workflows, notification provider adapter, Cron definitions, admin runbook and scenario evidence.

**Exit criteria**
- Simulated missed jobs catch up without duplicate email or repeated cancellation.
- A trip cannot open registration without cabin recipient/payment instructions.
- Cancellation email failures and unresolved cabin cancellations are visible outside website traffic.
- System does not automatically dispose of funds under an unapproved policy.

**Risks and mitigations**
- Risk: Free Supabase pauses and deadline job does not execute. Mitigation: separate calendar and manual deadline/cancellation checks, external monitor, restore/catch-up test; block launch certification until the operational gate passes.
- Risk: email provider accepts but does not deliver. Mitigation: distinguish accepted/delivered/bounced/failed when provider supports it, track per recipient, maintain admin follow-up.

### Phase 4 — Trip preparation, transportation, responsibilities, and lodging

**Objective:** Deliver all member signup preferences and trip coordination features.

**Features**
- Packing checklist and per-trip admin additions.
- Coffee/tea choices for Saturday and Sunday mornings.
- Vegetarian/non-vegetarian default and per-meal override, not-eating choice, admin-set freeze cutoff.
- Responsibilities across Friday night, Saturday morning, Saturday night, Sunday morning; first-come claims with concurrent capacity enforcement; Needs assignment overflow.
- Admin tasks including activity planning; driving counts toward workload.
- Vehicle/driver/occupants/mileage/reimbursement eligibility and documented exceptions.
- Bed count, server random floor draw with eligibility snapshot, count input, reasoned reruns, mutual exchanges and audit history.

**Database changes**
- Packing items/responses, meal slots/preferences/freeze, responsibility definitions/slots/claims, vehicles/occupants/mileage, lottery draw/eligibility/result/exchanges.

**API/function changes**
- Submit/freeze meal preferences, claim/release responsibility slot, admin add slot/override, assign vehicle/driver, record trip mileage/exception, run lottery, request/accept bed exchange.
- Database transaction or atomic RPC for claims and draw persistence.

**Frontend changes**
- Signup forms, assignment availability and Needs assignment view, admin workload balancing, transportation planner, lottery control/result/history, exchange consent.

**Security requirements**
- Members edit only own preferences and claim/release permitted slots.
- Admin-only assignment/vehicle/draw overrides require audit reason.
- Lottery selection generated server-side from trip roster; clients never provide chosen names or random seed.
- Meal/diet data only visible to trip participants/admin and purged by retention rules.

**Automated tests**
- Concurrent last-slot claims allow one winner and preserve RSVP.
- Full slots route signup to Needs assignment.
- Frozen preference edits reject unless admin with audit.
- Driving workload flag and carpool eligibility thresholds.
- Lottery eligible roster/count, cryptographic randomness source, retained reruns and bilateral exchange.
- Unauthorized member cannot change another member's assignment.

**Dependencies:** Phases 2 and 3.

**Deliverables**
- Member preparation experience and admin trip-planning tools.

**Exit criteria**
- Signup remains possible when responsibility capacity is exhausted.
- The draw input/result/actor/time and algorithm can be audited; deterministic replay uses a committed, privately retained encrypted seed. Replayability is not represented as proof of unbiasedness. The first draw remains authoritative; reruns require a reason.
- Dietary preferences cannot silently become expense allocations.

**Risks and mitigations**
- Risk: lottery reruns undermine fairness. Mitigation: first draw is authoritative; rerun requires reason and prior result stays in audit.
- Risk: operational signup data is retained indefinitely. Mitigation: retention job and deletion acceptance tests.

### Phase 5 — Expenses, allocations, imports, and expense lock

**Objective:** Collect trip expenses and participant subsets safely and establish a reviewed, locked expense input set.

**Features**
- Expense capture with payer, category, amount, date, description, receipt, participants and allocation proposal.
- Shared food/non-alcohol target and alcohol opt-in subset protections.
- Equal/custom/percentage/individual allocations and driver reimbursement.
- Admin corrections, approval, rejection, all-attendee allocation exception with reason.
- Configurable expense deadline, dispute resolution and expense lock.
- Optional local Python campsite availability research and import. Validate data, provenance, stale status, duplicates and admin approval before creating/updating campsite availability.

**Database changes**
- Expense categories, expense records, allocations, receipt metadata/storage, expense reviews/adjustments, locks, availability import/job records, source snapshots.
- FK indexes, nonnegative cents, allocation sum invariant enforced transactionally.

**API/function changes**
- Submit expense, change proposed allocation, upload receipt through restricted storage path, admin review/adjust/reject, lock/reopen, import availability draft/approve.
- No import may create trip records automatically.

**Frontend changes**
- Member expense form, participant selector, opt-in alcohol split, receipt view, admin review table/disputes, expense deadline/lock, availability import review.

**Security requirements**
- Members can submit own expenses and propose allocations; recipients can read only allowed expense details.
- Receipts remain private to payer, allocated participants and admin.
- Approved expenses cannot be client-mutated; admin reopen requires audit.
- Python utility stores no Supabase secret; publication uses authenticated admin Edge Function.

**Automated tests**
- Allocation cents sum exactly to expense amount under remainders.
- Payer outside allocation handled correctly.
- Alcohol subset excludes non-opt-ins; charging all attendees blocked absent admin approval.
- Admin correction/rejection and reopen create audit record; locked set rejects member edits.
- Receipt unauthorized read denied.
- Import malformed/stale/duplicate data quarantined; only approved import becomes current.

**Dependencies:** Phases 1–4.

**Deliverables**
- Expense workflows and reviewed availability-import path.

**Exit criteria**
- Locked expense snapshot is immutable and content-hashed.
- Every submitted amount has explicit payer and exact allocation total.
- Imports are reviewable drafts and do not overwrite verified information silently.

**Risks and mitigations**
- Risk: non-attendees are charged. Mitigation: expense allocations reference trip participants; actual attendance is reconciled before lock; all-attendee split requires admin reason.
- Risk: receipt storage is exposed. Mitigation: bucket is private; short-lived signed URLs only after server authorization; deletion job and test.

### Phase 6 — Cabin contribution reconciliation, settlement engine, and payments

**Objective:** Net all trip expenses and advances into a deterministic, auditable minimal payment plan and track external payment completion.

**Features**
- Pure TypeScript exact minimum-transfer solver for groups at or below the owner-approved bound; deterministic fallback above it.
- Whole-trip aggregation across expenses with different participant subsets.
- Cabin $50 advances and cabin payer's upfront booking payment are reconciled once against cabin expense.
- Settlement preview; admin-only finalize; immutable version and transfer ledger; payment method instructions and warning.
- Payer marks sent; recipient/admin confirms received; disputes and explicit resolutions.
- Corrections create immutable numbered adjustments preserving prior sent/received transfers and unpaid balances.
- 12-month minimal ledger retention; 3-month detailed payment identifiers/receipt retention.

**Database changes**
- Financial policy snapshots, settlement runs/versions, per-member balances, transfers, payment events, prior-version references, reconciliation link to cabin contribution and expense advances.
- Constraints prevent duplicate run versions, self-transfers, non-positive amounts, duplicate idempotency keys, nonmember parties and mutation after finalization.

**API/function changes**
- Preview settlement, admin finalization transaction, send/receive acknowledgments, dispute resolution, revision creation, close, retention cleanup.
- Finalize includes locked expense hash, current rule snapshot id, solver version, balance result, transfer set, actor, timestamp and idempotency key.
- Revision uses immutable prior payments as credits already settled; never delete/rewrite the original transfer list.

**Frontend changes**
- Settlement preview, user-specific instructions, sent/received status, dispute form, admin correction workflow and audit timeline.

**Security requirements**
- Admin only previews/finalizes/adjusts/closes.
- Members read only transfers where payer or recipient; only payer marks sent; recipient or admin confirms receipt.
- Payment identifier lookup is restricted to involved parties/admin and omitted from long-retention ledger.
- No browser calculation is accepted as authoritative.

**Automated tests**
- See SETTLEMENT_ENGINE_SPEC.md and TEST_STRATEGY.md. Include oracle comparison for exact solver, properties/invariants, fallback determinism, advances, payer excluded from allocation, subset expenses, partial payments and versioned adjustments.
- RLS tests for each finance table and transfer party.

**Dependencies:** Phase 5; owner approval for minimum-count basis (and any outstanding received-contribution cancellation policy), solver ceiling/method-compatible tie-breaker, club-cancellation contribution resolution, and contribution surplus/withdrawal-excess treatment.

**Deliverables**
- Independently testable TypeScript engine, transactionally finalized versioned settlement, payment tracking, privacy/retention controls.

**Exit criteria**
- Financial invariants pass for all deterministic and generated cases.
- Re-running the same input and algorithm version returns byte-identical balances and transfers.
- Partial payments and cabin advances are applied once; excess contribution receipts remain unapplied and block closure; no transfer is emitted to self.
- No financial state can be finalized or corrected through direct client writes.

**Risks and mitigations**
- Risk: an optimizer incorrectly claims minimum. Mitigation: brute-force oracle for all small test vectors and compare exact count to independent solver.
- Risk: settlement revision double-counts payments. Mitigation: append-only payment events and versioned adjustment against prior confirmed/sent amounts.
- Risk: contribution cancellation policy is ambiguous. Mitigation: do not auto-refund/forfeit; keep status unresolved and block closure until approved admin action.

### Phase 7 — Notifications, retention, member history, and end-to-end journeys

**Objective:** Complete cross-module operational behaviors, historical retention and member journeys.

**Features**
- Invitations, signup acknowledgments, RSVP reminders, confirmation/cancellation, preference freeze, expense deadlines, settlement instructions, correction notices, delivery failure escalation.
- Inactive member departure without destroying attendance/financial history.
- Retention cleanup for operational trip data, receipt files, identifiers and ledger snapshots.
- Full member/admin journeys and accessibility/mobile validation.

**Database changes**
- Retention job state/markers, notification status views and history summary, historical attendee snapshot fields, final indexes based on observed queries.

**API/function changes**
- Idempotent notification workers and retention jobs; admin correction of invalid email, retry and reconcile.
- Schedule generation and cleanup catch-up operation with unique keys.

**Frontend changes**
- Member notification status, admin delivery/retry dashboard, personal trip history, privacy-safe closure summary, member deactivation view.

**Security requirements**
- Outbox and audit payloads do not include full payment identifiers or unnecessary sensitive data.
- Inactive members cannot authenticate or access current trips; required historical FK is preserved.
- Cleanup job cannot delete immutable settlement ledger inside retention window.

**Automated tests**
- Full invite-to-trip-to-close journeys.
- Idempotency and retry exhaustion, admin alerts, retention boundaries/time zones.
- Member deactivation preserves historical ledger and attendee summary.
- Rule acknowledgment stays tied to signup rules version after rule edits.

**Dependencies:** Phases 1–6.

**Deliverables**
- End-to-end application journeys, retention automation, notification operational UI.

**Exit criteria**
- A full test trip completes from poll through closed settlement with all role boundaries enforced.
- Retention deletes only eligible data and preserves required 12-month financial evidence and high-level history.

**Risks and mitigations**
- Risk: lifecycle modules diverge. Mitigation: shared state-machine contract and integration tests.
- Risk: backups retain deleted in-app data. Mitigation: documented backup age and expiry; exercise restore-and-reapply-retention runbook.

### Phase 8 — Production-readiness certification and controlled launch

**Objective:** Certify architecture, security, financial correctness, scheduling, email, recovery, deployment and cost limits before real club use.

**Features**
- Render Static Site release process, HTTPS/domain, SPA rewrite and rollback rehearsal.
- Supabase migrations and Edge Functions deployed through versioned source.
- Independent scheduler monitor, manual cabin-deadline calendar, backup/export, restore drill, email failure playbook, operator access review.
- Final launch checklist, administrator training, incident exercises, usage/cost review.

**Database changes:** Only reviewed hardening migrations; no unreviewed production schema editing.

**API/function changes:** Production secrets/config, tested job execution, idempotency and recovery endpoints.

**Frontend changes:** Production configuration and validated deployment artifact only.

**Security requirements**
- Run complete table-by-table RLS allow/deny suite and Supabase security/database advisors.
- Verify policies/grants on all exposed tables, views and functions; deny unsafe schema exposure.
- Inspect built assets and network requests for secret/payment-ID disclosure.
- Admin least privilege and account recovery documented.

**Automated tests**
- Complete suite from TEST_STRATEGY.md in clean CI and local Supabase.
- Migration forward test and rollback/forward-fix rehearsal on seeded disposable data.
- Deadline outage, paused-project recovery, notification retry exhaustion, backup restore, and settlement disaster cases.

**Dependencies:** Phases 1–7; owner approval of unresolved policies; operational credentials and provider setup.

**Deliverables**
- Certification report with PASS / PASS WITH RISK / BLOCKED for every gate.
- Versioned deployment artifact, recovery evidence and runbooks.
- Launch readiness and cost statement.

**Exit criteria**
- Every critical financial/security/reliability gate is PASS.
- Any PASS WITH RISK is noncritical and explicitly accepted by owner.
- Off-site export and restore meet the approved RPO 24 hours/RTO one business day target.
- Supabase Free deadline recovery is tested or the manual independent fallback is staffed and exercised; no cabin refund deadline depends solely on an unverified Cron.
- No app launch if any critical risk remains BLOCKED.

**Risks and mitigations**
- Risk: Free-tier inactivity, backup/export or email limitations differ from assumptions. Mitigation: recheck provider documentation and perform actual restore/delivery exercises before launch.
- Risk: Render code rollback paired with incompatible schema. Mitigation: expand-migrate-contract database changes, backward-compatible deploys, documented forward fix and data restore options.

## Proposed implementation sequence

1. Approve this plan and the unresolved owner decisions in Phase 0.
2. Phase 1 foundation and access.
3. Phase 2 trip, RSVP and signup rule acknowledgment.
4. Phase 3 cabin reservation, deadline lifecycle and email.
5. Phase 4 trip preparation, responsibilities, transport and lottery.
6. Phase 5 expenses, review, lock and availability import.
7. Phase 6 contributions, settlement, payment acknowledgment and revisions.
8. Phase 7 complete journeys, retention and member history.
9. Phase 8 certification and controlled launch.

Do not parallelize phases that share database lifecycle/financial contracts. A local Python availability utility may be developed after Phase 2 as a separate, optional workstream, but its import contract and approval gate remain governed by Phase 5.

## Dependency map

| Phase | Depends on | Blocks |
| --- | --- | --- |
| 0 Plan/policy baseline | Approved design and owner review | All coding |
| 1 Foundation | Phase 0 | All feature phases |
| 2 Campsites/trips/RSVP/rules | Phase 1 | 3–7 |
| 3 Lifecycle/cabin/email | Phase 2 | 4–8 |
| 4 Preparation/logistics | Phases 2–3 | 5–8 |
| 5 Expenses/imports | Phases 1–4 | 6–8 |
| 6 Settlements/payments | Phases 3 and 5 | 7–8 |
| 7 Retention/end-to-end | Phases 1–6 | 8 |
| 8 Certification | Phases 1–7 | Controlled launch |

## Architecture certification gates

| Gate | Required evidence | Blocking condition |
| --- | --- | --- |
| G1: Persistence and deployment | Render static deployment; production data survives redeploy; config separation; migration replay | Persistent data depends on Render filesystem or migration cannot replay |
| G2: Identity and security | Every table has explicit grants/RLS; role and payment-ID denial tests; function auth tests | Any unauthorized row/column/function access |
| G3: Trip lifecycle | Time-zone cutoff tests; confirm/cancel/outbox idempotency; admin reinstatement/cabin verification | Deadline can silently miss or duplicate action |
| G4: Financial integrity | Invariants, exact optimizer oracle, advances, excess receipts, partial payment and adjustment tests | Any cent imbalance, double count, unresolved excess treated as available funds, or mutable finalized record |
| G5: Operations and recovery | Independent job monitor, manual cancellation calendar, off-site export, successful restore drill | RPO/RTO or cabin deadline recovery not demonstrated |
| G6: Public launch | All critical gates pass; admin runbook, support/contact, cost review and owner acceptance | Any critical gate BLOCKED or unresolved financial policy in active workflow |

## Unresolved decisions requiring owner approval

1. **Minimum-count basis (critical):** Select active Coming RSVPs, or active Coming RSVPs plus recorded $50 contribution. The received basis moves contribution collection before cutoff. Neither is owner-approved; the amended design states the latter and later planning text states the former.
2. **Cabin payer threshold treatment:** If received-contribution basis is selected, decide whether the attending payer's documented booking-coverage marker counts toward the minimum even though it is not an external cash receipt. No default is assumed.
3. **Pre-confirmation / premature contributions:** Under the received basis, decide refunds/credits when an automatic insufficient-paid-participation cancellation occurs. Under Coming-RSVP basis, decide disposition of any premature/extra payment that arrives before it is due. Until decided, preserve money as unapplied and keep financial closure blocked.
4. **Club cancellation after confirmation:** Do not auto-forfeit or refund. Decide the exact refund/credit allocation after reconciling provider refund and non-refundable cost.
5. **Contribution surplus and withdrawal excess:** Decide whether funds above actual cabin cost/share are refunded, retained as club credit, or otherwise handled. Hold unapplied and block closure until approved.
6. **Exact solver bound:** Recommended exact optimum up to 12 nonzero balances; deterministic greedy fallback above 12. Owner approval required before Phase 6.
7. **Payment compatibility tie-break:** Decide whether to collect sender-supported methods and optimize compatibility among equal-transfer-count solutions. If not approved, use stable UUID ordering.
8. **Post-confirmation member withdrawal:** Decide whether a member's request becomes effective immediately or requires administrator approval. Product Vision and later design text conflict.
9. **Cabin-verification gate and poll status:** Decide whether cabin booking verification can delay trip confirmation and whether a separate `Closed — Pending Decision` poll state is required. Later design treats trip confirmation as participation confirmation independent of cabin reservation.
10. **Lottery audit window / independent randomness:** Current recommendation is committed encrypted seed during operational retention, then deletion; this permits replay but does not prove unbiasedness. Approve this tradeoff or specify a longer audit window/independent randomness source.
11. **Operations staffing and recovery target:** Name primary/backup trip admins and backup operator; approve RPO 24h/RTO one business day and approve a $0 off-site backup destination/quota. Blank names block launch certification.

## Architecture compliance checklist

- [ ] React + TypeScript + Vite frontend; Render Static Site only.
- [ ] Supabase Auth/PostgreSQL/RLS; exposed-table behavior and explicit grants verified.
- [ ] Privileged operations use authenticated Edge Functions or narrow transactional database functions.
- [ ] Service/secret keys never enter the browser.
- [ ] Every client-exposed table has RLS and per-operation allow/deny tests.
- [ ] All money is integer cents, deterministic and versioned.
- [ ] Settlement engine is pure TypeScript; exact up to approved cap, deterministic fallback after.
- [ ] Cabin contributions, booking expense and settlement transfers reconcile without double-counting; unresolved excess blocks closure.
- [ ] Coming signup acknowledges immutable effective rule bundle; trip minimum basis is explicit, owner-approved, and immutable once registration opens.
- [ ] Cron and notification work are idempotent, catch-up-safe, monitored independently of Render traffic.
- [ ] Supabase Free pause/backup constraints have exercised runbook/manual fallback.
- [ ] Off-site backups encrypted/restricted; restore test meets approved RPO/RTO.
- [ ] Render deployment, environment separation and database-safe rollback validated.
- [ ] Optional availability collection stays local Python with authenticated, reviewed import.
- [ ] Full product scope is complete before public launch; no polls-only launch.
- [ ] All critical architecture certification gates are PASS.

## Phase 1 start recommendation

**New application coding remains blocked until the owner explicitly approves the applicable implementation plan and phase.** Existing Phase 1/2 source on `main` does not authorize additional changes or deployment. Phase 2/3 trip lifecycle work remains blocked until the minimum basis, withdrawal behavior and cabin-verification-gate decisions are recorded. Cancellation/excess accounting and the exact solver cap remain gates for their later phases.
