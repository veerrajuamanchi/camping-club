# Security Architecture — Private Camping Club Platform

**Status:** Normative security baseline for implementation planning.
**Related:** [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md), [API_CONTRACTS.md](API_CONTRACTS.md), [TEST_STRATEGY.md](TEST_STRATEGY.md)

## 1. Security objectives

- Only invited, verified, active members access club data.
- Row-level authorization remains effective through the Data API and third-party SQL clients.
- Privileged lifecycle and financial transitions require current server-side authorization.
- Payment identifiers, phone numbers, receipt files, invitation data, and financial records are disclosed only to parties that need them.
- Finalized finance, rule acknowledgments, lifecycle events, and audit history are append-only.
- No money movement, bank credentials, public trip roster, or app photo/video store is introduced.

## 2. Trust boundaries

| Boundary | Trusted input | Untrusted input |
| --- | --- | --- |
| Render browser → Supabase Data API | Valid session JWT and publishable key identify caller | User ID, role, trip status, cents, acknowledgment hash, RLS assumptions |
| Browser → user Edge Function | Verified Supabase user JWT | Requested IDs, amounts, roles, authority, status transition |
| Scheduler → system Edge Function | Named service secret and scheduled job identity | Payload timestamps, trip IDs, retry counts; re-read authoritative DB rows |
| Edge Function → provider | Server-held provider credential | Provider response/body and status beyond documented meaning |
| Local Python → import endpoint | Admin's authenticated session and validated source metadata | Scraped availability and parsed fields |
| Database → Render deployment | Versioned migrations and environment config | Render filesystem as durable state |

## 3. Authentication and authorization

- Require Supabase Auth invitation and verified email. Check active membership from member_profiles on every privileged operation.
- Read role from the authoritative database. Never trust raw_user_meta_data, a client-supplied role, or stale authorization claims for admin decisions.
- A valid signed-in JWT is authentication, not authorization. Each function checks ownership, trip membership, assigned recipient status, or administrator role.
- User-callable Edge Functions keep platform JWT verification enabled and use a caller-scoped database client for ordinary reads. An elevated client is used only after explicit authorization for a narrow operation.
- Scheduled functions authenticate with a named secret/service credential using current documented Supabase service-to-service authentication. If platform JWT verification must be disabled for a scheduler endpoint, the handler must require and verify the named secret itself; never accept anonymous calls.
- Role changes, trip confirmations/cancellations, policy changes, cabin recipient changes, expense approval/lock, settlement finalization/revision, refunds, cleanup, and notification retries are server-authorized and audited.
- Account deactivation revokes future access; historical obligations and records remain linked to immutable member IDs.
- Document administrator recovery and recheck token/session revocation behavior before implementation.

## 4. Table-level access matrix

Legend: No = no grant/read; Own = rows owned by the authenticated member; Trip = fields authorized for that trip; Party = payer/recipient/submitter/allocation participant; Admin-R = admin read subject to RLS; Function = mutation only through a trusted operation; System = background function only. Each entity in DATABASE_SCHEMA.md has an individual row below.

| Table/entity | anon | Active member | Admin | System |
| --- | --- | --- | --- | --- |
| member_profiles | No | Own profile; safe display name for authorized roster only | Admin-R; role/status change via Function | Auth bootstrap only |
| member_private_contacts | No | Own | Admin-R through Function | No |
| member_payment_methods | No | Own | Admin-R through Function | Resolve only necessary recipient identifier for authorized instruction |
| private.member_payment_identifiers | No schema/table grant or Data API exposure | No direct read | No direct table read or general reveal | Only the exact authorized payment-instruction Function may decrypt for its specific current obligation; audited, rate-limited, and never logged |
| private.idempotency_records | No | No | No direct table read | Trusted operation only |
| member_payment_capabilities | No | Own if feature approved | Admin-R | Settlement reads only if compatibility is approved |
| private.admin_invitation_events | No schema/table grant or Data API exposure | No direct read | Invitation management through authorized Function with masked address | Invitation worker |
| campsites | Published fields only | Published fields | Admin-R; edits via Function | Availability import |
| rotation_configuration | No | Read current rotation only | Admin-R; changes via Function | Calendar generator |
| availability_imports | No | No | Admin-R | Import processor |
| campsite_availability_snapshots | Published only | Published/active-trip use | Admin-R | Import publisher |
| camping_trips | No private/draft data | Authorized trip fields | Admin-R; lifecycle changes via Function | Deadline processor |
| trip_lifecycle_events | No | Safe status for trips member may see | Admin-R | Append-only job event |
| trip_attendance | No | Authorized trip roster/history only | Admin-R; edits via Function | Retention |
| trip_history_summaries | No | Approved trip history | Admin-R | Retention writer |
| trip_history_attendees | No | Own attendance and authorized trip roster names | Admin-R | Retention writer |
| rule_definitions | Published fields only | Rules applicable to trips member may view | Admin-R; edits via Function | No |
| rule_versions | Published fields only | Immutable versions applicable to trips member may view | Admin-R; new versions via Function | No |
| trip_rule_overrides | No | Effective rule text for trip members | Admin-R; edits via Function | Snapshot writer |
| trip_rule_bundles | No direct Data API grant; current bundle via authorized `trip-api` read | No direct read | No direct read; current bundle via authorized `trip-api` read | Snapshot writer |
| trip_rule_bundle_entries | No direct Data API grant; entries used by authorized `trip-api` read | No direct read | No direct read; entries used by authorized `trip-api` read | Snapshot writer |
| trip_rule_acknowledgments | No | Own rows only | Admin-R; no direct update/delete | No |
| trip_policy_snapshots | No | Applicable effective policy text | Admin-R | Snapshot writer |
| trip_rsvps | No | Own response; authorized roster names only | Admin-R; late entry via Function | Deadline processor |
| trip_packing_items | No | Read applicable trip items | Admin-R | Retention |
| trip_packing_responses | No | Own rows | Admin-R | Retention |
| trip_meal_slots | No | Read configured trip slots | Admin-R | Freeze job |
| trip_meal_preferences | No | Own row; authorized trip summaries | Admin-R | Retention |
| trip_coffee_preferences | No | Own rows; aggregate trip plan | Admin-R | Retention |
| trip_responsibility_definitions | No | Read trip definitions | Admin-R | No |
| trip_responsibility_slots | No | Read capacity and own assignment | Admin-R | No |
| responsibility_assignments | No | Own rows; limited coordination view | Admin-R; override via Function | Expiry worker |
| trip_vehicles | No | Trip transport detail for attendees | Admin-R; configure via Function | No |
| trip_vehicle_riders | No | Trip transport detail for attendees | Admin-R; assignment via Function | No |
| floor_lottery_draws | No | Current result for eligible trip members | Admin-R; draw via Function | Random draw routine |
| floor_lottery_exchanges | No | Own exchange; safe status for counterpart | Admin-R; decision via Function | No |
| trip_whatsapp_links | No | Confirmed attendee/admin only | Admin-R | Delete at completion |
| cabin_reservations | No | Safe reservation status/deadline | Admin-R; state changes via Function | Deadline alert only |
| cabin_reservation_events | No | Safe club-visible events only | Admin-R | Append-only trusted operation |
| cabin_payment_assignments | No | Safe payee summary; identifier via instruction endpoint | Admin-R | Email instruction builder |
| cabin_contributions | No | Own row; assigned recipient sees exact obligation | Admin-R | Confirmation email creates obligations |
| cabin_contribution_events | No | Own events; recipient sees receipt for assigned contribution | Admin-R | Append event only |
| cabin_contribution_state_projections | No | Own safe payment status only | Admin-R | Rebuild from immutable events |
| cabin_contribution_resolutions | No | Own resolution summary | Admin-R; approve via Function | No automatic disposition |
| expense_categories | Public-safe names only | Read active categories | Admin-R | No |
| trip_expenses | No | Own submission, Party expenses and safe trip summary | Admin-R; review via Function | Lock operation |
| expense_allocations | No | Own/relevant allocation only | Admin-R | Finalizer reads locked set |
| expense_receipts | No | Party via authorized signed URL | Admin-R | Retention worker |
| trip_expense_locks | No | Safe locked summary only | Admin-R | Lock operation writes |
| settlement_runs | No | Safe summary only when a Party | Admin-R | Finalizer/revision writes |
| settlement_balances | No | Own row only | Admin-R | Finalizer writes |
| settlement_ledger_entries | No | Own net-safe financial lines only when a Party | Admin-R | Append-only finalizer/revision operation |
| settlement_run_events | No | Safe run state for Parties | Admin-R | Append-only trusted operation |
| settlement_transfers | No | Party only | Admin-R | Finalizer writes |
| settlement_payment_events | No | Party only | Admin-R; append via Function | Append event |
| settlement_transfer_state_projections | No | Party-safe status only | Admin-R | Rebuild from events |
| settlement_cabin_contribution_applications | No | Own contribution application summary only | Admin-R; resolution via Function | Finalizer/retention worker |
| settlement_adjustment_links | No | Party-safe lineage only | Admin-R | Revision operation |
| financial_retention_markers | No | No | Sanitized admin view | Cleanup worker |
| notification_receipts | No | Own safe status | Admin-R; retry via Function | Worker writes |
| private.audit_events | No schema/table grant or Data API exposure | No direct read | Sanitized authorized admin operation only; no direct table grant | Append-only trusted operation |
| private.notification_outbox | No | No | No direct table access; sanitized delivery summary only | Notification worker only |
| private.notification_attempts | No | No | No direct table access; sanitized delivery summary only | Notification worker only |
| private.scheduled_job_runs | No | No | Sanitized status view only | Scheduler only |
| private.operations_alerts | No | No | Sanitized view; acknowledge via Function | Monitor/job only |
| application_settings | No | Explicit public settings only | Read/write through trusted Function; no direct admin table grant | Read necessary values |
Every concrete table in DATABASE_SCHEMA.md must be mapped to this matrix before migration approval. A broader authenticated read policy is not an acceptable substitute.

## 5. Grants, RLS and functions

- Enable RLS on every table in an exposed schema. Set explicit table and sequence grants. Revoke unnecessary privileges from anon, authenticated, and PUBLIC; policies do not revoke grants.
- Treat schema exposure, table grants and RLS as separate controls. Explicitly expose only needed tables/functions; do not depend on changing Data API defaults.
- UPDATE policies constrain both old and new row ownership using USING and WITH CHECK.
- Use auth.uid() predicates and index policy columns where appropriate; verify query plans for high-use RLS paths.
- Views use security-invoker semantics where supported or reside in a non-exposed schema with no client grants.
- Avoid SECURITY DEFINER. If a private helper is necessary to avoid policy recursion, verify auth.uid() internally, fully qualify objects, set a fixed search_path, avoid dynamic SQL, revoke PUBLIC execute and test both allow and deny paths.
- Every RPC has explicit EXECUTE grants; no default public execute on sensitive functions.
- Financial/lifecycle tables deny direct client insert/update/delete. Admin transitions check current role and write audit/outbox records transactionally.
- Every private table has no Data API exposure and no anon/authenticated grants.

## 6. Payment identifier and financial privacy

- Store payment method metadata in `public.member_payment_methods` without an identifier. Store identifier ciphertext, nonce, key version and keyed fingerprint only in `private.member_payment_identifiers`; use authenticated encryption (AES-256-GCM or a currently supported AEAD), key versioning and separate encryption/fingerprint secrets in Supabase Edge Function secrets. Never store plaintext at rest or in logs. Restrict decrypt capability to the narrow instruction function; rotation decrypt/re-encrypt is an auditable maintenance operation.
- The private schema is not Data API exposed and has no `anon`/`authenticated` grants. RLS is defense in depth, not the primary field boundary. Public table row policies cannot protect sensitive fields by themselves; grants and column privileges must be checked separately. No view or join may project ciphertext or fingerprint.
- Direct Data API queries expose only safe payment-method metadata on the member's own methods; identifiers do not exist in public tables. No Data API query or general self/admin read returns an identifier. Only the exact authorized payment-instruction operation may decrypt and return the recipient identifier for that specific current obligation/transfer, with an audit event and rate limit.
- Identifier responses use no-store/no-cache, avoid analytics/service-worker persistence, redact errors, and do not return broader profile or method records.
- Never put payment identifiers in trip rosters, broad notifications, audit before/after JSON, analytics, URLs, logs, or error messages.
- Build payment instructions one transfer/contribution at a time. Resolve the recipient's accepted method/identifier only after verifying the caller has that exact current payment obligation; do not allow general recipient self-read or unrelated member/admin directory lookup.
- Return only the needed recipient method and identifier. Never expose a member directory of handles.
- Settlement ledger retains method label, amount and party IDs but not identifier or fingerprint. Resolve from encrypted private storage on demand; any short-lived instruction snapshot is isolated, restricted, deleted within three months, and excluded from provider logs.
- Signed receipt URLs are short-lived and issued after party authorization. Receipt bucket is private; object names use random IDs.
- External transaction references are optional/redacted; no screenshot or full bank statement is required by default.
- Member-withdrawal contribution and club-cancellation refund are separate event types; do not silently translate one into the other.

## 7. Edge Function security requirements

- User functions require a valid Auth JWT; check active membership and resource relationship. Never trust request JSON for member_id, role, status, payment-event owner or policy snapshot.
- System functions require a named, rotated secret and strict method, content-type, body-size and caller controls.
- Restrict CORS to production Render domain and controlled development origins. CORS is not authentication.
- Apply schema validation, cents safe-integer checks, request-size limits, provider timeouts, generic errors and request correlation.
- Use idempotency keys. Rate-limit invitation, signup, expense/receipt upload and payment event operations at a low-cost trusted layer if abuse is observed; no new paid service without approval.
- Do not create a generic admin SQL endpoint or arbitrary-table RPC.
- Audit actor, resource, action, reason and before/after hashes without copying secrets or full identifiers.

## 8. Security acceptance and certification

Before each phase exit:
- Test SELECT/INSERT/UPDATE/DELETE allow/deny for each table, role and ownership edge.
- Test visitor, active owner, active non-owner, inactive member, admin, recipient and scheduler identities.
- Test RLS and grants separately; direct Data API requests cannot bypass Edge Function policy.
- Test views, storage buckets, signed URLs, RPC EXECUTE grants and function authentication.
- Test role revocation and deactivation behavior with existing sessions.
- Scan build artifacts/config for service-role and secret keys.
- Verify payment identifiers appear only in authorized single-transfer instructions and are deleted on retention date.
- Run Supabase security/database advisors and resolve critical findings before launch.
- Classify every security gate PASS / PASS WITH RISK / BLOCKED. Unauthorized data access is BLOCKED.
