# Database Schema — Private Camping Club Platform

**Status:** Phase 1 identity and Phase 2 calendar/poll/Constitution schemas are implemented in migrations `20261008165655_phase1_member_identity.sql` and `20261008185225_phase2_calendar_polls_rules.sql`. Entities described after the as-built section remain future-phase planning baseline. Owner-gated policies remain unresolved.
**Source:** [Approved design](superpowers/specs/2026-10-08-camping-club-platform-design.md)

## 1. Database design rules

- Supabase PostgreSQL is the durable source of truth. Use UUID primary keys, UTC timestamptz event times, and the configured club timezone for local deadlines.
- Use integer cents in bigint columns for every stored monetary amount. Never use floating-point or locale-formatted numbers in the database.
- Use explicit enums or constrained text for lifecycle values. Avoid free-form status strings.
- Use immutable version rows for rule bundles, acknowledgment records, expense locks, settlement runs, payment events, and audit events.
- Keep current rule definitions separate from immutable effective snapshots. Keep each participant acknowledgment tied to the exact bundle shown at signup.
- Keep payment identifiers outside long-retention settlement rows. Do not store bank credentials or initiate transfers.
- Use restrictive FK delete behavior for member, trip, and financial references. Deactivate accounts; do not cascade-delete audit or financial history.
- Every foreign key gets a supporting index unless an existing primary/composite index begins with that FK; policy predicates should also be indexed. See [Supabase index guidance](https://supabase.com/docs/guides/database/postgres/indexes) and [RLS guidance](https://supabase.com/docs/guides/database/postgres/row-level-security).
- All client-exposed tables have explicit grants and RLS. A new table must not rely on current or future Data API default exposure.
- Use a private, non-exposed schema for outbox payloads, job internals, and maintenance state. Expose only intentionally client-readable data.
- Use schema migrations as the only production schema change path.

## 2. Namespaces and database roles

- Supabase-owned auth tables remain in auth; reference auth.users(id) for member identity.
- public contains intentionally client-readable rows guarded by least-privilege grants and RLS.
- private contains outbox, job, and internal helper objects with no anon/authenticated grants and no Data API exposure.
- Do not put SECURITY DEFINER functions in public. Prefer SECURITY INVOKER. If a private RLS helper must be SECURITY DEFINER to prevent policy recursion, it must verify auth.uid(), fully qualify objects, set a fixed search_path, avoid dynamic SQL, revoke execute from PUBLIC/anon, grant only to required roles, and have explicit adversarial tests.
- Authorization source is member_profiles.member_role/account_status, not raw user metadata or a client-supplied role.

## 3. Entity catalog

### Phase 2 as-built schema (current implementation)

This section describes the deployed-to-local migration contract exactly. It does not imply a trip confirmation/cancellation or payment policy. All Phase 2 mutations pass through the authenticated `trip-api` Edge Function into service-role-only SQL operations; the browser receives no service credential.

| Entity | Persisted facts, constraints and indexes |
| --- | --- |
| `club_configuration` | Singleton row; nullable `club_timezone` and `default_poll_close_time` until configured; `default_poll_lead_days` 1–120 (default 35); `default_minimum_participants` 1–100 (default 4, planning value only); `next_month_to_generate`, `next_rotation_position`, optimistic `version`, updater/time. |
| `campsites` | Seven seeded rows: Del Monte, Wishon Cove, DeSabla, Almanor, Shasta, Britton, Pit River; `id`, unique `name`, nullable unique `rotation_position`, HTTPS availability URL, location/directions/reservation text, capacity/types, estimated rate in integer cents, availability status/source/verified time, active/version/actor/timestamps. Active sites require positive rotation position; inactive sites have none. Partial active-rotation index. Admin-only notes are isolated in `private.campsite_admin_notes`. |
| `camping_trips` | One row per first-of-month `month_key` (unique); rotation position, suggested and selected campsite FKs, optional trip dates, timezone snapshot/deadline, `minimum_participants`, nullable `minimum_basis`, optional capacity, `poll_status` constrained to `draft/open/closed`, information, availability status, version/actors/timestamps. Date pair must be complete and ordered; an open poll requires dates, timezone, and deadline. Once set, the timezone snapshot governs later deadline edits even if the club default changes; the current default is used only before a trip gets a snapshot. Indexes: month, selected site/month, and open deadline partial index. No formal registration/trip lifecycle or cabin/payment columns exist. |
| `trip_poll_events` | Append-only event keyed uniquely by `(trip_id, request_id, event_type)`; calendar generation, poll opened/closed/reopened, trip configured, campsite override, rotation reorder; actor, from/to poll state, reason, details, time. Indexed by trip and descending creation time. |
| `rule_definitions` | Stable key, category, `general` or `trip` scope, optional trip FK, active state, creator/time. Check ties scope to null/non-null trip. Partial unique indexes protect general keys and per-trip keys. |
| `rule_versions` | Immutable `definition_id`, sequence, human text, typed JSON object, effective/expiry timestamps, creator/time; unique definition/version, expiry after effective time. Structured JSON size is capped. Current versions are resolved by effective time. |
| `trip_rule_overrides` | Trip + general-rule definition + exact base rule-version FK, immutable replacement text/structured values, positive sequence, required expiry, reason and creator/time; retired timestamp is the only allowed update. One current override per trip/base definition. |
| `trip_rule_bundles` / `trip_rule_bundle_entries` | Immutable rendered JSON bundle and SHA-256 content hash, monotonically versioned per trip; `is_current` is the only guarded projection update. Entries identify exactly one rule version or override and source kind. Open polls refresh against current effective/expiry times on authenticated calendar/Constitution reads and before new Coming entries. Identical hashes reuse the current version; a changed hash creates a new immutable version. No authenticated Data API SELECT grant; trusted `trip-api` reads refresh and return the current bundle. Unique current bundle per trip and unique entry references. |
| `trip_rule_acknowledgments` | Immutable member/trip/bundle FK, content hash, statement version, idempotency request UUID, acknowledgment timestamp; unique per member/trip/bundle/statement, indexed by member/trip/time. |
| `trip_rsvps` | One projection row per trip/member; response `coming/not_coming`, optional acknowledgment FK constrained to the same trip/member, version and timestamps. Coming requires an acknowledgment. Indexed by trip/response and member/time. The acknowledgment reference remains the exact version that member accepted. |
| `trip_rsvp_events` | Append-only `submitted/changed/withdrawal_requested/admin_interest_recorded` events with actor/member, before/after interest response, acknowledgment, request UUID, reason and time; unique member/request; indexed by trip/time. |
| `trip_withdrawal_requests` | Separate pending request with trip/member, required reason, request UUID and time; unique member/request and trip/member; indexed by trip/time. A post-close request does not alter the Coming RSVP. |

All public Phase 2 tables enable RLS. `anon` and `authenticated` have no write grants; authenticated users have SELECT grants filtered by active-member policies. Poll event visibility is admin-only. Members see their own RSVP, acknowledgment and withdrawal rows. Member reads of other participants are aggregated by `trip-api` to a Coming count; active display names and response roster are returned only to administrators. Private campsite notes have no client grant and are returned by one SECURITY DEFINER function that validates the current active admin in the database; EXECUTE is service-role-only. All other Phase 2 RPCs revoke PUBLIC/anon/authenticated EXECUTE and grant only to `service_role`.

`pg_cron` runs calendar replenishment monthly and closes due interest polls every five minutes. Calendar generation is unique by `month_key` and safe to repeat. Poll close changes only `poll_status`; it does not evaluate minimum participation, confirm/cancel a trip, create contribution obligations, or send email. Local Cron behavior was tested; hosted Cron availability/monitoring was not.

Columns below are normative design fields; implementation may add operational timestamps or generated columns without changing business semantics.

### Membership and payment preference

| Entity | Key columns and rules |
| --- | --- |
| member_profiles | Implemented: member_id UUID PK (stable club identity), auth_user_id unique nullable FK auth.users ON DELETE SET NULL, display_name (1–80 chars), member_role(member/admin), account_status(active/inactive/suspended), created_at, updated_at, deactivated_at. Role/status changes only through trusted operation. Members can directly update only their own display_name. Historical finance/attendance references use member_id, not auth_user_id. |
| member_private_contacts | Implemented: member_id PK/FK member_profiles, phone_e164 with E.164 format check, updated_at. Active member can read/insert/update only own row; admin retrieval is server-side only. |
| member_payment_methods | Implemented: id PK, member_id FK, method(zelle/venmo/paypal/apple_cash), preferred, accepted_for_receiving, active, verified_format_at, created_at, updated_at. Contains no payment identifier. At most one preferred active method per member. Active owner can read/manage safe method metadata only. |
| member_payment_capabilities | member_id FK, method, enabled, updated_at. Optional sender-supported methods used only if owner approves compatibility optimization; default is no compatibility inference. |
| private.admin_invitation_events | Implemented: id PK, normalized-email HMAC (raw email is not stored), invited_by, auth_invite_id, requested_role, is_bootstrap, status, created_at, accepted_at, expires_at. No anon/authenticated grant or Data API exposure; invitation metadata is not authorization proof. Pending same-email invitation is unique. |
| private.member_payment_identifiers | Implemented: payment_method_id PK/FK, identifier_ciphertext, 12-byte nonce, encryption_key_version, fingerprint_hmac, created_at, updated_at, delete_after, deleted_at. AES-256-GCM encrypted in the Edge Function before storage; encryption and separate fingerprint keys exist only as Edge Function secrets. No anon/authenticated schema/table grants and no Data API exposure. Plaintext is not logged or stored in PostgreSQL. |
| private.idempotency_records | Implemented: id PK, principal_scope, operation_key, aggregate_type, aggregate_id, key_hmac, hmac_key_version, canonical_request_hash, result_entity_id, result_code, status(processing/completed), lease_expires_at, replay_expires_at, tombstone_expires_at, created_at. Unique(principal_scope,operation_key,aggregate_type,aggregate_id,hmac_key_version,key_hmac); raw key and sensitive response body are never stored. Phase 1 safe result replay expires at 30 days; known expired keys reject and never execute again. Tombstone cleanup is not enabled. |

### Campsites, availability, rotation, and trips

| Entity | Key columns and rules |
| --- | --- |
| campsites | id PK, rotation_position 1..7 unique, name, location_summary, active, public_description, created_at. |
| rotation_configuration | singleton_key PK constrained to one row, next_position 1..7, updated_by, updated_at. Changes are audited. |
| availability_imports | id PK, created_by, source, collected_at, imported_at, status(draft/approved/rejected/stale), source_hash, parser_version, validation_summary, reviewed_by, reviewed_at. |
| campsite_availability_snapshots | id PK, campsite_id FK, import_id FK, observed_for_start/end, availability_state, source_url, collected_at, verified_by, verified_at, stale_after. Source provenance retained. |
| camping_trips | id PK, month_key date unique (first of month), campsite_id FK, starts_at, ends_at, timezone, registration_opens_at, registration_cutoff_at, minimum_coming >= 1, minimum_basis(coming_rsvp/received_contribution) nullable until owner decision, minimum_basis_policy_ref nullable, cabin_payer_coverage_counts_toward_minimum nullable boolean, cabin_payer_coverage_policy_ref nullable, registration_status(draft/open/closed), trip_status(draft/open/confirmed/cancelled/completed/closed), primary_admin_member_id FK, backup_admin_member_id FK, created_by, confirmed_at, cancelled_at, cancellation_reason, closed_at, created_at, updated_at. CHECK open => basis/policy reference non-null; received_contribution => explicit payer-coverage choice/reference. Basis and choice immutable after registration opens. Keep registration lifecycle separate from trip lifecycle. |
| trip_lifecycle_events | id PK, trip_id FK, from_registration_status, to_registration_status, from_trip_status, to_trip_status, actor_id nullable for system, event_type, reason, decision_basis nullable, policy_decision_reference nullable, qualifying_count nullable, qualifying_record_ids/hash nullable, event_key unique where idempotent, created_at. Append-only; stores cutoff decision evidence. |
| trip_attendance | trip_id FK, member_id FK, attendance_status(attended/no_show/withdrawn), marked_by, marked_at, notes. PK(trip_id,member_id); immutable after settlement lock except audited correction. |
| trip_history_summaries | trip_id PK/FK, campsite_name_snapshot, location_snapshot, starts_at, ends_at, finalized_at. Long-term minimal history. |
| trip_history_attendees | trip_id FK, member_id FK stable identity, display_name_snapshot. PK(trip_id,member_id). Preserves who attended if an Auth identity is recreated. |

### Rule catalog, versions, and signup acknowledgments

| Entity | Key columns and rules |
| --- | --- |
| rule_definitions | id PK, stable_key unique, category, scope(general/trip), active, created_at. |
| rule_versions | id PK, definition_id FK, version_no, trip_id nullable FK for trip-only rules, human_text, structured_values jsonb, effective_from, expires_at nullable, created_by, created_at. Unique general version per (definition_id,version_no) when trip_id is null; unique trip version per (definition_id,trip_id,version_no) when trip_id is set. Trip-scoped versions require expires_at; structured values are validated against rule category schema. |
| trip_rule_overrides | id PK, trip_id FK, general_rule_definition_id FK, base_rule_version_id FK, override_rule_version_id FK, reason, expires_at NOT NULL, created_by, created_at, retired_at nullable. Only one active override per (trip_id,general_rule_definition_id); expired/retired rows are retained for historical snapshots. |
| trip_rule_bundles | id PK, trip_id FK, bundle_version, constitution_version_id nullable, rendered_bundle jsonb, content_hash, is_current, created_at, created_by. Immutable; unique(trip_id,bundle_version), unique(trip_id,content_hash), at most one current bundle per trip. This is what a participant reviews. |
| trip_rule_bundle_entries | bundle_id FK, rule_version_id FK, source_kind(general/trip_specific/override), override_id nullable FK. PK(bundle_id,rule_version_id,source_kind); foreign keys preserve exact source versions. |
| trip_rule_acknowledgments | id PK, trip_id FK, member_id FK, bundle_id FK, content_hash, statement_version, acknowledged_at, client_request_id. Unique(member_id,trip_id,bundle_id,statement_version); immutable. Composite key/FK pattern must ensure bundle belongs to trip. |
| trip_policy_snapshots | id PK, trip_id FK unique, bundle_id FK, structured_policy_snapshot jsonb, content_hash, created_at. Created at confirmation for historical financial interpretation; may differ from a signup bundle if rules were changed later. |

### RSVP and trip preparation

| Entity | Key columns and rules |
| --- | --- |
| trip_rsvps | id PK, trip_id FK, member_id FK, response(coming/not_coming), post_confirmation_withdrawal_state(none/requested/approved/rejected/effective), withdrawal_requested_at nullable, withdrawal_resolved_at nullable, rule_acknowledgment_id nullable FK, updated_at, created_at, version. Unique(trip_id,member_id). Coming requires a valid acknowledgment for the same trip/member. Withdrawal approval behavior remains an owner decision; do not promote request to effective withdrawal unless selected policy permits it. |
| trip_packing_items | id PK, trip_id nullable FK for general/trip-specific item, item_text, optional, sort_order, active, created_by. |
| trip_packing_responses | trip_id FK, member_id FK, item_id FK, packed boolean, updated_at. PK(trip_id,member_id,item_id). |
| trip_meal_slots | id PK, trip_id FK, meal_key, local_date, meal_period, preference_cutoff_at, frozen_at nullable, created_by. |
| trip_meal_preferences | trip_id FK, member_id FK, meal_slot_id FK, choice(vegetarian/non_vegetarian/not_eating/no_preference), updated_at. PK(trip_id,member_id,meal_slot_id). |
| trip_coffee_preferences | trip_id FK, member_id FK, morning(saturday/sunday), choice(coffee/tea/neither/no_preference), updated_at. PK(trip_id,member_id,morning). |
| trip_responsibility_definitions | id PK, trip_id nullable FK for reusable club task, label, time_block(friday_night/saturday_morning/saturday_night/sunday_morning/trip_wide), workload_weight positive, active, created_by. |
| trip_responsibility_slots | id PK, trip_id FK, responsibility_definition_id FK, slot_number >= 1, capacity >= 1, created_by, created_at. Unique(trip_id,responsibility_definition_id,slot_number). |
| responsibility_assignments | id PK, trip_id FK, member_id FK, time_block, responsibility_definition_id FK nullable, status_projection(claimed/needs_assignment/admin_assigned/released), assigned_by nullable, claim_order, created_at, updated_at. Unique(trip_id,member_id,time_block) for required blocks. Status is rebuildable from append-only `audit_events`; claim atomically locks/checks capacity. |
| trip_vehicles | id PK, trip_id FK, label, vehicle_type, driver_id FK, workload_weight > 0, mileage, cents_per_mile, carpool_minimum, eligible, exception_reason, created_by. Mileage >= 0; driver workload credit and reimbursement rate/eligibility come from the trip policy snapshot. |
| trip_vehicle_riders | id PK, trip_id FK, vehicle_id FK, member_id FK, position, assigned_at. Unique(vehicle_id,member_id) and unique(trip_id,member_id); composite FK ensures vehicle belongs to trip. |
| floor_lottery_draws | id PK, trip_id FK, draw_no, requested_count, eligible_roster_snapshot, eligible_roster_hash, selected_member_ids, created_by, reason nullable for first draw, algorithm_version, random_source_version, seed_commitment, encrypted_seed_reference nullable, created_at. Unique(trip_id,draw_no); rerun requires reason. Server computes eligibility from locked trip data and stores complete input/output audit record. Seed material is encrypted/private and deleted with operational lottery detail. |
| floor_lottery_exchanges | id PK, draw_id FK, selected_member_id FK, replacement_member_id FK, requested_at, accepted_at, status_projection(pending/accepted/rejected/cancelled), unique draw/member pair; status rebuilds from append-only event/audit facts; both members must be eligible and accept. |
| trip_whatsapp_links | trip_id PK/FK, invitation_url, created_by, created_at, expires_at, removed_at. Visible only to confirmed trip members/admin; delete at trip completion. |

### Cabin reservation and contribution accounting

| Entity | Key columns and rules |
| --- | --- |
| cabin_reservations | id PK, trip_id FK unique, reservation_reference, provider_label, paid_by_member_id FK member_profiles, reservation_amount_cents bigint >= 0, status_projection(not_booked/booked/cancellation_requested/cancellation_confirmed/unresolved), contractual_refund_deadline, safety_buffer_days >= 0 default 5, calculated_registration_cutoff, refund_or_credit_cents nullable >= 0, refund_status_projection, version. Status is rebuilt from append-only `cabin_reservation_events`; no direct client updates. The assigned contribution recipient is the recorded payer. No provider credentials stored. |
| cabin_reservation_events | id PK, reservation_id FK, event_type(booking_recorded/cancellation_requested/provider_contacted/cancellation_confirmed/refund_or_credit_recorded/escalated/rebooked), actor_id, event_key unique, amount_cents nullable, evidence_note_redacted, occurred_at, idempotency_record_id FK. Append-only; provider cancellation is distinct from club trip cancellation. |
| cabin_payment_assignments | id PK, trip_id FK, assignment_version, recipient_member_id FK, payment_method_id FK, assigned_by, assigned_at, effective_until nullable. Unique(trip_id,assignment_version); one active assignment per trip. Recipient must be active and method active/accepted. |
| cabin_contributions | id PK, trip_id FK, member_id FK, recipient_assignment_id FK, amount_due_cents bigint fixed at 5000, due_at, obligation_created_at, created_at. Unique(trip_id,member_id). Obligation fact is immutable. Create at Coming signup for received_contribution basis, or after confirmation for coming_rsvp basis. A later withdrawal does not delete it. |
| cabin_contribution_events | id PK, contribution_id FK, event_type(sent/received/disputed/booking_coverage_acknowledged/refund_approved/refund_sent/refund_received/cost_credit/resolved), amount_cents bigint > 0, actor_id, external_reference_redacted nullable, idempotency_record_id FK, related_event_id nullable, reason, created_at. Append-only. `booking_coverage_acknowledged` is a non-posting marker for the attending cabin payer's own $50 commitment, linked to the vendor booking; it must not enter settlement balances separately. |
| cabin_contribution_state_projections | contribution_id PK/FK, state_projection(due/marked_sent/partially_received/received/disputed/refund_pending/refund_partially_sent/refund_confirmed/credited/unresolved), projected_received_cents, projected_refunded_cents, last_event_at, projection_version. Rebuildable from immutable obligation + events; never the financial source of truth. |
| cabin_contribution_resolutions | id PK, contribution_id FK, outcome(refund/club_credit/retain_against_documented_cost/unresolved), amount_cents, evidence_note, approved_by, created_at, policy_decision_id. Append-only; no automatic resolution for cancellation or contribution excess until owner policy is approved. |

### Expenses and receipts

| Entity | Key columns and rules |
| --- | --- |
| expense_categories | id PK, stable_key unique, display_name, category_type(food/travel/cabin/lodging/alcohol/other), active. |
| trip_expenses | id PK, trip_id FK, payer_member_id FK, category_id FK, description, incurred_at, amount_cents bigint > 0, expense_status_projection(submitted/under_review/approved/rejected/disputed/locked), submitted_at, approved_by, approval_at, version. Status is rebuildable from immutable audit/review facts. Only actual attendees may be allocated; post-trip admin adjustments require reason. |
| expense_allocations | id PK, expense_id FK, member_id FK, amount_cents bigint >= 0, allocation_basis(equal/custom/percentage/individual), opt_in_at nullable, created_by. Unique(expense_id,member_id). Sum must equal expense total before approval; validate in a transaction/deferred trigger. |
| expense_receipts | id PK, expense_id FK, storage_object_path unique, content_type allowlist, byte_size, uploaded_by, uploaded_at, delete_after, deleted_at. Private bucket, no public URLs. |
| trip_expense_locks | id PK, trip_id FK, version, locked_by, locked_at, expense_set_hash, admin_reopen_of nullable FK, reopen_reason nullable. Immutable lock snapshots; unique(trip_id,version). |

### Settlement ledger and external payment events

| Entity | Key columns and rules |
| --- | --- |
| settlement_runs | id PK, trip_id FK, version_no, parent_run_id nullable FK, run_type(initial/adjustment), status_projection(preview/finalized/closed/superseded), expense_lock_id FK, policy_snapshot_id FK, input_hash, output_hash, algorithm_version, exact_solver_used boolean, created_by, finalized_by, finalized_at, closed_at, adjustment_reason. Unique(trip_id,version_no); finalized accounting facts immutable; status is rebuildable from settlement_run_events. |
| settlement_balances | run_id FK, member_id FK, net_amount_cents bigint, balance_role(debtor/creditor/zero), prior_paid_amount_cents bigint >= 0, cabin_advance_applied_cents bigint >= 0. PK(run_id,member_id). Sum of net_amount_cents equals zero before transfers. |
| settlement_transfers | id PK, run_id FK, transfer_no, payer_member_id FK, recipient_member_id FK, amount_cents bigint > 0, status_projection(pending/partially_paid/marked_sent/confirmed_received/disputed/resolved/superseded), payment_method_id nullable FK, instruction_expires_at nullable, replaces_transfer_id nullable FK, idempotency_record_id FK, created_at. Payer != recipient. Unique(run_id,transfer_no). Amount and parties immutable after finalization; status is a projection of events. |
| settlement_payment_events | id PK, transfer_id FK, event_type(sent/received/disputed/resolved/refund_sent/refund_received), amount_cents bigint > 0, actor_id, external_reference_redacted nullable, related_event_id nullable, idempotency_record_id FK, reason, created_at. Append-only; partial payments are multiple events, not edited amounts. |
| settlement_ledger_entries | id PK, run_id FK, account_kind(member/cabin_contribution_fund/unapplied_contribution), member_id nullable FK, source_kind(expense_payer_credit/expense_allocation/contribution_payment/contribution_fund_application/settlement_payment/refund/adjustment), source_expense_id nullable FK, source_allocation_id nullable FK, source_contribution_event_id nullable FK, source_payment_event_id nullable FK, source_resolution_id nullable FK, signed_amount_cents, created_at. Append-only; use balanced debit/credit pairs per source transaction and one documented sign convention for member net balances. Exactly one source FK except an explicitly linked paired posting; member required iff account_kind=member. Non-posting coverage markers are excluded. Unresolved funds post to `unapplied_contribution`, never available to trip expenses. |
| settlement_run_events | id PK, run_id FK, event_type(preview_created/finalized/closed/superseded/reopened_for_adjustment), actor_id, reason, event_key unique, created_at. Append-only; drives `status_projection`. |
| settlement_transfer_state_projections | transfer_id PK/FK, state_projection, sent_cents, received_cents, disputed_cents, last_event_at, projection_version. Rebuildable from immutable settlement_payment_events; never authoritative. |
| settlement_cabin_contribution_applications | id PK, run_id FK, contribution_id FK, contribution_event_id nullable FK, treatment(attendee_advance/unpaid_obligation/approved_withdrawal_application/refund_reversal/unapplied), beneficiary_member_id nullable FK, applied_amount_cents bigint > 0, created_at. Unique source application per version/treatment. Records projection/application detail but cannot alter immutable event amounts. Unapplied amounts block settlement closure. |
| settlement_adjustment_links | prior_run_id FK, adjustment_run_id FK, transfer_id FK nullable, event_id FK nullable, applied_amount_cents, treatment(applied/remaining/credited/disputed), created_at. Explicit lineage of prior payment application. |
| financial_retention_markers | trip_id FK, settlement_closed_at, dispute_resolved_at nullable, ledger_delete_after, receipt_delete_after, identifier_delete_after, cleanup_event_id nullable. Internal, auditable. |

### Notifications, auditing, and internal operations

| Entity | Key columns and rules |
| --- | --- |
| notification_receipts | id PK, recipient_member_id FK, trip_id nullable FK, notification_type, aggregate_id, status_projection(queued/accepted/delivered/bounced/failed), created_at, last_attempt_at, read_at nullable. Projection from private outbox/attempt facts. Member sees only own safe delivery status/summary. |
| audit_events | Implemented: id PK, actor_id nullable, actor_kind(member/admin/system), entity_type, entity_id, action, reason, before_hash, after_hash, request_id, created_at. Append-only; sensitive values omitted; `(actor_id, request_id)` is unique to deduplicate retry audits. |
| private.notification_outbox | id PK, recipient_address protected, recipient_member_id nullable FK, template_key, safe_payload, idempotency_key unique, status_projection, not_before, attempts, created_at, last_error_redacted. Projection of immutable attempts; no client grant. |
| private.notification_attempts | id PK, outbox_id FK, provider_message_id, result, http_status, response_redacted, attempted_at. No raw email provider secrets. |
| private.scheduled_job_runs | id PK, job_key, scheduled_for, started_at, completed_at, status, processed_count, error_summary, idempotency_key unique. No client grant. |
| private.operations_alerts | id PK, alert_type, severity, entity_id, detected_at, acknowledged_by, acknowledged_at, resolution_note, resolved_at. No client grant. |
| application_settings | Implemented: stable_key PK, typed_value jsonb, is_public, changed_by, changed_at, description. Public reads are row-filtered by `is_public`; writes are reserved for trusted operations. |

## 4. Relationships

- auth.users 0..1:1 member_profiles through nullable auth_user_id; stable member_id survives login recreation. A profile has 1:1 private contacts and 1:N payment methods.
- campsites 1:N camping_trips; rotation_configuration is a singleton governing unique trip month keys.
- camping_trips 1:1 cabin_reservations, trip_policy_snapshots and long-term history summary; one trip has N RSVPs, rule bundles, attendance rows, meals, tasks, vehicles, expenses, contributions, runs and notices.
- Rule definitions 1:N immutable rule versions; trip overrides reference both base and override versions; bundle entries FK to exact versions and each bundle has a content hash.
- One Coming RSVP references an acknowledgment for the same member/trip; one acknowledgment references the exact bundle.
- A confirmed trip attendee has at most one cabin contribution obligation; the obligation has append-only payment/refund/credit events.
- One expense has one payer and N allocations. A trip has one or more immutable expense locks.
- One settlement run has N balances and transfers. Adjustment runs reference a prior run; payment events remain attached to original transfers and adjustment links state how much is already paid. Settlement cabin contribution applications record each cabin obligation/receipt/credit once per run.
- A contribution receipt is a completed external payment event against a due obligation. It is not a second expense. The cabin vendor invoice is allocated once across the eligible cabin-cost allocation set; the $50 receipts reduce outstanding member balances. Any receipt above the amount applied by an approved cabin policy is held in the unapplied account and blocks closure.
- `booking_coverage_acknowledged` is a non-posting event tied to the recorded payer's vendor payment; it proves commitment coverage only and creates neither a cash receipt nor a second vendor credit.
- Receipt objects belong to an expense; storage authorization derives from expense participant/admin authorization.
- Notification outbox is private; only safe per-recipient delivery summaries are exposed to the recipient/admin.

## 5. Constraint and transaction rules

Database constraints enforce local facts (domains, nonnegative amounts, unique trip/member rows, positive capacities, no self-transfer, trip/date ordering). Cross-row financial facts are validated inside one transaction in a narrow database operation or trusted Edge Function plus RPC:

1. Before expense approval/lock, allocations total exactly expense amount and only actual attendees are allocated.
2. Before finalization, expense snapshot is locked, every confirmed external receipt and prior settlement payment is applied once, vendor expense allocations balance, all member net balances sum to zero, and proposed transfer deltas settle the remaining balances.
3. Finalization stores snapshot hashes and the transfer set atomically; retry with same idempotency key returns same run.
4. A finalized run cannot be updated/deleted. Revision creates a new version and references all prior payment events.
5. Contribution/refund event sums cannot exceed authorized obligation/refund/cost-credit amounts. `sent` events are not cash receipts; `received` events require recipient authority. A booking coverage marker is non-posting.
6. Member deactivation preserves FK integrity and historical participation.
7. Deadline processor locks each due trip row and uses unique event/outbox idempotency keys to avoid duplicate transitions. Null/unsupported `minimum_basis` fails closed.
8. Responsibility claim locks the time-block/slot row, checks current count and uniqueness, then inserts atomically.

Use explicit RESTRICT/NO ACTION on financial and audit FKs; CASCADE is reserved for expiring operational preference rows after policy review. Do not cascade-delete a member or trip with financial children.

## 6. Required indexes

Primary/unique indexes are implicit. Add the following indexes after each phase's query patterns are measured:

- Every FK column not leading a composite index: campsite/trip, trip/member, rule/version, expense/member, settlement/member, transfer payer/recipient, payment event, outbox recipient, audit actor/entity.
- Phase 1 implemented: `member_profiles(member_role)` partial for active administrators and `member_profiles(account_status)`; `member_payment_methods(member_id,active)` plus unique partial one-preferred-active index; unique pending invite email HMAC and unique pending/accepted bootstrap reservation; audit entity/actor chronology and unique `(actor_id,request_id)`; idempotency unique `(principal_scope,operation_key,aggregate_type,aggregate_id,hmac_key_version,key_hmac)` plus tombstone cleanup eligibility.
- camping_trips(month_key unique), (trip_status, registration_cutoff_at), (starts_at), (campsite_id, starts_at).
- trip_rsvps(trip_id,response), (member_id,updated_at DESC); unique(trip_id,member_id).
- trip_rule_bundles(trip_id,bundle_version DESC); acknowledgments(member_id,trip_id,acknowledged_at DESC).
- cabin_reservations(status_projection,contractual_refund_deadline); cabin_reservation_events(reservation_id,occurred_at); cabin_contributions(trip_id,obligation_created_at), (member_id,created_at DESC); cabin_contribution_events(contribution_id,created_at); cabin_contribution_state_projections(state_projection).
- notification_outbox(status,not_before) partial on queued/retryable; unique idempotency key. notification_receipts(recipient_member_id,created_at DESC).
- trip_expenses(trip_id,expense_status,incurred_at); expense_allocations(expense_id,member_id) unique.
- settlement_runs(trip_id,version_no DESC); settlement_run_events(run_id,created_at); settlement_balances(run_id,member_id); settlement_ledger_entries(run_id,source_kind); settlement_transfers(run_id,payer_member_id), (run_id,recipient_member_id); payment events(transfer_id,created_at); settlement_transfer_state_projections(state_projection); settlement_cabin_contribution_applications(run_id,contribution_id), plus unique source application index.
- responsibility_assignments(trip_id,time_block,status); lottery draws(trip_id,draw_no).
- campsite_availability_snapshots(campsite_id,observed_for_start DESC); availability_imports(status,created_at DESC).
- audit_events(entity_type,entity_id,created_at DESC), (actor_id,created_at DESC).
- private.scheduled_job_runs(job_key,scheduled_for DESC); private.operations_alerts(resolved_at,detected_at) partial where unresolved.
- private.idempotency_records(aggregate_type,aggregate_id,operation_key,hmac_key_version,key_hmac) unique; index tombstone_expires_at for eligible cleanup. Never delete financial/lifecycle tombstones before aggregate deletion.
- Use partial indexes for current/active rows where this matches real query filters. Avoid JSONB GIN until a measured query needs it. Run EXPLAIN on member-calendar, due-deadline, admin-expense, settlement detail, outbox poll, and RLS predicates.

## 7. Table-level RLS/grant policy summary

Detailed testable policies are in SECURITY_ARCHITECTURE.md. This table is binding; do not substitute broad authenticated access.

| Table family | anon | Active member | Admin | System |
| --- | --- | --- | --- | --- |
| member_profiles | No | Select own; update own display name only | Read/update via trusted operations; no direct admin table grant | Auth/bootstrap/member operation |
| member_private_contacts | No | Select/insert/update own while active | Read/update through trusted operation only | No general access |
| member_payment_methods | No | Select/insert/update own safe method metadata while active | Read/manage through trusted operation only | Payment instruction operation may resolve minimum required recipient row |
| campsites and published availability | Published read only | Read published | Full admin write via function | Import process |
| trips and public trip descriptions | No private roster | Read active-trip fields | Full via function | Deadline processor only |
| trip_rsvps | No | Read own, write own eligible response via function; limited confirmed roster names only | Read/manage via function | Deadline processor |
| rule definitions/versions/bundles/entries | Published/current read | Read rules for eligible trips | Manage via function | Snapshot function |
| trip_rule_acknowledgments | No | Read own; insert only through signup operation | Read/manage as admin | No update/delete |
| cabin reservation and contribution tables | No | Read own contribution and relevant cabin trip details | Read/manage via function | Deadline/outbox job |
| trip preparation/transport/lottery | No | Read eligible trip info; mutate own prefs/claims only | Full via function/audited overrides | Lottery routine |
| expenses/allocations | No | Read permitted attendee expense fields; submit own; propose own allocation | Review/approve/lock via function | No general access |
| receipts/storage objects | No | Read/upload only as payer or allocated member | Read/review/delete | Retention worker |
| settlement_runs | No | Read safe current-run summary only if involved | Read all/finalize via function | No |
| settlement_balances | No | Own row only | Read all | Finalization only |
| settlement_transfers/events and settlement_cabin_contribution_applications | No | Payer/recipient only; own contribution applications only | Read/resolve via function | Finalization/outbox/retention only |
| trip_history_summaries and trip_history_attendees | No | Read allowed attendee/name history | Read/manage | Retention operation |
| audit_events | No | No | Read/write through trusted operation; no direct table grant | Append only |
| notification_receipts | No | Own safe status only | Read/manage retry via function | Worker writes |
| private.* tables | No | No | Sanitized admin function/view only | Service/job only |
| application_settings | No | Read explicitly public settings only | Admin writes via function | Job reads necessary settings |

All UPDATE policies must constrain both old and new row ownership (USING and WITH CHECK). Grant privileges and create policies together in migrations. Every exposed view must use security-invoker behavior where supported or live in a non-exposed schema with explicit access controls. Test SELECT/INSERT/UPDATE/DELETE denial and allowance per table and role.

## 8. Retention and deletion

- At trip closure, expire WhatsApp invitation links, meal/packing detail, assignment detail, and detailed RSVP change rows unless dispute/settlement operations still require them.
- After settlement closure, delete receipt objects and sensitive payment-instruction identifier copies after three months.
- Retain minimal immutable settlement versions, payment event amounts/statuses, applicable policy snapshot, and high-level location/date/attendee history for 12 months after closure; unresolved disputes start the retention clock after resolution.
- Apply backup/export expiry independently; restoring an old backup requires replaying retention cleanup before returning service to members.
- Every cleanup writes a non-sensitive audit record; cleanup is idempotent.

## 9. Current platform note

Supabase's announced Data API default changed for new projects on 2026-05-30 and is scheduled to apply across all projects on 2026-10-30. The schema and migrations must explicitly configure API exposure and table grants instead of depending on defaults. Re-check the date/current behavior before implementation. References: [Supabase changelog](https://supabase.com/changelog?types=breaking-change), [RLS and grants](https://supabase.com/docs/guides/database/postgres/row-level-security).
