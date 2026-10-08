# Test Strategy — Private Camping Club Platform

**Status:** Phase 1 automated verification executed locally; later-phase business and operational tests remain planned. See [Phase 1 Certification](PHASE1_CERTIFICATION.md) for evidence and limits.
**Related:** [Requirements Traceability](REQUIREMENTS_TRACEABILITY.md), [Owner Decision Record](OWNER_DECISIONS.md), [Database Schema](DATABASE_SCHEMA.md), [Security Architecture](SECURITY_ARCHITECTURE.md), [Settlement Engine](SETTLEMENT_ENGINE_SPEC.md)

## 1. Test layers

| Layer | Purpose | Preferred tooling |
| --- | --- | --- |
| Pure TypeScript unit/property tests | Settlement arithmetic, date/deadline logic, deterministic policies | Vitest; property generator selected/pinned in Phase 1 |
| Database tests | Constraints, transaction invariants, grants/RLS allow-deny | Supabase local stack + pgTAP + supabase test db |
| Edge Function contract tests | Authn/authz, request validation, idempotency, provider behavior | Local Supabase Edge Runtime + Node fetch integration harness |
| Component tests | Accessible forms, rule acknowledgment, member/admin actions | React Testing Library + DOM assertions |
| End-to-end | Member and admin journeys, mobile layout, email test sink, deployment smoke | Playwright or equivalent pinned browser runner |
| Operational exercises | Cron catch-up, export/restore, monitoring, failure handling | Scripted integration runbook with recorded evidence |

Tool versions are pinned in lockfiles and rechecked against current Supabase support before platform changes. Phase 1 tests use synthetic local accounts and Supabase's local email sink; they never use real member/payment data.

### Phase 1 executed test IDs

| ID | Requirement / scenario | Layer | Executed result |
| --- | --- | --- | --- |
| SEC-14 | Public email signup is disabled while admin invitation and verified profile completion work | Local Auth/Edge integration | Pass: anonymous signup rejected; bootstrap admin and ordinary invited member complete only against matching HMAC invitation. |
| SEC-15 | Bootstrap grants one initial admin only; later bootstrap is blocked once an active admin exists | Edge + pgTAP | Pass: first admin activated in integration; pgTAP proves active-admin guard. |
| SEC-16 | Mutating actions require Idempotency-Key; replay, conflict, concurrency and expiry are correct | Edge + pgTAP | Pass: replay returns same safe result; changed payload conflicts; in-progress duplicate does not execute; expired replay rejects. |
| SEC-17 | Payment identifier is encrypted before persistence and never returned by safe API/Data API | Edge integration + SQL inspection + bundle scan | Pass: AES-GCM ciphertext, fresh 12-byte nonce and key version observed in private storage; public response and Data API contain no identifier. |
| SEC-18 | Active member cannot read another profile/method or change role directly; admin transition is audited | RLS + Edge integration | Pass: own read succeeds, other-member read is filtered, direct role update fails, non-admin action gets 403, admin update produces one audit event. |
| SEC-19 | Existing JWT loses member API access immediately after account suspension | Edge integration | Pass: same test JWT receives 403 after server-side status change. |
| UI-01 | Invitation-only sign-in and profile form interaction | Vitest + local Chrome smoke | Pass: 8 component assertions and one desktop/mobile browser smoke; no horizontal overflow or page/console errors. |

Executed commands: `npm run typecheck`, `npm test`, `npm run test:db`, `npm run test:integration`, `npm run build`, `npm run security:scan`. The integration script starts no hosted service and resets only local Supabase. A temporary, non-locked Playwright package was used for the browser smoke; browser automation is not a committed dependency.

## 2. Automated test inventory and acceptance criteria

### Identity, membership, and access

| ID | Requirement / scenario | Layer | Pass criteria |
| --- | --- | --- | --- |
| SEC-01 | Visitor accesses private profile, roster, expense, finance and admin routes | RLS + E2E | Zero private rows/identifiers; direct Data API and UI both deny. |
| SEC-02 | Each public table/view grants only intended published fields | RLS | Anonymous SELECT succeeds only for explicitly published data; writes always fail. |
| SEC-03 | Active member reads/updates own profile and payment method | RLS + function | Own allowed fields succeed; role/status and another member's data fail. |
| SEC-04 | Inactive/suspended member uses existing session | Function + RLS | All member mutations and private reads are denied after server-side status change. |
| SEC-05 | Member forges user ID, role, trip ID, recipient ID or payment owner in request | Function | Server derives identity from verified JWT and relationship checks; forged values cannot widen access. |
| SEC-06 | Admin operations attempted by member; role claim forged in user_metadata | Function + RLS | Denied; only authoritative member role grants admin. |
| SEC-07 | Table-level RLS matrix for every schema entity, CRUD × role | pgTAP | Each table has explicit allow/deny assertions for anon/member/admin/recipient/system; no table is omitted. |
| SEC-08 | Unsafe view, function or private schema grant | Catalog test + pgTAP | Public execute/grant and security-definer exposure are absent; view uses invoker controls or private schema. |
| SEC-09 | Payment identifiers in unauthorized query, logs, audit or notification | Integration + privacy assertion | Only exact authorized payer/recipient/admin receives needed recipient identifier; logs/audit contain none. |
| SEC-10 | Receipt storage path guessing/expired signed URL | Storage + RLS | Non-party cannot read; expired URL fails; object delete occurs by retention. |
| SEC-11 | Direct Data API query for another member's payment identifier | Data API/grants/RLS | No public identifier column/table is exposed; direct query is denied even for authenticated members; private schema has no anon/authenticated grants. |
| SEC-12 | Identifier instruction disclosure | Edge contract + audit | Exact obligated payer and recipient paths only; unrelated member/admin denied; no-store response, reason/audit event for admin exception, no plaintext in logs/cache/analytics. |

### Trips, rules, acknowledgment and commitments

| ID | Requirement / scenario | Layer | Pass criteria |
| --- | --- | --- | --- |
| TRIP-01 | Twelve-month schedule generation runs twice and after a missed month | DB/function | Unique month keys; no duplicate trips; correct rotation position preserved. |
| TRIP-02 | Registration cutoff equals earlier of default 35 days and contractual deadline minus buffer | Unit + DB | Exact local timezone/DST boundaries match documented calculation; cutoff is before booking deadline by buffer. |
| TRIP-03A | `coming_rsvp` basis: four active Coming at cutoff | DB/Edge integration | One Confirmed transition, one policy snapshot, one $50 obligation per attendee only after confirmation, one notice per recipient. |
| TRIP-03B | `received_contribution` basis: four active Coming with full recipient-confirmed $50 receipts | DB/Edge integration | One Confirmed transition; only full `received` events by cutoff count. Marked-sent, email acceptance, partial receipts and non-Coming members do not count. |
| TRIP-03C | Received-basis cabin payer coverage setting | DB/Edge integration | Setting is required before registration opens. Marker counts iff explicitly approved true; false excludes it. Missing setting fails closed. No cash receipt is fabricated in either branch. |
| TRIP-04A | `coming_rsvp` basis: three active Coming at cutoff | DB/Edge integration | One automatic cancellation and notices; no $50 obligations due before confirmation. |
| TRIP-04B | `received_contribution` basis: fewer than four qualifying paid members | DB/Edge integration | Automatic trip cancellation and notices; any pre-cutoff receipts remain unresolved/unapplied and block financial close until approved policy. |
| TRIP-04C | Missing/unapproved basis at cutoff | DB/Edge integration | Fail closed: no confirm/cancel transition, no money movement/disposition, one durable ops alert and manual fallback. |
| TRIP-05 | Repeated or late deadline processing | Integration | Idempotent result, no duplicate lifecycle events, contribution rows or emails. |
| TRIP-06 | Coming signup without rule acknowledgment | Edge + E2E | Rejected with actionable field error; no RSVP/preferences/claims partially written. |
| TRIP-07 | Coming signup records exact rule bundle | DB + E2E | User, trip, content hash, bundle and time are immutable and retrievable by the signer. |
| TRIP-08 | Rules change after existing signup | DB + Edge | Prior acknowledgment remains tied to old bundle; no re-ack required; informational notice may be queued; confirmation policy snapshot captures effective rules separately. |
| TRIP-09 | Not coming response | Edge + E2E | Can be recorded without acknowledgment or signup preferences. |
| TRIP-10 | RSVP withdrawal before and after confirmation | State/Edge | Pre-confirm withdrawal updates count/releases slots; under `received_contribution`, any prior obligation/receipt remains immutable and unresolved if no longer qualifying. With immediate mode selected, the request and effective event commit atomically. With admin-approval mode selected, request leaves RSVP/count unchanged until approve/reject. Unset mode fails closed. All branches preserve the $50 obligation and never auto-cancel trip. |
| TRIP-11 | Late addition to confirmed trip | DB/Edge | Unique RSVP, $50 obligation, payment notice and audit event are created exactly once. |
| TRIP-12 | Reinstatement without current cabin verification | Edge | Rejected; valid availability evidence plus admin and sufficient threshold required. |
| TRIP-13 | Member history after account deactivation | RLS + DB | History/ledger FKs remain stable; deactivated auth cannot access current trip. |
| TRIP-14 | Admin cancels an open trip before cutoff after contributions may exist | DB/Edge integration | Under `coming_rsvp`, no contribution is due but any premature/extra receipt remains unresolved. Under `received_contribution`, existing obligations/receipts remain immutable and unresolved. No automatic refund, retention, or reallocation occurs; financial close stays blocked pending approved disposition. |

### Cabin reservation, contributions and cancellation

| ID | Requirement / scenario | Layer | Pass criteria |
| --- | --- | --- | --- |
| CAB-01 | Signup opens without assigned cabin recipient/payment method | DB/Edge | Rejected; user cannot receive unusable or missing contribution instructions. |
| CAB-02 | Confirmation email with cabin contribution instructions | Template + integration | Correct trip, $50, assigned recipient, selected channel and warning; no other members' payment IDs. |
| CAB-03 | Member marks $50 sent | Edge + DB | Append event only; does not claim confirmed receipt. Duplicate request is idempotent. |
| CAB-04 | Assigned payee confirms receipt | Edge + DB | Exact due amount/event recorded once with actor/time; unrelated recipient denied. |
| CAB-05 | Member withdraws after confirmed signup | State + finance | $50 obligation remains; contribution is non-refundable on that member withdrawal; no silent cost or payment event deletion. |
| CAB-06 | Attendee $50 advance applied in settlement | Engine + DB | Applied exactly once against cabin share and payer receivable; no duplicate expense or payment. |
| CAB-07 | Cabin payer is an attendee | DB + engine | One vendor payment fact plus non-posting booking coverage marker; no cash receipt, self-transfer or instruction is created. |
| CAB-08 | Confirmed attendee withdraws after payment | Engine | The $50 member withdrawal is non-refundable; original receipt remains immutable. No group credit/reallocation is assumed absent owner policy; unresolved amount blocks close. |
| CAB-08A | Eight $50 commitments, $250 invoice, payer is an attendee | Engine + DB | Eight commitments represented by one payer coverage marker + seven $50 receipt events (`$350` cash); one `$250` expense. Candidate balances include seven `$18.75` returns (`$131.25`); excess disposition is not finalized and close is blocked pending owner policy. |
| CAB-08B | Withdrawing member's non-refundable contribution exceeds documented cabin loss | Engine + DB | Original receipt remains immutable; excess disposition is unresolved and settlement closure is blocked pending owner policy. |
| CAB-09 | Club cancels before confirmation for insufficient participation | Integration | Under `coming_rsvp`, no contribution was due; any premature transfer is immutable/unapplied. Under `received_contribution`, pre-cutoff receipts remain immutable/unapplied. Neither branch automatically refunds, retains, or reallocates money; close is blocked until owner-approved disposition and audited external action. |
| CAB-10 | Club cancels after confirmation with contributions already collected | State + integration | Vendor payment/refund and each member receipt remain separate events; remaining receipts unapplied, no automatic refund/forfeit/transfer, financial closure blocked until policy and audited actions exist. |
| CAB-11 | Cabin cancellation request vs confirmation | DB/Edge/E2E | Trip state alone cannot mark reservation cancelled; provider evidence/time and refund result are recorded separately. |
| CAB-12 | Duplicate send/receipt/refund webhooks or user retries | DB | Unique idempotency key and event link prevent double entry; over-receipt/refund rejected. |
| CAB-13 | Pre-confirmation withdrawal after a received-basis contribution | DB/Edge + finance | RSVP leaves the active Coming count; the obligation and receipt remain append-only. Any receipt that no longer qualifies is unresolved/unapplied and is not refunded, retained, or credited without approved disposition. |

### Preferences, responsibilities, transport and lottery

| ID | Requirement / scenario | Layer | Pass criteria |
| --- | --- | --- | --- |
| LOG-01 | Meal preferences before/after cutoff | DB/Edge | Before cutoff allowed; after cutoff denied to member; admin override audited. |
| LOG-02 | Simultaneous claims for final responsibility slot | Concurrency integration | One claim wins; others become Needs assignment; RSVP remains committed. |
| LOG-03 | Withdrawal releases claimed but not admin-locked slot | DB/Edge | Slot capacity updates once and history remains auditable. |
| LOG-04 | Transportation policy | Unit + Edge | Three-person minimum counts driver; exceptions require admin reason; reimbursement uses integer cents and snapshot rate. |
| LOG-05 | Lottery eligibility and count | Unit + Edge | Requested count ≤ eligible count; server selects, records full eligible set and only admin can rerun with reason. |
| LOG-06 | Lottery exchange | State + Edge | Both participant acceptances required; unauthorized/noneligible members cannot swap. |
| LOG-07 | Lottery auditability vs replayability | Function + privacy | Roster/hash, result, actor/time, algorithm/source and rerun reason retained; committed seed can reproduce result during retention. Test explicitly does not claim this proves unbiasedness or prevents privileged discard/rerun. Idempotent retry returns original result; rerun is a new audited draw. |

### Expense workflow and allocation integrity

| ID | Requirement / scenario | Layer | Pass criteria |
| --- | --- | --- | --- |
| EXP-01 | Expense amount has invalid/float cents | Unit + DB | Rejected unless positive safe integer cents. |
| EXP-02 | Allocation cents fail to sum to expense | DB transaction | Approval and expense lock fail atomically. |
| EXP-03 | Payer is not in allocation subset | Engine + DB | Payer receives full merchant credit; only selected participants receive allocation debits; total remains zero. |
| EXP-04 | Alcohol subset and non-drinker | UI + DB | Only explicit opt-ins can be charged; all-attendee allocation needs audited admin approval. |
| EXP-05 | Expense deadline, review, lock, reopen | State + DB | Members cannot edit after lock; admin reopen requires reason and creates new immutable lock version. |
| EXP-06 | Receipt privacy and deletion | Storage + RLS | Payer/allocated members/admin allowed; outsider denied; object removed after retention deadline. |
| EXP-07 | Availability import duplicate/stale/malformed source | Unit + integration | Draft validation flags issues; no changes go live until admin approves; no trip auto-created. |

### Settlement engine and revisions

| ID | Requirement / scenario | Layer | Pass criteria |
| --- | --- | --- | --- |
| FIN-01 | Integer-cent and safe-range validation | Unit/property | Reject decimals, nonfinite values, overflow, unsupported currency. |
| FIN-02 | Debits and credits | Unit/property | Every approved expense allocation sums to total; aggregate net balances sum exactly zero. |
| FIN-03 | Exact optimum for n<=12 | Unit + independent oracle | Transfer count equals exhaustive maximum zero-sum partition oracle for generated vectors. |
| FIN-04 | Deterministic tie-break | Unit | Same UUIDs/input/engine version yield byte-identical output and hash. |
| FIN-05 | Fallback for n>12 | Unit | Stable largest-balance greedy settles every cent, uses at most n−1 transfers, declares non-optimal fallback. |
| FIN-06 | Exact operation ceiling | Unit | At n=12, direct anchor-containing candidate transitions equal 265,720; candidate + subset-sum additions ≤269,815 under spec count; fallback decision is based on n, not runtime. |
| FIN-07 | Mixed expense subsets across one trip | Unit | Four-person groceries, three-person fuel, full cabin allocation combine before minimizing. |
| FIN-08 | Cabin payer outside allocation | Unit | Payer receives expense credit, transfer has no self-payment, amounts settle. |
| FIN-09 | Cabin contribution advances/withdrawals | Unit + DB | Vendor expense/allocation, confirmed receipts, booking marker, refund and settlement transfer are separate sources; each is applied once. Withdrawal remains non-refundable; any unapplied balance blocks closure. |
| FIN-10 | Partial settlement payment | DB/engine | Sent/received events accumulate ≤ transfer amount; remaining cents exact. |
| FIN-11 | Correction after paid/partial transfers | DB/engine | Reproduce worked example: V1 `$20` of B's `$30` received, then `$30` fuel expense; V2 residual B→A `$10`, C→A `$15`. V1/events immutable, prior `$20` never charged again, unpaid transfer lineage superseded. |
| FIN-12 | Mismatched preview vs changed input | Integration | Finalize rejects stale hash/version and requires a new preview. |
| FIN-13 | Only admin finalizes/revises/closes | RLS + Edge | Member, recipient and unauthenticated attempts fail; every admin decision has reason/audit. |
| FIN-14 | Contribution/refund double count | Property + DB | Each event applies once; no refund exceeds received balance; final net and all transfer deltas sum to zero. |
| FIN-15 | Four-attendee `$240` cabin reconciliation | Independent oracle + DB | Balances after three `$50` receipts are A `+$30`, B/C/D `−$10`; three `$10` transfers; vendor expense remains `$240`; no self-payment or duplicated advance. |
| FIN-16 | Eight-attendee `$250` cabin reconciliation | Independent oracle + DB | Seven external receipts `$350`, one non-posting payer marker; candidate `$18.75` returns each to other seven, total `$131.25`; unresolved policy prevents finalization/closure. |
| FIN-17 | Club cancellation `$240` booking / `$200` provider refund / `$150` member receipts | Ledger + DB | Net provider loss `$40`, unapplied member receipts `$150`, arithmetic remainder `$110`; no member transfer is emitted absent approved cancellation policy. |
| FIN-18 | Immutable facts and mutable status projections | DB/property | Updates/deletes to ledger/payment/lifecycle events are denied; projection rebuild from events yields the same status and sums; `sent != received`, booking marker posts zero. |
| FIN-19 | Idempotency replay retention and concurrency | DB/Edge integration | Same key/hash inside window returns stored response; same key/different hash conflicts; concurrent duplicate yields one transition; known expired key rejects forever until aggregate deletion and never reexecutes. Rollback consumes no key. |

### Notifications, retention and recovery

| ID | Requirement / scenario | Layer | Pass criteria |
| --- | --- | --- | --- |
| OPS-01 | Provider accepts, delivers, bounces, or fails message | Integration | States are distinct; provider acceptance does not change RSVP/payment status. |
| OPS-02 | Transient retries and duplicate Cron | Integration | One user-visible business notice; attempt history retained; stale lease recovers. |
| OPS-03 | Permanent cancellation email failure | E2E/ops | Admin alert and manual contact path appear; cancellation transition remains durable. |
| OPS-04 | Cron outage and catch-up | Integration/ops exercise | Missed deadline processing catches up once, with no duplicate transitions/outbox. |
| OPS-05 | Supabase Free pause and resume | Recovery exercise | Operator resumes, sees heartbeat gap, runs catch-up and cabin calendar fallback. |
| OPS-06 | Nightly backup contents | Ops script | App DB dump encrypted, hash verified; Auth mapping and Storage objects handled separately. |
| OPS-07 | Restore drill | Ops exercise | RPO ≤24 hours, RTO ≤1 business day, stable member IDs and RLS restored, no stale receipt leak. |
| OPS-08 | Retention boundaries/time zones | DB/ops | 3-month sensitive detail/receipt and 12-month minimal ledger dates exact; unresolved dispute extends clock. |
| OPS-09 | Render rollback after schema expansion | CI/rehearsal | Previous code can run with additive schema; schema is restored/forward-fixed separately. |
| OPS-10 | Inactive member retention | DB | Account access removed, history/financial references remain and can still be reconciled. |
| OPS-11 | Deadline service objective and escalation | Operational exercise | Every-5-minute processing, ≤10-minute due-work SLO while reachable, independent 15-minute heartbeat, primary 5-minute ack, backup 10-minute ack, owner escalation at 30 minutes; named roles are configured and manual cabin fallback exercised. |
| OPS-12 | State persistence coverage | Catalog test | Every schema enum/status/projection has a row in STATE_PERSISTENCE_MATRIX with source facts, authorized operation, audit event and notification effect. |
| OPS-13 | Free-tier quota and read-only alert | Operational exercise | External daily sample alerts at the approved threshold; missing sample is detected; simulate read-only errors; verified database/Storage quotas and backup export destination are recorded. |

## 3. Phase exit evidence

Each implementation phase must publish:
- CI result and relevant test suite names/commit SHA.
- RLS matrix rows implemented and corresponding pgTAP result.
- Migration replay from empty local database.
- Edge Function contract/auth tests.
- Any failed/skipped tests and accepted residual risks.
- User-visible acceptance walkthrough for the relevant member/admin journeys.

## 4. Certification rules

- No phase is accepted because the UI appears to work; database, function and RLS tests are required.
- Critical financial, authorization, cancellation-deadline, retention and restore tests must pass before launch.
- Exact solver properties are tested against a separate exhaustive oracle; tests must not reuse the solver's recurrence as the only expected-value source.
- Use only synthetic test data; production member emails, identifiers, receipts and credentials are forbidden in test fixtures.
