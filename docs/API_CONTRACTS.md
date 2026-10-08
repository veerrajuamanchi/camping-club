# API Contracts — Supabase Trusted Operations

**Status:** Phase 1 and Phase 2 contracts are implemented and locally tested. Contracts for Phases 3–8 remain planned. No hosted service or production deployment was exercised.
**Sources:** [Approved design](superpowers/specs/2026-10-08-camping-club-platform-design.md), [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md), [STATE_MACHINES.md](STATE_MACHINES.md)

## 1. Contract conventions

- Client-visible reads use the Supabase Data API only where grants, RLS, and field exposure are explicitly approved. Sensitive joins and writes use Edge Functions.
- User-called functions require a valid Supabase user session, verify the caller with Supabase Auth, and use a caller-scoped database client for ordinary reads. An elevated server client is used only after explicit authorization and only for the narrow operation that needs it.
- System functions are not browser-callable. Cron/service-to-service requests use a named secret credential and constant-time verification/current documented Supabase auth pattern. Never put a service/secret key in Render frontend variables.
- Every mutating request includes an Idempotency-Key. Scope it by authenticated principal, operation and aggregate; store only a keyed hash, canonical request hash and result reference. Same key + same request hash returns the original result; same key + different hash returns 409. Financial/lifecycle records keep key tombstones through the aggregate's retention. Nonfinancial result details expire after 30 days; the tombstone remains until aggregate deletion, and a replay after result expiry returns `IDEMPOTENCY_REPLAY_EXPIRED` without executing again.
- The transport field is the `Idempotency-Key` request header; `request_id` is only a correlation identifier and is never an idempotency key. Canonicalize validated JSON before hashing; bind the key to principal + operation + aggregate. Concurrent first use has one winner via a unique constraint; losers await/read the committed result. A transaction rollback leaves no consumed key. After replay-window expiry, a known key returns `IDEMPOTENCY_REPLAY_EXPIRED`; it is not recycled or re-executed. Retention: response reference/details 30 days for nonfinancial work, tombstone through aggregate deletion; financial/lifecycle result/tombstone through trip financial retention (12 months after closure/resolution). Tombstone expiry is a cleanup eligibility date, not permission to replay an old operation.
- Where the catalog shorthand includes `idempotency_key`, it means the HTTP header above, never a JSON body field. Store the HMAC key version and retain lookup capability for existing tombstones through their retention window during secret rotation; do not delete/rotate away the only digest lookup path early.
- Timestamps are ISO 8601 UTC. Money fields are integer cents. UUIDs are canonical strings.
- Standard success envelope: {data, request_id}. Standard error envelope: {error:{code,message,field_errors?},request_id}. Never return secrets, stack traces, raw provider bodies, or unrelated member records.
- A successful HTTP response means the database operation completed. Email provider acceptance is a separate outbox state and does not mean delivered/read. External transfer instructions do not move money.
- For database mutations, use atomic SQL routines with explicit transaction boundaries where possible; a multi-request Edge Function sequence is not a transaction.

## 2. Authorization classes

| Class | Caller | Rule |
| --- | --- | --- |
| Member | Signed-in active member | User identity comes from verified JWT; membership status and resource relationship checked on each call. |
| Recipient | A member designated for a particular cabin contribution/transfer | May confirm receipt only for the exact assigned recipient role and amount. |
| Admin | Signed-in active administrator | Role checked against authoritative membership row for every call; never accept role from request body or user_metadata. |
| Scheduler | Supabase Cron/service-to-service | Named secret, least privilege, no browser CORS access; idempotent and catch-up-safe. |
| Public | Anonymous visitor | Only public constitution/introduction reads; no mutations. |

## 2.1 Implemented Phase 1 operations

`supabase/functions/member-api` is configured with platform JWT verification enabled. The handler also calls Supabase Auth `getUser` for the bearer token, requires a verified email, then reads the current `member_profiles` row from PostgreSQL. It never reads role claims from auth metadata or trusts a member ID/role supplied in the request body. `supabase/functions/bootstrap-admin` has platform JWT verification disabled only because the first administrator has no user JWT; it requires a constant-time checked `x-bootstrap-token`, checks that no active administrator exists, and the database permits one successful bootstrap activation.

User request JSON is `{ "action": "...", "input": { ... } }`. Mutating actions require a UUID `Idempotency-Key` HTTP header. An optional `x-request-id` is a correlation ID only. Success responses are `{ "data": { ... }, "request_id": "..." }`; errors are `{ "error": { "code": "...", "message": "..." }, "request_id": "..." }`. Errors are generic and do not include SQL/provider details. Responses set `Cache-Control: no-store`; CORS is restricted to configured origins.

| Action | Caller | Data and authority |
| --- | --- | --- |
| `me` | Verified signed-in active member | Returns own profile summary, phone and preferred method label. No payment identifier, email address or member directory. |
| `complete_profile` | Verified invited Auth user without a club profile | Requires a matching unexpired HMAC invitation event. Creates profile/contact/method and encrypted identifier in one DB transaction. Ordinary invite grants `member`; the one reserved bootstrap invite grants the first `admin`. |
| `update_profile` | Active member | Updates own display name, phone, preferred method and identifier through one trusted SQL transaction. Identifier is encrypted before it reaches PostgreSQL; only the safe method metadata is available through the Data API. |
| `invite_member` | Active admin | Invites a verified-email Auth identity, stores an HMAC of normalized email (not the raw address) and writes an audit event. The invitation email is delivered by Supabase Auth. |
| `list_members` | Active admin | Returns member ID, display name, role, status and creation time. Omits email, phone, and payment identifier. Read-only; no idempotency key. |
| `update_membership` | Active admin | Changes role/status through a trusted database operation; requires a reason, preserves history, prevents removal of the last active admin, and writes an audit event. |
| `bootstrap-admin` | One-time bootstrap secret holder | Invites the first admin only when no active admin exists and the database bootstrap reservation is unused. Successful profile activation consumes the reservation. Remove/rotate the bootstrap token after activation. |

The Data API grants active members only their own profile, contact and safe payment-method metadata. Members cannot update role/status or read another member's rows. `private.member_payment_identifiers`, invitation events, idempotency records and bootstrap state are not in the exposed Data API schema and have no anon/authenticated schema/table grants. No Phase 1 function decrypts or returns a stored identifier.

### Phase 1 idempotency and replay behavior

- Each mutation uses the authenticated principal + operation + UUID idempotency key as its scope. The raw key is never stored; PostgreSQL stores an HMAC and SHA-256 hash of canonical, schema-validated input, plus the result reference and HMAC key version.
- The first request creates a two-minute processing lease. A concurrent duplicate returns HTTP 409 `request_in_progress_retry_same_key`; retrying the same key after completion returns the stored safe result. Same key with changed validated input returns HTTP 409. No endpoint retries a changed body under an old key.
- The replay window is 30 days. A known key after the replay window returns HTTP 409 and is never executed again. The key tombstone is retained; Phase 1 uses HMAC version `v1`. Do not rotate that secret until multi-version lookup/retention handling is implemented and reviewed.
- Database profile and membership operations are transactional. Supabase Auth invitation email is an external side effect and cannot share the PostgreSQL transaction; a failed/ambiguous Auth delivery requires administrator recovery and must not be interpreted as profile activation.

Phase 1 local acceptance tests cover the invite/bootstrap path, Auth/JWT verification, direct Data API access, field exposure, admin denial, last-admin protection, audit writes, CORS, and replay/conflict/expiry semantics. See [TEST_STRATEGY.md](TEST_STRATEGY.md) and [PHASE1_CERTIFICATION.md](PHASE1_CERTIFICATION.md).

## 2.2 Implemented Phase 2 `trip-api` operations

`supabase/functions/trip-api` has platform JWT verification enabled, independently resolves the bearer token with Auth `getUser`, requires confirmed email and an active `member_profiles` row, and reads the role from PostgreSQL. Admin role validation occurs before detailed request validation for admin-only actions. Browser mutations require a UUID `Idempotency-Key`; the frontend generates it per mutation. Edge code derives actor/member identity from the verified session and invokes narrow SQL functions using the server-only service role. No caller may set `minimum_basis` or invoke a trip-confirmation/cancellation/payment operation.

| Action | Caller | Request / result boundary |
| --- | --- | --- |
| `get_calendar` | Active member | Before returning open-poll data, invokes service-role-only `phase2_refresh_open_rule_bundles` for the requested open trips. Returns the effective poll calendar, active campsite display fields, Coming count, and caller's own response and exact accepted rule bundle. Admin response additionally includes attendee response names, active member choices, private campsite notes, and pending withdrawal requests. Member views do not expose other member identities or Not Coming roster details. |
| `get_constitution` | Active member; admin reads admin-only drafts/details | For a trip in an open poll, refreshes the effective rule bundle before returning it; then returns effective general + trip bundle, immutable versions, and current override editor data only for applicable scope. |
| `admin_configure_club` | Active admin | Updates timezone, poll lead days/time, planning minimum and next rotation pointer with expected configuration version. Requires explicit timezone before opening polls; planning minimum is not evaluated. |
| `admin_generate_calendar` | Active admin | Ensures unique month rows through the requested month; repeated request is idempotent. Monthly Cron uses the same generator. |
| `admin_reorder_campsites` | Active admin | Reorders active-site round robin and next pointer; optimistic request key and reason are recorded. |
| `admin_update_campsite` | Active admin | Edits public campsite fields and restricted admin notes; expected version prevents stale updates. |
| `admin_configure_trip` | Active admin | Overrides campsite, dates, poll deadline/timezone snapshot, capacity, display information and planning minimum; expected version and reason required. An existing timezone snapshot remains stable across later edits and club-default changes; the current default is captured only when the trip has no snapshot yet. |
| `admin_set_poll_status` | Active admin | Opens/closes or reopens an interest poll subject to poll configuration/version. Poll close never confirms/cancels a trip or creates obligations. Cron closes only due open polls. |
| `admin_publish_rule` | Active admin | Adds immutable general or trip-specific rule version; trip-specific rules require expiry. General publication creates a new effective bundle without changing prior acknowledgments. |
| `admin_set_rule_override` | Active admin | Adds expiring override tied to the exact current general rule version for one trip; old override is retired, never overwritten. |
| `submit_rsvp` | Active member | Records Coming/Not Coming. For a new or changed-to-Coming response, the transaction refreshes the bundle using current rule effective/expiry times, then requires the submitted current bundle ID/hash and acknowledgment statement version. If the bundle changed after the member read it, the stale acknowledgment is rejected and the member must refresh. Existing Coming responses keep their exact previously accepted version without re-acknowledgment. |
| `admin_record_interest` | Active admin | Records an administered late interest response for a selected active member; before a new/changed-to-Coming response, refreshes the current time-effective bundle and requires that member's acknowledgment of that exact bundle. This is interest only, not a confirmed attendee/payment entry. |
| `request_withdrawal` | Active Coming member | While the poll is open and before cutoff, changes interest to Not Coming. Once closed/due, appends a pending request and leaves the Coming projection unchanged; no approval/rejection or effective post-confirmation withdrawal exists in Phase 2. |

Open-poll bundle refresh is lock-serialized and content-hash idempotent: if the currently effective rendered rules have not changed, it returns the current immutable bundle without creating another version. Effective-time and expiry boundaries produce a new current bundle on the next authenticated read or new Coming operation. The current pointer changes; prior bundles and acknowledgments remain immutable.

Phase 2 responses are `Cache-Control: no-store`; the trusted handler returns generic errors. Idempotency uses the Phase 1 shared HMAC-v1 record with principal + action + aggregate scope, canonical validated request digest, one winner under concurrent first use, replay of completed result inside the existing 30-day nonfinancial window, hash-mismatch conflict, and non-reexecution of a known expired key. Phase 1's unresolved HMAC key-rotation risk remains open. Calendar generation and poll closing are idempotent database operations, not dependent on site traffic. Phase 2 does not enqueue or send email; member notices are visible in the application and transactional-email delivery remains a later phase.

## 3. Mutating functions and restricted reads

### 3.1 Membership and payment preference

| Function | Caller | Request | Response and effects |
| --- | --- | --- | --- |
| admin-invite-member | Admin | email, display_name, request_id | invite_event_id, status; sends invitation via outbox; duplicate key returns original event. |
| member-complete-profile | New invited member | display_name, phone, payment_method, payment_identifier, format_attestation, idempotency_key | profile summary and masked method; identifier encrypted before private-schema storage; validates format but does not claim external-account ownership verification. |
| member-update-profile | Active member | allowed display fields and expected_version | updated profile version; cannot update role/status or another member. |
| member-update-payment-method | Owner | method, identifier, preferred, accepted_for_receiving, expected_version, idempotency_key | safe method summary only; identifier encrypted into private storage and never returned by Data API or this mutation response. |
| member-read-own-payment-identifier | Owner | payment_method_id | Decrypts/returns only the caller's own identifier; every disclosure is audited, rate-limited, and omitted from logs. |
| get-payment-instructions | Exact transfer payer or assigned cabin contributor; admin exception audited | transfer_id or contribution_id, selected_method | Returns the minimum necessary recipient identifier only if caller is a current obligated payer for that exact trip/transfer. Recipient self-read is allowed. Uses no direct Data API read, emits identifier-disclosure audit event, rate limits, `Cache-Control: no-store`, and never logs/cache-stores the plaintext. Unrelated active members and admins without a documented support action receive 404/403. |
| admin-set-member-status | Admin | member_id, new_status, reason, request_id | status and audit event; deactivation revokes app access but preserves history. |
| admin-set-member-role | Admin | member_id, member/admin, reason, request_id | role change and audit event; no client direct write. |

### 3.2 Trip, rules, RSVP, and acknowledgment

| Function | Caller | Request | Response and effects |
| --- | --- | --- | --- |
| admin-create-trip | Admin | campsite_id, dates/timezone, registration config, minimum, explicit minimum_basis plus owner-approved minimum_basis_policy_ref, explicit cabin_payer_coverage_counts_toward_minimum and policy_ref when using received_contribution, reservation/deadline data, cabin recipient/payment method | trip_id, initial state; rejects opening registration while required policy choice/reference is unset. Basis cannot change after registration opens. |
| admin-update-trip | Admin | trip_id, patch limited to editable pre-transition fields, expected_version, reason | updated version and audit event; lifecycle transitions use dedicated operations. |
| admin-set-trip-rules | Admin | trip_id, rule_definition_id, structured_values, text, expiry, reason, request_id | new immutable rule_version and new effective bundle/hash. Existing signup acknowledgments remain linked to old bundle; send informational update. |
| member-submit-trip-signup | Active member | trip_id, response=coming/not_coming, acknowledged_bundle_id/hash/statement_version when Coming, signup preferences, responsibility choices, idempotency_key | rsvp_id, acknowledged version, assignment status per time block and contribution obligation if required by selected basis. Atomic transaction verifies bundle hash, inserts acknowledgment+RSVP, claims slots, and (for received_contribution basis) creates the $50 obligation/request. Full slot never rolls back RSVP. |
| member-withdraw-rsvp | RSVP owner | trip_id, reason optional, expected_version, idempotency_key | Before confirmation, records withdrawal under approved trip rules. After confirmation, persists a withdrawal request; transition to effective withdrawal follows owner-selected policy (administrator approval vs immediate). $50 obligation/event history is preserved. |
| admin-add-late-attendee | Admin | trip_id, member_id, reason, idempotency_key | RSVP/attendance inclusion; confirmed trip creates $50 obligation and request. Cancelled trip requires reinstatement first. |
| admin-reinstate-trip | Admin | trip_id, cabin_availability_verified, evidence_note, reason, request_id | new lifecycle event and appropriate confirmation/payment request; rejects if evidence false/missing. |
| admin-record-attendance | Admin | trip_id, attendee list, reason, request_id | final actual roster; validated against RSVP/late entries with explicit exception audit. |
| admin-run-schedule-generator | Admin/scheduler | from_month, through_month, request_id | inserted/updated month keys; unique key and rotation lock prevent duplicates. |

### 3.3 Cabin reservation, contributions, and cancellation

| Function | Caller | Request | Response and effects |
| --- | --- | --- | --- |
| admin-assign-cabin-recipient | Admin | trip_id, recipient_member_id, payment_method_id, reason, request_id | versioned assignment; allowed before signup or controlled correction; effective recipient snapshot for emails. |
| admin-record-cabin-booking | Admin | trip_id, reservation_reference, paid_by_member_id, amount_cents, contractual_refund_deadline, evidence_note | Append booking fact/event; no provider credentials stored. If the payer is an attendee with a $50 commitment, append a non-posting booking-coverage marker and send no self-payment instruction. |
| member-mark-contribution-sent | Contributor | contribution_id, amount_cents=5000, selected_method, external_reference_redacted?, request_id | append-only sent event; does not mark received. |
| recipient-confirm-contribution-received | Assigned cabin recipient or Admin | contribution_id, amount_cents, received_at, optional_redacted_reference, request_id | append-only received event; amount must reconcile to due balance. |
| admin-record-contribution-dispute | Admin | contribution_id, reason, request_id | disputed state; blocks automatic close until resolved. |
| admin-resolve-cancelled-trip-contribution | Admin | contribution_id, approved_outcome(refund/credit/retain_against_documented_cost), amount_cents, evidence_note, owner_policy_reference, request_id | records explicit resolution. Function is disabled until owner approves cancellation policy; cannot auto-refund or auto-forfeit. |
| admin-resolve-contribution-excess | Admin | contribution_id(s), approved_outcome(refund/club_credit/other_approved), amount_cents, evidence_note, owner_policy_reference, request_id | records resolution of amounts above approved cabin cost/share. Function is disabled until owner approves excess policy; no implicit reallocation. |
| member-confirm-contribution-refund | Contributor | contribution_id, amount_cents, received_at, request_id | confirms external refund receipt; immutable event. |
| admin-record-cabin-cancellation-request | Admin/system | trip_id, requested_at, provider_contact_note, reason, request_id | trip remains distinct from reservation cancellation; sends/admin alert. |
| admin-confirm-cabin-cancellation | Admin | trip_id, confirmed_at, refund_or_credit_cents, evidence_note, request_id | marks reservation cancellation confirmed and updates unresolved contribution resolution queue. |

### 3.4 Trip preparation and logistics

| Function | Caller | Request | Response and effects |
| --- | --- | --- | --- |
| member-update-trip-preferences | Attendee | trip_id, packing/meal/coffee choices, expected_version, request_id | persisted preferences; rejects frozen meals after cutoff unless admin. |
| admin-freeze-meal-preferences | Admin/scheduler | trip_id, request_id | freezes current preference version and records actor/time. |
| member-claim-responsibility | Attendee | trip_id, time_block, responsibility_definition_id, request_id | claim or Needs assignment result; concurrent capacity is serialized. |
| admin-add-responsibility-capacity | Admin | trip_id, time_block, definition_id, capacity_delta, reason, request_id | capacity change; assignments remain auditable. |
| admin-assign-responsibility | Admin | trip_id, member_id, time_block, definition_id, reason, request_id | audited override/assignment. |
| admin-configure-transport | Admin | trip_id, vehicles/riders/mileage/rate/exception reasons, request_id | records configuration; validates capacity, unique rider, carpool threshold and approved exceptions. |
| admin-run-floor-lottery | Admin | trip_id, requested_count, reason for rerun | server derives eligibility from locked trip/bed data, uses the approved CSPRNG procedure, and stores roster snapshot/hash, algorithm, seed commitment, result and actor. Caller cannot supply eligibility or winners. |
| member-request-bed-exchange | Selected member | draw_id, replacement_member_id, request_id | pending exchange. |
| member-respond-bed-exchange | Other selected/eligible member | exchange_id, accept boolean, request_id | accepted/rejected event; both identities must be eligible. |

### 3.5 Expenses and settlement

| Function | Caller | Request | Response and effects |
| --- | --- | --- | --- |
| member-submit-expense | Attendee | trip_id, category_id, amount_cents, description, incurred_at, allocation proposals, receipt upload token, request_id | submitted expense; validates cents and participant membership; no approval yet. |
| member-update-expense-proposal | Submitter/allocated member | expense_id, allowed proposal fields, expected_version, request_id | updated proposal before lock. |
| admin-review-expense | Admin | expense_id, approve/reject/dispute, corrected allocations, reason, expected_version, request_id | reviewed state and audit event; allocation sum must equal expense. |
| admin-lock-expenses | Admin | trip_id, submission_deadline, request_id | immutable expense lock and content hash; unresolved disputes block lock unless explicitly resolved. |
| admin-reopen-expenses | Admin | trip_id, lock_id, reason, request_id | new lock version later; prior lock remains immutable. |
| admin-preview-settlement | Admin | trip_id, expense_lock_id, solver_version, request_id | input hash, policy snapshot, balances, transfer preview, exact/fallback indicator; no persistent finalized transfers. |
| admin-finalize-settlement | Admin | trip_id, preview_hash, idempotency_key, request_id | transactionally creates immutable version, balances, transfers and outbox notifications; stale preview/hash rejects. |
| member-mark-transfer-sent | Transfer payer | transfer_id, amount_cents, method, external_reference_redacted?, request_id | append-only payment event; partial payment allowed only as event amount not exceeding remaining obligation. |
| recipient-confirm-transfer-received | Transfer recipient or Admin | transfer_id, amount_cents, received_at, request_id | receipt event; cumulative confirmed amount cannot exceed transfer amount. |
| admin-resolve-transfer-dispute | Admin | transfer_id, resolution, amount_cents, reason, request_id | explicit resolution and audit. |
| admin-create-settlement-adjustment | Admin | prior_run_id, new_locked_expense_hash, reason, request_id | new version linked to prior; preserves old events and credits completed/partial payments. |
| admin-close-settlement | Admin | run_id, unresolved_resolution_ids, reason, request_id | closes only if all transfers received or explicitly resolved. |

### 3.6 System operations

| Function | Caller | Request | Response and effects |
| --- | --- | --- | --- |
| process-trip-deadlines | Scheduler secret | scheduled_for, batch_limit | Scans due trips. Counts active Coming for approved `coming_rsvp`; under `received_contribution`, counts active Coming with full recipient-confirmed $50 receipt by cutoff. Whether an attending cabin payer's non-posting booking-coverage marker also qualifies is a separate required owner choice. `marked_sent` never counts. Any missing policy fails closed, creates an ops alert, and performs no transition. Writes decision, audit and outbox atomically. |
| process-notification-outbox | Scheduler secret | scheduled_for, batch_limit, request_id | claims due rows with skip-locked semantics, sends via provider, appends attempt and next retry/status. |
| replenish-trip-calendar | Scheduler/Admin | from_month, through_month, request_id | inserts missing months by unique month key and rotation transaction. |
| process-retention | Scheduler secret | as_of, dry_run, request_id | reports and deletes only eligible rows/objects; logs counts and errors; dry-run required before first production run. |
| record-job-heartbeat | Scheduler/monitor secret | job_key, run_id, result | persisted status for independent monitor; cannot modify trip or finance records. |
| import-availability-draft | Admin | source, source_timestamp, source_url, records, source_hash, request_id | validation report/draft only. |
| approve-availability-import | Admin | import_id, corrections, reason, request_id | reviewed snapshots published; no automatic trip creation. |

## 4. Database operations versus Edge Functions

- Use a database transaction/RPC when correctness requires row locks, uniqueness, cross-row sum validation, or atomic state + audit + outbox write.
- For idempotent operations, reserve/insert the scoped key in the same transaction as the business transition, events, projections, audit, and outbox. Unique-key contention serializes duplicate requests. Do not hold a transaction open during provider/network calls.
- Keep internal helper RPCs in non-exposed private schema; only grant EXECUTE to intended role/service identity.
- Use Edge Functions for authenticated user orchestration, provider email calls, restricted payment identifier resolution, and job dispatch.
- If a function uses a privileged client that bypasses RLS, it must independently authenticate and authorize the caller before each privileged operation. Prefer caller-scoped clients for ordinary reads.
- Never expose raw internal tables or unrestricted RPCs merely to simplify frontend access.

## 5. Error codes

| HTTP | Code | Meaning |
| --- | --- | --- |
| 400 | VALIDATION_ERROR | Invalid schema, unsupported method or malformed amount. |
| 401 | AUTH_REQUIRED | Missing/invalid session or scheduler credential. |
| 403 | FORBIDDEN | Valid identity lacks membership/resource/admin role. |
| 404 | NOT_FOUND | Resource absent or intentionally hidden from this caller. |
| 409 | IDEMPOTENCY_CONFLICT | Same key reused with different request body. |
| 409 | IDEMPOTENCY_REPLAY_EXPIRED | Same key was used before, but its replay result expired; operation is never re-executed with an expired key. |
| 409 | STATE_CONFLICT | Resource version/state changed or transition is not legal. |
| 409 | CAPACITY_FULL | Claim failed; for signup, RSVP remains with Needs assignment. |
| 422 | FINANCIAL_INVARIANT_FAILED | Allocation, balance, advance, transfer or version check failed. |
| 429 | RATE_LIMITED | Safe retry after Retry-After. |
| 500 | INTERNAL_ERROR | Redacted operational failure; correlation request_id provided. |
| 503 | PROVIDER_UNAVAILABLE | Email/payment-instruction dependency unavailable; state remains retryable. |

## 6. Contract tests

For every operation, test signed-out, active member owner, active non-owner, inactive member, admin and system caller as applicable. Test malformed UUID/cents, same-key/same-payload replay, same-key/different-payload conflict, replay after expiry (reject, never execute), stale expected_version, concurrent duplicate request, state transition conflict, sensitive-field redaction and outbox behavior. Contribution receipt and settlement events lock their aggregate rows and validate cumulative amounts in the same transaction. Contract response schemas are versioned; additive optional fields are backward compatible, field meaning/status changes require API contract versioning.
