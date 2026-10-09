# Phase 2 Certification — Campsites, Calendar, Polls, RSVP, and Camping Constitution

**Certification date:** October 8, 2026
**Authorized scope:** Phase 2 only
**Result:** **PASS WITH RISK**
**Production deployment / real-member onboarding:** Not performed; not authorized.
**Phase 3:** Not started; awaiting explicit owner approval.

## Certification summary

Phase 2 delivers the approved interest-poll and Camping Constitution scope on the existing Render Static Site + Supabase modular-monolith architecture. The application has seven configured campsites, a configurable round-robin rotation, rolling 12-month calendar generation and admin catch-up, admin date/campsite/poll configuration, Coming/Not Coming member responses, admin-recorded interest entries, expiring trip rules/overrides, immutable effective rule bundles, and exact per-member acknowledgment history.

The minimum participation value is a planning field only. `minimum_basis` remains NULL and cannot be set through the Phase 2 API. The implementation has no formal trip confirmation/cancellation, cabin reservation, contribution collection, payment obligation, or effective post-confirmation withdrawal action. After a poll cutoff, a member's withdrawal request is stored separately and the Coming response remains unchanged. No policy alternative in [OWNER_DECISIONS.md](OWNER_DECISIONS.md) was selected.

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
| Render/hosted Supabase | NOT RUN | No preview or production deployment, hosted migration, production secrets, email delivery, or hosted RLS verification was performed. |

## Executed verification

`npm run verify` completed successfully in the Phase 2 worktree. It ran:

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
| Hosted Render/Supabase behavior, CORS, production configuration and email are unverified. | Open. Perform an authorized isolated staging rehearsal before launch; no production use is authorized by this certification. |
| Supabase Free inactivity, Cron interruption, quota and backup/export limitations can delay jobs. | Open. Hosted scheduled job and independent monitoring are not tested; manual trip calendar/deadline fallback and off-site export/restore remain launch requirements. |
| Polls have no email reminder/notification in Phase 2. | Accepted only for current implementation scope. Members must view the in-app calendar; notification delivery is a later phase and must be reviewed before real-member use. |
| Expired trip rule history remains physically stored. | Expiry removes it from current applicable bundles; immutable rule versions, bundle copies, and acknowledgments remain stored. No cleanup worker is in Phase 2; implement the approved 12-month policy snapshot retention in the authorized retention phase (P2-R14). |
| Club timezone and trip dates require explicit admin setup. | Mitigated in the application by requiring timezone/date/deadline before opening; production operating configuration remains unverified. |
| Invitation/Auth persistence and idempotency HMAC-v1 risks from Phase 1 remain. | Open; see [Phase 1 Certification](PHASE1_CERTIFICATION.md) and [Phase 2 Risk Register](PHASE2_RISK_REGISTER.md). |
| No browser deployment smoke test was run for the Phase 2 UI. | Component interaction tests passed. Run the approved local/staging browser journey during the next certification step; do not deploy to production. |

The authoritative [Phase 2 risk register](PHASE2_RISK_REGISTER.md) retains inherited Phase 1 risks and marks local-only mitigations separately from hosted evidence.

## Targeted review remediation

The implementation review identified two issues before certification was finalized. The poll editor had treated a stored UTC deadline as a local date/time, and rule bundles could become stale when effective/expiry times passed while a poll remained open. Both are corrected and verified: deadlines are edited in the trip's persistent timezone snapshot; open-poll calendar/Constitution reads and new Coming operations refresh rules under a trip lock; stale acknowledgments are rejected; unchanged bundle hashes do not create duplicate versions. An independent follow-up review confirmed both findings are resolved in the current tree.

## Phase 2 certification gates

| Gate | Result | Basis |
| --- | --- | --- |
| Scope guard: no unapproved minimum/payment/confirmation/cancellation behavior | PASS | API allowlist, nullable `minimum_basis`, database tests, and Edge integration checks. |
| Schema, RLS, version history, idempotency and local integration | PASS | 47 pgTAP assertions plus Phase 1/Phase 2 integration suites. |
| Member/admin UI paths | PASS WITH RISK | 26 Vitest tests including ten trip-page interaction tests; no Phase 2 browser deployment smoke. |
| Build and secret scan | PASS | `npm run build` and `npm run security:scan`. |
| Hosted deployment, Cron, email, backup and restore | NOT RUN | Explicitly outside Phase 2 authorization. |

## Recommendation

**Phase 2 is complete and ready for owner review as PASS WITH RISK.** Review this report, [REQUIREMENTS_TRACEABILITY.md](REQUIREMENTS_TRACEABILITY.md), the [Phase 2 risk register](PHASE2_RISK_REGISTER.md), and [OWNER_DECISIONS.md](OWNER_DECISIONS.md). Stop here. Phase 3, production deployment, production secrets, and real-member onboarding require separate explicit approval.

## Targeted poll and Constitution remediation (2026-10-08)

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

This is an update to the earlier Phase 2 evidence, not approval to begin Phase 3 or deploy. The original implementation evidence above remains preserved as historical results for its tested commit.
