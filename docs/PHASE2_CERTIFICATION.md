# Phase 2 Certification — Campsites, Calendar, Polls, RSVP, and Camping Constitution

**Certification update:** October 9, 2026
**Authorized scope:** Phase 2 only
**Result:** **PASS WITH RISK**
**Limited production verification deployment:** Owner-authorized and completed October 9, 2026. No additional member onboarding was performed.
**Phase 3:** Not started; awaiting explicit owner approval.

## Certification summary

Phase 2 delivers the approved interest-poll and Camping Constitution scope on the existing Render Static Site + Supabase modular-monolith architecture. The application has seven configured campsites, a configurable round-robin rotation, rolling 12-month calendar generation and admin catch-up, admin date/campsite/poll configuration, Coming/Not Coming member responses, admin-recorded interest entries, expiring trip rules/overrides, immutable effective rule bundles, and exact per-member acknowledgment history.

The minimum participation value is a planning field only. `minimum_basis` remains NULL and cannot be set through the Phase 2 API. The implementation has no formal trip confirmation/cancellation, cabin reservation, contribution collection, payment obligation, or effective post-confirmation withdrawal action. After a poll cutoff, a member's withdrawal request is stored separately and the Coming response remains unchanged. No policy alternative in [OWNER_DECISIONS.md](OWNER_DECISIONS.md) was selected.

The owner authorized the limited Render + Supabase deployment after the earlier documentation-only certification. The merge is `ecdab946b656fad02c5925d2536c29cd889fb519` (PR [#4](https://github.com/veerrajuamanchi/camping-club/pull/4)). The deployed Render app was opened in an authenticated browser: the 12-month calendar rendered, the poll editor exposed **Cabin Booking Status**, and the Constitution history displayed the seeded general rule versions. The hosted database reported 16 active general rules, 12 current poll bundles, and all 12 bundles containing all 16 rules. This was a read-only browser smoke; no poll or RSVP was written to the hosted database.

## Scope and implementation evidence

| Area | Result | Evidence |
| --- | --- | --- |
| Seven campsites and rotation | PASS | Migration seeds Del Monte, Wishon Cove, DeSabla, Almanor, Shasta, Britton, and Pit River in order. Suggested site is preserved when an admin selects an override. |
| Rolling calendar | PASS WITH RISK | Database generation fills the rolling 12-month horizon with a unique month key and repeats safely; admin can catch up/generate. Cron is defined monthly, but hosted Cron operation/monitoring was not tested. |
| Poll configuration | PASS | Admin configures dates, timezone, deadline, capacity, displayed details, and planning minimum. A poll cannot open until dates, timezone, and deadline are present. Each trip preserves its captured timezone on edits if the club default changes; the UTC deadline instant is tested unchanged. Optimistic versions reject stale admin edits. |
| Member RSVP | PASS | Binary Coming/Not Coming is implemented. New/changed-to-Coming checks refresh effective rules under the trip lock and require the exact current bundle. A stale form is rejected. Not Coming requires no acknowledgment. Members see only their own response and aggregate Coming count; admin sees response roster. |
| Withdrawal request | PASS WITH RISK | Before poll cutoff, member can change Coming to Not Coming. After cutoff, a separate request is recorded and Coming stays effective. The OD-03 confirmed-trip policy is intentionally absent. |
| Camping Constitution | PASS | General and trip-specific immutable rule versions, structured values, linked expiring overrides, rendered bundle hash/history, and member acknowledgments are implemented. Authenticated calendar/Constitution reads refresh open-poll bundles at effective/expiry boundaries; identical content reuses the version. Existing Coming acknowledgments remain pinned and do not require re-acknowledgment. Bundle/entry tables have no direct authenticated Data API SELECT grant. |
| Authorization and RLS | PASS locally | Public writes are disabled. Phase 2 writes are restricted to verified active sessions through `trip-api` and server operations; direct Data API writes are denied. Member reads are self-limited; admin reads are role-gated. Private campsite notes are returned only through an admin-checked, service-role-only operation. |
| Concurrency and idempotency | PASS locally | Calendar uniqueness, expected-version conflict handling, database row locks, replay/hash conflict, and concurrent duplicate RSVP/configuration checks are covered by local integration tests. |
| Frontend secret boundary | PASS | Production build and `npm run security:scan` completed; no privileged credentials or payment-key material was found in the client bundle. |
| Render/hosted Supabase | PASS WITH RISK | Migration `20261009005148` is applied to project `kdxmwqxlhswcgwanlump`; `trip-api` is ACTIVE v4 with JWT verification; live Render `/`, `/signin`, and `/polls` return HTTP 200, and served JS/CSS assets contain the updated booking-status labels. A live authenticated admin browser smoke read the calendar and Constitution history. CORS preflight for the configured Render origin passed. No hosted mutation was used as a test fixture; Cron, email delivery, backup/restore, and adversarial hosted RLS testing remain unverified. |

## Executed verification

The pre-deployment Phase 2 worktree completed `npm run verify`; this is preserved as historical evidence. The latest migration and integration test evidence is the passing GitHub Actions check on PR #4 and the follow-up verification workflow described in the October 9 update below. The hosted deployment is verified only for the limited Phase 2 scope.

The earlier worktree run executed:

- TypeScript typecheck: PASS.
- Vitest: PASS — 26 tests across 6 files, including timezone-safe deadline round trip and rule-boundary behavior.
- Local Supabase reset and pgTAP: PASS — 59 assertions across Phase 1 and Phase 2 SQL tests, including bundle reuse, effective/expiry boundary refresh, stale member/admin acknowledgment rejection, direct Data API denial, and per-trip timezone snapshot preservation after club default changes.
- Phase 1 Auth/Edge/RLS/security regression: PASS — synthetic local users.
- Phase 2 Edge/API/RLS/security integration: PASS — synthetic local users, calendar and Constitution refreshed reads, concurrent idempotent RSVP/config writes, admin campsite reorder/edit, late interest, rules, acknowledgments, poll close, direct RLS/bundle-read boundaries, and pending withdrawal.
- Vite production build: PASS.
- Client bundle credential scan: PASS — four generated client files scanned; no privileged credentials/payment keys found.

The Phase 2 integration harness resets only local Supabase and removes its synthetic test fixtures. No hosted service or real member data was used. The results are recorded in [TEST_STRATEGY.md](TEST_STRATEGY.md) and [REQUIREMENTS_TRACEABILITY.md](REQUIREMENTS_TRACEABILITY.md). Phase 1 certification evidence remains in [PHASE1_CERTIFICATION.md](PHASE1_CERTIFICATION.md).

## Owner decision and scope gate review

No pending owner decision blocks the authorized Phase 2 scope. The following gates remain explicit:

- **OD-01:** Minimum-four qualification basis. Blocks evaluating the minimum for formal registration, confirmation, cancellation, or payment collection; does not block a displayed planning minimum or interest polls.
- **OD-02:** If OD-01 selects received contributions, whether an attending cabin payer's non-posting coverage marker counts. Conditional gate for that future evaluator.
- **OD-03:** Effect of post-confirmation withdrawal. Blocks effective withdrawal/admin approval decisions; Phase 2 records only a separate post-cutoff request.
- **OD-04:** Whether cabin verification gates trip confirmation. Blocks confirmation/reinstatement policy only.
- **OD-05–08:** Contribution excess, cancellation disposition, withdrawal accounting and reconciliation; later cabin/financial phases.
- **OD-09–10:** Settlement exact-search limit and payment-method tie-break; settlement phase.
- **OD-11:** Lottery audit and reproducibility approach; lottery phase.
- **OD-12:** Named operations owners, recovery objectives, and backup destination; launch certification.

All remain pending in [OWNER_DECISIONS.md](OWNER_DECISIONS.md). Recommendations in the register are not approvals. Phase 2 does not write the unresolved policies into code.

## Risks and limitations

| Risk | Status / mitigation |
| --- | --- |
| Hosted Render/Supabase behavior, CORS, production configuration and email are partly verified only for Phase 2. | Render static assets, SPA paths, the Phase 2 migration, configured-origin CORS, and authenticated calendar/Constitution reads passed. Cron, email delivery, backup/restore, and adversarial hosted RLS have not been tested; keep real-member use gated on remaining launch requirements. |
| Supabase Free inactivity, Cron interruption, quota and backup/export limitations can delay jobs. | Open. Hosted scheduled job and independent monitoring are not tested; manual trip calendar/deadline fallback and off-site export/restore remain launch requirements. |
| Polls have no email reminder/notification in Phase 2. | Accepted only for current implementation scope. Members must view the in-app calendar; notification delivery is a later phase and must be reviewed before real-member use. |
| Expired trip rule history remains physically stored. | Expiry removes it from current applicable bundles; immutable rule versions, bundle copies, and acknowledgments remain stored. No cleanup worker is in Phase 2; implement the approved 12-month policy snapshot retention in the authorized retention phase (P2-R14). |
| Club timezone and trip dates require explicit admin setup. | Mitigated in the application by requiring timezone/date/deadline before opening; production operating configuration remains unverified. |
| Invitation/Auth persistence and idempotency HMAC-v1 risks from Phase 1 remain. | Open; see [Phase 1 Certification](PHASE1_CERTIFICATION.md) and [Phase 2 Risk Register](PHASE2_RISK_REGISTER.md). |
| Deployment smoke scope is limited. | An authenticated read-only browser smoke verified the deployed calendar, status editor, and seeded Constitution. A full member journey and hosted poll-write journey were not run to avoid creating production test records. Synthetic poll save tests run against the CI-local Supabase stack. |

The authoritative [Phase 2 risk register](PHASE2_RISK_REGISTER.md) retains inherited Phase 1 risks and marks local-only mitigations separately from hosted evidence.

## Targeted review remediation

The implementation review identified two issues before certification was finalized. The poll editor had treated a stored UTC deadline as a local date/time, and rule bundles could become stale when effective/expiry times passed while a poll remained open. Both are corrected and verified: deadlines are edited in the trip's persistent timezone snapshot; open-poll calendar/Constitution reads and new Coming operations refresh rules under a trip lock; stale acknowledgments are rejected; unchanged bundle hashes do not create duplicate versions. An independent follow-up review confirmed both findings are resolved in the current tree.

## Phase 2 certification gates

| Gate | Result | Basis |
| --- | --- | --- |
| Scope guard: no unapproved minimum/payment/confirmation/cancellation behavior | PASS | API allowlist, nullable `minimum_basis`, database tests, and Edge integration checks. |
| Schema, RLS, version history, idempotency and local integration | PASS | Latest CI runs migration replay and pgTAP (64 assertions), Phase 1 regression integration, and the Phase 2 synthetic Edge/API integration suite. |
| Member/admin UI paths | PASS WITH RISK | Current Vitest suite passes; read-only authenticated Render smoke confirms the deployed calendar and Constitution. No hosted poll write was performed. |
| Build and secret scan | PASS | `npm run build` and `npm run security:scan`. |
| Limited hosted Phase 2 deployment | PASS | Owner authorized deployment; migration, active Edge Function, configured-origin CORS, live static assets/routes, and seeded rules/bundles were verified. |
| Hosted Cron, email, backup and restore | NOT RUN | Remains outside this Phase 2 deployment check and is an open launch risk. |

## Recommendation

**Phase 2 remains PASS WITH RISK after its authorized limited deployment.** The deployment does not approve Phase 3 or additional member onboarding. Review this report, [REQUIREMENTS_TRACEABILITY.md](REQUIREMENTS_TRACEABILITY.md), the [Phase 2 risk register](PHASE2_RISK_REGISTER.md), and [OWNER_DECISIONS.md](OWNER_DECISIONS.md). Stop here until the owner explicitly approves the next phase.

## Historical targeted poll and Constitution remediation snapshot (2026-10-08; superseded below)

The latest approved remediation changes the poll field to **Cabin Booking Status** with values **Booked**, **No vacancy**, and **Sites available**; seeds the existing general rules into immutable Constitution versions; and makes poll validation and stale-edit failures visible. It does not choose the unresolved participation/payment basis, start contribution collection, or deploy.

| Check | Result | Evidence / limitation |
| --- | --- | --- |
| `npm test` | PASS — 6 Node tests plus 38 frontend tests across 9 files | Includes the new booking-status form/save contract, missing-timezone guidance, stale-edit feedback, and ambiguous legacy-value review. |
| `npm run typecheck` | PASS | Frontend contracts compile. |
| `npm run build` | PASS | Vite production bundle generated locally. |
| `npm run security:scan` | PASS | Four bundle files scanned; no privileged credentials or payment-key material. |
| `node --check scripts/test-phase2-integration.mjs` and `git diff --check` | PASS | Integration harness syntax and patch checks. |
| `npm run test:db` | BLOCKED | Docker Desktop reports it cannot start, so the new migration and updated pgTAP suite were not executed. |
| Phase 1 and Phase 2 local Supabase integration | NOT RUN for this remediation | Both require the unavailable local Docker/Supabase runtime. The updated Phase 2 harness checks all three booking values, old-value rejection, admin-only legacy display, and seeded rule content; it must be run after Docker is restored. |
| Render / hosted Supabase | NOT RUN | No hosted migration or deployment was performed. |

**Targeted remediation assessment: PASS WITH RISK.** Frontend interaction behavior, compile/build, and bundle scan pass. Database migration replay, RLS/pgTAP, and Edge persistence integration remain unverified because Docker Desktop cannot start. Re-run `npm run test:db`, `npm run test:integration`, and `npm run test:phase2-integration` before treating the migration/API change as fully certified.

This was the pre-deployment snapshot and is retained as historical evidence only. Its Docker-blocked and not-deployed statements were superseded by the CI and hosted verification below. It did not authorize Phase 3.

## Deployment and final verification update (2026-10-09)

| Check | Result | Evidence |
| --- | --- | --- |
| GitHub CI | PASS | PR #4 check `Verify Phase 1`, run [37869171465](https://github.com/veerrajuamanchi/camping-club/actions/runs/37869171465), passed typecheck, 38 frontend tests across 9 files, 64 pgTAP assertions, Phase 1 integration/security, build, and bundle scan. The follow-up workflow change adds `npm run test:phase2-integration` to required CI; its PR check is the current source of the Phase 2 Edge/API harness result. |
| Phase 2 migration replay and seeded bundle regression | PASS | CI reset applied all three migrations and ran the Phase 2 pgTAP suite; assertions include 16 general rules in each of 12 current bundles. Hosted read-only SQL reported `active_general_rules=16`, `current_bundles=12`, `bundles_with_all_16_rules=12`, and the migration recorded. |
| Render Static Site | PASS | Owner-authorized manual deploy because Render auto-deploy was disabled. Live `/`, `/signin`, and `/polls` paths return HTTP 200; the browser loaded the deployed admin calendar and Constitution. The served bundle contains `Cabin Booking Status`, `No vacancy`, and `Sites available`. |
| Supabase Edge Function and CORS | PASS | `trip-api` is ACTIVE v4 with JWT verification. OPTIONS preflight for the configured Render origin passed and returned that origin. The authenticated admin browser read the hosted calendar and seeded Constitution history. |
| Production writes / real-member activity | NOT PERFORMED | No synthetic RSVP, poll-save, member onboarding, cleanup, or financial record was written to the hosted project. The live UI check was read-only. |
| Hosted operations | OPEN | Cron processing, independent monitoring, email delivery, off-site export, and restore have not been certified. |

The CI workflow is being maintained to include both Phase 1 and Phase 2 integration harnesses. The Phase 2 harness uses only synthetic identities and resets only the CI-local Supabase database. Hosted poll-save correctness is established by this isolated integration test, not by writing a test poll into the production database.
