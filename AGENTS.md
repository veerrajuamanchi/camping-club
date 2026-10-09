# Agent Instructions — Private Camping Club

These instructions are mandatory for all agents and contributors working in this repository.

## 1. Read before work

Before changing application code, schema, tests or architecture, read in this order:

1. README.md
2. docs/PRODUCT_VISION.md
3. TECHNOLOGY_GUARDRAILS.md
4. docs/superpowers/specs/2026-10-08-camping-club-platform-design.md
5. docs/IMPLEMENTATION_PLAN.md
6. Relevant documents under docs/: DATABASE_SCHEMA.md, API_CONTRACTS.md, STATE_MACHINES.md, STATE_PERSISTENCE_MATRIX.md, SETTLEMENT_ENGINE_SPEC.md, FINANCIAL_WORKED_EXAMPLES.md, SECURITY_ARCHITECTURE.md, OPERATIONS_AND_RECOVERY.md, TEST_STRATEGY.md, REQUIREMENTS_TRACEABILITY.md, CONSISTENCY_REMEDIATION_REPORT.md and OWNER_DECISIONS.md
7. This AGENTS.md and any narrower AGENTS.md applying to files changed

If sources conflict, follow the latest owner-approved design and decisions. Stop and report any conflict that changes financial policy, authorization, retention, cancellation or architecture. Do not silently choose.

## 2. Approval boundary

- The owner approved architecture review and implementation planning. This does not authorize application coding.
- Do not create feature code, migrations, deploy services, configure production secrets, or make app behavior changes until the owner explicitly approves the implementation plan.
- Documentation updates requested as part of planning are allowed.
- After plan approval, work only in the approved phase. Do not begin later feature phases early.
- A recommendation in an artifact is not an owner decision. `docs/OWNER_DECISIONS.md` is the canonical register of unresolved business, financial, algorithm and operational choices; never turn its recommendation column into policy without dated explicit owner approval.

## 3. Approved architecture

- Frontend: React + TypeScript + Vite, deployed as a Render Static Site.
- Durable data and identity: Supabase PostgreSQL + Supabase Auth + Row Level Security.
- Trusted server-side operations: Supabase Edge Functions and narrowly scoped transactional database functions.
- Scheduling: Supabase Cron plus independent monitoring, idempotent catch-up jobs, and manual cabin deadline fallback.
- Settlement calculation: pure deterministic TypeScript package; server-side finalization only.
- Campsite availability collection: optional local Python utility, reviewed and published through an authenticated import.
- Preserve a modular monolith. Do not add an always-running app server, SQLite production store, payment processor, WhatsApp API, trip photo/video store, or paid service without owner approval.
- Keep every persistent production record in Supabase; Render filesystem is ephemeral.
- Revalidate Supabase/Render behavior and changelog against official docs immediately before platform-specific implementation.

## 4. Product scope and business rules

The target is the full private camping coordination platform, never a polls-only MVP. Preserve these product areas: invitation/member management, seven-site rotation and rolling calendar, trip RSVP and cancellation, rules and acknowledgment, cabin reservations/contributions, transport, responsibilities, meals/packing, lottery, expenses, settlement and external payment acknowledgments, WhatsApp link handling, email, history and retention.

- Binary RSVP: Coming / Not coming. Default threshold four; per-trip structured override. The minimum-count basis is unresolved: earlier amended design counts active Coming members only after a $50 receipt; later revision counts active Coming RSVPs and requests $50 after confirmation. Do not choose or encode either policy until the owner explicitly decides. Under the received basis, whether the payer's non-posting booking coverage counts is also unresolved.
- Registration cutoff is the earlier of 35 days before trip or contractual cabin cancellation deadline minus configured buffer (default five days).
- At cutoff, below-minimum under the owner-approved basis automatically cancels and sends notices. Reinstatement requires admin action and fresh cabin availability verification. A received-contribution basis also requires an owner-approved disposition for contributions received before an insufficient-participation cancellation.
- Post-confirmation attendance below minimum requires explicit admin proceed/cancel decision.
- Coming signup must acknowledge the exact immutable rule bundle shown (general rules + trip rules/overrides). Store version/hash/time. Later edits do not require re-ack; preserve old acknowledgment and send informational notice as planned.
- Each attendee owes $50 to the administrator-assigned cabin payer under the selected minimum basis; request timing differs by basis. Late confirmed additions owe it. It remains due after post-confirmation withdrawal and is non-refundable for a member withdrawal. Credit it exactly once to cabin accounting. Do not request a self-payment from an attending cabin payer.
- Under `coming_rsvp`, a pre-confirmation below-minimum cancellation creates no $50 obligation, though any premature/extra receipt remains unresolved. Under `received_contribution`, obligations/receipts may exist before that cancellation and must stay unresolved pending owner-approved disposition. Do not invent a refund/forfeiture policy for club-initiated post-confirmation cancellation; block close until approved policy and audited admin disposition.
- Admin alone finalizes expense sets and settlements. Finalized runs are immutable; corrections append a version that accounts for partial, sent and received events.
- Retain minimal ledger/policy snapshot 12 months after closure/resolution; delete receipts and sensitive instruction identifiers after three months. Keep high-level location/date/attendee history.
- Members do not transfer money inside the app. Email does not prove delivery or payment.
- Trip WhatsApp groups are manual. No photo/video upload.

## 5. Security and database rules

- Use integer cents for every monetary value. No floating-point money arithmetic.
- Never expose Supabase service-role/secret keys, email provider keys, database passwords or privileged operations in browser bundles.
- Never authorize from client JSON, raw user metadata, email alone or a stale UI role. Resolve the authenticated user and current active membership/role server-side.
- Enable RLS on all client-exposed tables and explicitly set grants. Schema exposure, grants and RLS are separate checks. Do not rely on default Data API table exposure; explicitly allow only required tables.
- Default-deny visitors. Use ownership and trip-party predicates; authenticated alone is not sufficient.
- UPDATE policies use both USING and WITH CHECK. Test direct Data API access, not only UI.
- Keep internal tables in a non-exposed schema with no anon/authenticated grant.
- Prefer SECURITY INVOKER. If a SECURITY DEFINER RLS helper is necessary, place it in a private schema, verify auth.uid() internally, fully qualify names, fix search_path, revoke PUBLIC execute and add adversarial tests.
- Views must not bypass RLS; use security-invoker behavior where supported or a private schema with explicit grants.
- All FK columns are indexed unless covered by a leading composite index. Use RESTRICT/NO ACTION on member and financial history.
- Financial/lifecycle tables deny direct browser writes; use trusted operations with transaction, idempotency, optimistic version, audit event and outbox as needed.
- Immutable money/payment/lifecycle facts are append-only. UI-facing status fields are rebuildable projections; direct status edits cannot create, remove or settle money. Follow STATE_PERSISTENCE_MATRIX.md.
- Store payment identifiers only in the encrypted, non-exposed `private` schema. No direct Data API query may return an identifier; only the exact authorized instruction operation can decrypt it.
- Never log full payment identifiers, auth tokens, receipt contents or provider secrets.

## 6. Implementation workflow

For each approved phase:

1. State the phase and linked requirement IDs before editing.
2. Inspect current code/schema and applicable architecture docs.
3. Write failing automated tests for the required behavior before implementing it, unless the owner explicitly requests a different testing sequence.
4. Implement the smallest complete vertical slice within the phase.
5. Add or update migrations, RLS, API contract, state machine, test and traceability documentation together.
6. Run the specific unit, database, security and integration checks listed for the phase. Do not claim pass without recorded command/output evidence.
7. Review changed files for unintended scope, secrets, missing RLS/grants/indexes, financial float arithmetic, direct privileged client writes and retention regressions.
8. Report changes, tests/evidence, unresolved decisions, risks and the next blocked/unblocked phase.

Use the installed Supabase CLI’s current --help output rather than guessing commands. Create migration files with the current supported CLI workflow. Pin dependency versions and commit lockfiles. Do not use production data for tests.

## 7. Financial correctness rules

- Normalize all expenses and exact allocations before settlement optimization; do not optimize independently per expense.
- Verify each allocation sums to expense total, aggregate net balances sum to zero, and proposed transfers clear each balance.
- Keep vendor expense, member contribution receipt, booking-coverage marker and settlement payment as distinct events. A booking marker posts zero. Apply confirmed receipts/refunds once; a confirmed attendee's paid contribution is non-refundable on member withdrawal, but its application remains owner-gated. Keep unapplied amounts separate and block settlement closure.
- Follow exact-cent worked examples and reconciliation assertions in FINANCIAL_WORKED_EXAMPLES.md; do not use a candidate transfer list as a finalized policy when an unresolved balance remains.
- Reject self-transfers, zero/negative transfers, overflow, duplicate idempotency keys and allocations to disallowed members.
- Store input/output hashes and engine version. Preserve finalized runs and payment events forever during the 12-month retention window; revisions append new versioned events.
- Exact solver limit/fallback must follow the owner-approved value in SETTLEMENT_ENGINE_SPEC.md. Never describe fallback output as mathematically minimum.

## 8. Operations and launch rules

- Deadline and email jobs must not depend on website traffic; scan overdue work and remain idempotent.
- Monitor scheduler heartbeat outside the Supabase project. A monitor alert does not wake a paused project.
- Maintain the separate manual calendar/cabin cancellation fallback during the Free pilot.
- Keep nightly encrypted off-site export, Auth identity mapping recovery and private Storage receipt backup as separate recovery components. A database dump alone is not a full project backup.
- Proposed pilot targets are RPO <= 24 hours and RTO <= one business day; report actual restore-drill results.
- No public launch until G1–G6 architecture gates and all critical test/security/recovery gates pass.
- No claim of zero recurring cost, production reliability, automated cancellation or delivered email without evidence.

## 9. Scope and decision control

- Do not make hidden changes to financial terms, refund treatment, retention, minimum-count definition, access rules or approved tech.
- Use the decision register in docs/IMPLEMENTATION_PLAN.md. If a choice is unresolved, preserve state for admin review and block the affected transition rather than inventing a policy.
- If the current request conflicts with the approved plan, ask the owner to update the plan before implementing the conflict.
