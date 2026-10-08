# State Machines — Private Camping Club Platform

**Status:** Planning contract. Every transition below is enforced by a trusted operation and captured in an append-only event/audit record. The minimum-count basis, post-confirmation withdrawal effect, and booking-verification gate are unresolved owner decisions; affected transitions fail closed until approved.
**Related:** [Database Schema](DATABASE_SCHEMA.md), [API Contracts](API_CONTRACTS.md), [Owner Decision Record](OWNER_DECISIONS.md)

## 1. Trip lifecycle

Registration and trip status are separate state dimensions. The columns `camping_trips.registration_status` and `camping_trips.trip_status` are current projections; `trip_lifecycle_events` is authoritative transition history. `minimum_basis` is null until explicitly owner-approved and is immutable after registration opens.

| Current state | Event / guard | Next state | Authority and side effects |
| --- | --- | --- | --- |
| Draft | Admin finishes setup, dates valid, rule bundle exists, cabin payee/method exists | Open for registration | Admin operation; records opening time and sends poll-open notice. |
| Open | Deadline job reaches calculated cutoff; approved basis is `coming_rsvp`; active Coming RSVP count >= minimum | Confirmed | Scheduler transaction locks trip; snapshots effective rules; creates $50 obligations for confirmed roster; queues confirmation/payment-request emails. |
| Open | Deadline job reaches cutoff; approved basis is `coming_rsvp`; active Coming RSVP count < minimum | Cancelled — minimum not met | Scheduler transaction locks trip; no $50 obligations are created; queues cancellation notice and separate cabin-cancellation task. |
| Open | Deadline job reaches cutoff; approved basis is `received_contribution`; active Coming members with qualifying full $50 evidence >= minimum | Confirmed | Same transaction records decision evidence, snapshots rules and queues notices. Sent/pending never counts. Whether an attending cabin payer's non-posting booking-coverage marker qualifies is a separate required owner choice. |
| Open | Deadline job reaches cutoff; approved basis is `received_contribution`; qualifying count < minimum | Cancelled — minimum not met | Cancels club trip and queues notices/cabin task; any pre-confirmation receipts become unresolved until approved disposition is applied. |
| Open | Cutoff reached while `minimum_basis` is null or invalid | Open; deadline exception | No confirm/cancel or financial disposition. Record failed decision event, alert primary/backup administrators, use manual fallback. |
| Open | Admin cancels before cutoff | Cancelled — admin decision | Admin reason required. Under `coming_rsvp`, no contribution is due before confirmation; under `received_contribution`, any existing receipts stay unresolved pending approved disposition. Cabin action is recorded separately. |
| Confirmed | Member requests withdrawal; owner-selected mode is immediate | Confirmed; withdrawal effective | Atomically record request and effective event, preserve $50 obligation/payment events, release eligible assignments, update active count, notify admin/member. |
| Confirmed | Member requests withdrawal; mode requires admin approval or remains unset | Confirmed; withdrawal request pending | Record request and notify admin. Do not change active count or assignments until approval; if mode is unset, fail closed and alert admin. Preserve $50 obligation and immutable events. |
| Confirmed; withdrawal request pending | Admin approves | Confirmed; withdrawal effective | Record actor/reason, preserve $50 obligation/payment events, release eligible assignments, update active count, notify affected parties. |
| Confirmed; withdrawal request pending | Admin rejects | Confirmed; Coming | Record actor/reason; retain Coming response and assignments; notify affected parties. |
| Confirmed | Effective withdrawal changes attendance below minimum | Confirmed — admin decision needed | Alert admin; do not auto-cancel. Admin explicitly proceeds or cancels. |
| Confirmed | Admin decision to proceed | Confirmed | Reason and attendee count recorded; notify affected members. |
| Confirmed | Admin decision to cancel because participation is insufficient | Cancelled — post-confirmation | Require reason; start cabin cancellation and contribution reconciliation; no automatic refund or forfeiture until approved policy is implemented. |
| Cancelled — minimum not met | Admin verifies cabin still available and adds/retains enough Coming participants | Confirmed | Explicit reinstatement event, proof/evidence note and admin actor; send confirmation and $50 requests. |
| Cancelled — minimum not met | Cabin unavailable or reinstatement rejected | Cancelled | Terminal for this trip occurrence; rotation position remains unchanged by default. |
| Confirmed | Trip dates pass and actual roster is recorded | Completed | Admin operation; releases trip preparation data to actual-attendance review and expense collection. |
| Completed | Expenses/settlement closed and retention eligibility reached | Closed / history only | Cleanup job removes operational data under retention rules; high-level summary and 12-month ledger remain. |

Rules:
- “Trip confirmed” means club participation threshold is met; it does not mean the cabin is reserved or its cancellation is confirmed.
- The threshold is evaluated at registration cutoff, not immediately when the fourth person responds. Its basis is unresolved: the amended source design requires active Coming plus recipient-confirmed $50; later planning prose says active Coming alone and collects after confirmation. Neither is approved. Under the received basis, whether a documented cabin-payer booking-coverage marker qualifies instead of a cash receipt is also unresolved. Do not open registration until all applicable choices are explicit.
- Reinstatement always verifies current cabin availability and minimum participation.
- Any external reservation action stays separate and manually confirmed.

## 2. RSVP and rule acknowledgment

### Rule bundle lifecycle

1. Admin publishes a new effective rule bundle as an immutable version with content hash.
2. At Coming signup, the member sees the complete applicable general + trip-specific rule text and structured values.
3. The atomic signup operation verifies the bundle ID/hash shown, records an immutable acknowledgment (member, trip, bundle, hash, statement version, timestamp), then records Coming.
4. Not coming does not require acknowledgment.
5. A later rule edit creates a new bundle. Existing acknowledgments remain bound to the exact earlier bundle; no re-ack gate is applied. A notice may be sent, but it does not overwrite the acknowledgment.
6. At trip confirmation, the system records the effective policy snapshot separately for operations/financial audit.

### RSVP transitions

| Current | Event / guard | Next | Effects |
| --- | --- | --- | --- |
| No response | Submit Not coming | Not coming | Store response; no rule acknowledgment or contribution. |
| No response | Submit Coming with current bundle acknowledgment | Coming | Create acknowledgment + RSVP atomically; persist signup preferences; claim open responsibility slots or mark Needs assignment. |
| Coming | Update preferences/responsibility before freeze/cutoff | Coming | Update permitted fields with optimistic version; prior acknowledgment unchanged. |
| Coming | Withdraw before confirmation | Withdrawn | Release unclaimed responsibility slots; update threshold count. Under `coming_rsvp`, no $50 is due before confirmation. Under `received_contribution`, preserve any obligation/receipt already created and keep a receipt unresolved if it no longer qualifies; do not refund, retain, or reassign it automatically. |
| Not coming | Change to Coming while open | Coming | Require acknowledgment of current bundle and create signup. |
| Coming | Request withdrawal after confirmation; selected mode is immediate | Withdrawn | Record request and effective events atomically; preserve $50 obligation/payment events; release eligible assignments and notify admin/member. |
| Coming | Request withdrawal after confirmation; mode is admin approval or unset | Coming; withdrawal request pending | Record request; leave RSVP and active count unchanged until approval. If unset, fail closed and alert admin. Preserve $50 obligation; no automatic trip cancellation. |
| Coming; withdrawal request pending | Admin approves | Withdrawn | Record actor/reason and effective event; preserve $50 obligation/payment events; release eligible assignments and notify affected parties. |
| Coming; withdrawal request pending | Admin rejects | Coming | Record actor/reason; request is rejected, RSVP remains Coming; notify affected parties. |
| Any | Trip canceled before confirmation | Cancelled with trip | Under `coming_rsvp`, no $50 obligation is created. Under `received_contribution`, preserve any existing obligations and receipts as unresolved until owner-approved disposition; a premature/extra payment under `coming_rsvp` is also unresolved. Never infer refund or forfeiture. |

A rule acknowledgment means the participant received and acknowledged the displayed bundle. It is not a legal e-signature or a payment authorization.

## 3. Cabin reservation and cancellation

### Cabin reservation state

| Current | Event | Next | Required record |
| --- | --- | --- | --- |
| Not booked | Admin records confirmed booking | Booked | Reservation reference, amount, provider label, contractual cancellation deadline, safety buffer, payer. |
| Booked | Trip must cancel / admin requests cancellation | Cancellation requested | Request time, actor, provider contact/evidence note, refund expected. |
| Cancellation requested | Provider confirms cancellation/refund/credit | Cancellation confirmed | Confirmation time, evidence note, refund/credit amount and status. |
| Cancellation requested | Provider does not confirm before escalation point | Unresolved / escalated | Alert, last contact and assigned follow-up. |
| Unresolved / escalated | Admin confirms outcome | Cancellation confirmed or Booked | Evidence and resolution reason; do not clear alert silently. |

### Trip-cancellation to cabin workflow

1. Trip is cancelled (automatic or admin). The app queues member/admin email and creates a separate cabin-cancellation task.
2. An administrator contacts the campsite/provider; no WhatsApp/email operation is treated as provider cancellation proof.
3. Admin records request and later provider confirmation/refund evidence.
4. For a pre-confirmation cancellation under `coming_rsvp`, no $50 contribution was due. Any premature/extra transfer remains an immutable receipt in unresolved/unapplied status. Under `received_contribution`, obligations and receipts may already exist at the cutoff; preserve them as unresolved/unapplied. Neither case automatically refunds, retains, or reallocates money. Require owner-approved disposition and an audited external action before financial close.
5. If a confirmed trip is later cancelled for insufficient participation, preserve all contribution events and set each contribution to unresolved reconciliation. The app does not automatically refund, retain, or credit money until the owner-approved policy and admin resolution are present.
6. A close operation is blocked while any contribution or cabin refund has unresolved disposition.

## 4. Cabin contribution and payment acknowledgment

| Current | Event / guard | Next | Effects |
| --- | --- | --- | --- |
| Not due | Coming signup under approved `received_contribution` basis | Due: $50 | Append immutable obligation and send instructions before cutoff; recipient confirmation required. |
| Not due | Trip confirmation or late addition under approved `coming_rsvp` basis | Due: $50 | Append immutable obligation and queue amount/payee/method instructions with confirmation notice. |
| Due | Attending obligation owner is recorded cabin payer and vendor booking is documented | Booking coverage acknowledged | Append non-posting marker linked to the vendor-paid fact; no self-payment or fictitious $50 cash receipt. |
| Due | Member records external payment sent | Marked sent | Immutable sent event; not proof of receipt. |
| Due / Marked sent | Assigned cabin payer or admin confirms receipt | Received / partially received | Immutable receipt event with amount/time/actor; optional redacted external reference. Only this qualifies under received-contribution basis. |
| Any unsettled | Dispute raised | Disputed | Blocks close; admin review required. |
| Received | Attendee withdraws | Received — non-refundable; reconciliation pending | Member is not refunded for member-initiated withdrawal. Whether the receipt subsidizes remaining attendees' cabin allocations or stays unapplied above documented cost requires owner approval; no automatic reallocation. |
| Due after confirmation | Attendee withdraws before paying | Still due | Obligation is not removed by withdrawal after confirmation. |
| Post-confirmation trip cancellation | Contribution exists | Unresolved cancellation disposition | Admin applies the owner-approved refund/credit/retention policy and records external action. |
| Refund approved and sent externally | Member or admin records receipt | Refund confirmed | Append refund events; original contribution is never deleted. |
| Contribution applied to cabin expense | Settlement preview/finalization | Credited | Advance is applied once; no duplicate expense or self-transfer. |

If the assigned cabin payer is an attendee, record their vendor payment as a distinct vendor fact and a non-posting marker for their own $50 commitment. No self-payment instruction or fictitious $50 cash receipt is created. Other members' receipts remain separate events.

## 5. Responsibility assignment

Per member and required block:

- Available → Claimed by first successful transaction → remains claimed.
- Available → Concurrent claim loses capacity race → Needs assignment; RSVP remains saved.
- Needs assignment → Admin adds capacity/member selects slot → Claimed.
- Claimed → Member withdraws before lock → Released.
- Claimed → Admin overrides with reason → Admin assigned.
- After trip closure → Operational assignment expires under retention policy.

The database transaction locks the relevant trip/block capacity row and enforces at most the configured number of claims. Client-side availability is advisory only.

## 5. Floor lottery audit and reproducibility

The server locks and stores the eligible roster snapshot/hash and requested count, then selects using a cryptographically secure random source. A draw is **auditable** when the saved input, actor/time, algorithm version, source identifier, result and rerun reason prove what the system recorded. It is **reproducible** only if the exact random seed/source output and algorithm are retained so the same input can be replayed. For reproducibility, use a seed commitment persisted before the draw and keep seed material encrypted in a private, access-restricted record through the operational audit window; delete it with lottery details under retention.

Reproducibility does not prove unbiasedness, prevent a privileged operator from discarding and rerunning results, or provide an independent public randomness beacon. The first draw remains authoritative; reruns require explicit reason and preserve earlier results. No fairness guarantee beyond those controls is claimed. Whether a longer audit window or independent randomness source is required remains an owner decision because it changes retention/operational scope.

## 6. Expense review

| Current | Event / guard | Next | Authority |
| --- | --- | --- | --- |
| Collecting | Member submits valid expense and allocation proposal | Submitted | Member; no charge is final. |
| Submitted | Admin begins review | Under review | Admin. |
| Under review | Amount/receipt/allocation accepted; allocations sum exactly | Approved | Admin with audit. |
| Under review | Invalid or disallowed | Rejected | Admin with reason. |
| Under review | Allocation or receipt questioned | Disputed | Admin/member; blocks lock until resolved or explicitly excluded. |
| Approved | Expense deadline/administrator lock | Locked under immutable lock version | Admin; input set hash stored. |
| Locked | Admin reopens with reason | Collecting under next lock version | Admin; old lock remains immutable. |

Expense approval and settlement finalization are different events. Only actual attendees are eligible for allocation; subset opt-in is preserved.

## 7. Settlement run and version correction

| Current | Event | Next | Effects |
| --- | --- | --- | --- |
| Collecting | Admin approves all expense allocations | Reviewable | Input expenses visible for review. |
| Reviewable | Admin locks expense set and disputes are resolved | Locked | Immutable hash and policy snapshot reference. |
| Locked | Admin requests preview | Preview | Pure engine output, no payment obligation yet. |
| Preview | Input hash still current; admin finalizes | Finalized vN | Atomic immutable balances/transfers/outbox notices. |
| Finalized | All transfers confirmed or explicitly resolved | Closed vN | Retention clock begins. |
| Finalized, no payments sent | Admin finds error | Superseded + new vN+1 | Preserve prior run; adjustment records reason and parent link. |
| Finalized, partial/full payments exist | Admin finds error | New adjustment vN+1 | Preserve old transfer/events; carry confirmed/partial payments as credit; calculate only remaining obligations/refunds. |
| Any open run | Correction not approved or locked input changed | Conflict | No silent recalculation. |

A version never mutates after finalization. A correction is an append-only accounting event with lineage. Any amount already confirmed received cannot be requested again.

## 8. Payment transfer acknowledgment

- Pending → payer marks sent with amount ≤ outstanding → Marked sent or Partially paid.
- Marked sent → recipient/admin confirms received → Partially paid or Confirmed received.
- Any unsettled state → participant disputes → Disputed.
- Disputed → admin records resolution and evidence note → Resolved, or new adjustment run if amount changes.
- Email acceptance, delivery, or opening never changes payment state.
- Multiple partial event rows sum to no more than transfer amount; duplicate idempotency key returns the original event.

## 9. Notification lifecycle

Queued → Claimed by worker → Accepted by provider → Delivered/Bounced/Failed where provider supports status.

- Transient provider/network failure → Retry scheduled with backoff and same idempotency key.
- Permanent bounce or exhausted attempts → Failed and administrator alert.
- A stale claimed item is reclaimable after lease expiry.
- Duplicate scheduler invocation must not produce duplicate user-visible business messages.
- Keep provider response bodies redacted and short-lived; retain safe status metadata.

## 10. Retention lifecycle

Operational records remain available through trip operations and unresolved financial work. At eligible cleanup time:

- Purge WhatsApp invite, packing/meal detail, responsibility and lottery detail per approved retention policy.
- Delete receipt objects and sensitive payment instruction/identifier copies three months after settlement closure (or after dispute resolution when later).
- Keep immutable minimal ledger and effective policy snapshot 12 months after closure/resolution.
- Preserve high-level campsite/location/date/attendee summary.
- Cleanup is idempotent, reportable, and replayed after restore before member access resumes.

## 11. Persistence and authority rules

- Immutable facts: lifecycle events, RSVP acknowledgment rows, cabin obligation rows, contribution events, reservation events, expense review/lock facts, settlement ledger entries, finalized run snapshots, transfer payment events, audit events, and idempotency tombstones.
- Mutable values are projections only: RSVP response, registration/trip status, reservation status, contribution status, expense review status, settlement run/transfer status, and notification delivery status. Each is rebuildable from event history; no status edit can create/delete money or bypass a transition.
- Event append and projection refresh occur in one transaction. A projection mismatch is repaired from events and emits an operational alert.
- Each side-effecting transition has a unique event key/idempotency record and writes its notification-outbox intent in the same transaction. Provider delivery status is separate and never substitutes for a business event.
- The canonical lifecycle-to-persistence mapping is in [State Persistence Matrix](STATE_PERSISTENCE_MATRIX.md); this document defines transitions and that matrix defines database/API/event/notification linkage.
