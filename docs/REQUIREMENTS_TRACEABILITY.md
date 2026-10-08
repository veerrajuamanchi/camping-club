# Requirements Traceability Matrix

**Source of truth:** [Approved design](superpowers/specs/2026-10-08-camping-club-platform-design.md). A conflict is not an owner decision; unresolved alternatives remain gated in the [Consistency Remediation Report](CONSISTENCY_REMEDIATION_REPORT.md) and [Owner Decision Record](OWNER_DECISIONS.md).
**Purpose:** Every requirement has an implementation phase, test evidence and launch gate. Phase 1 and Phase 2 rows distinguish implemented local evidence from later hosted/phase work. “Test IDs” refer to [TEST_STRATEGY.md](TEST_STRATEGY.md). See [Phase 1 Certification](PHASE1_CERTIFICATION.md) and [Phase 2 Certification](PHASE2_CERTIFICATION.md).

| ID | Requirement | Phase | Implementation and test evidence (future phases remain planned) |
| --- | --- | --- | --- |
| ARC-01 | React + TypeScript + Vite on Render Static Site; no persistent Render filesystem dependency | 1, 8 | `frontend/`, `render.yaml`, production bundle build; UI-01. Render deploy/rollback remains untested and unauthorized (G1 risk). |
| ARC-02 | Supabase Auth + PostgreSQL + RLS are production identity and data store | 1–8 | Migration `20261008165655_phase1_member_identity.sql`, local Supabase config, pgTAP 22 assertions; SEC-14–19. Hosted project remains untested. |
| ARC-03 | Modular monolith; no always-running app server | 1, 8 | React static client + Edge Functions; Render Static Site Blueprint. Local Edge Functions serve only for tests, not as deployed persistent server. |
| ARC-04 | Edge Functions/narrow DB operations own privileged lifecycle and finance | 1–8 | `member-api`, `bootstrap-admin`, service-role-only SQL RPCs; local integration SEC-14–19. Finance functions remain planned. |
| ARC-05 | Optional local Python availability collection; authenticated reviewed import | 5 | EXP-07 |
| ARC-06 | Full platform scope preserved; no poll-only public launch | 1–8 | Phase 8 scope checklist |
| AUTH-01 | Invitation-only verified-email identity | 1 | Implemented `member-api` invitation + `complete_profile`, public signup disabled in local config; SEC-14; local integration pass. |
| AUTH-02 | Member profile, contact and account lifecycle | 1 | `member_profiles`, `member_private_contacts`, `member_payment_methods`; component tests and SEC-18/19. |
| AUTH-03 | Admin/member roles changed only through trusted audited path | 1 | `phase1_update_membership`, last-admin SQL guard, audit event; SEC-15/18; pgTAP + integration pass. |
| AUTH-04 | Deactivation preserves financial and attendance history | 1, 7 | SEC-13, OPS-10 |
| SEC-01 | Visitors cannot see member rosters, private profiles, finance or payment IDs | 1–8 | Phase 1: no anon profile grant, private identifier schema not exposed, direct identifier request rejected; pgTAP + integration SEC-17/18. Future trip/finance tables remain planned. |
| SEC-02 | Every table/view/function has explicit grant and RLS or is private/non-exposed | 1–8 | Phase 1 migration explicit grants/RLS and RPC execute revocation; pgTAP 22 assertions. Future table families await their phase. |
| SEC-03 | Payment identifiers limited to exact obligated payer, recipient, and audited admin exception; no direct Data API identifier read | 1, 3, 6 | Phase 1 encrypts identifier before storage and exposes no decrypt endpoint; direct Data API denied and safe response verified (SEC-17). Exact payer/recipient disclosures remain planned for Phase 6. |
| SEC-04 | Secret/service-role credentials never enter frontend | 1, 8 | Phase 1 `npm run security:scan` passes on production bundle; Render receives only public VITE variables. Hosted environment review remains future launch evidence. |
| SEC-05 | User metadata/request JSON cannot authorize admin or cross-member actions | 1–8 | Phase 1 verifies Auth user server-side, reads role/status from PostgreSQL and denies member admin action; SEC-18/19. Future resource-specific checks remain planned. |
| SEC-06 | Private receipt storage and three-month deletion | 5, 7 | SEC-10, EXP-06, OPS-08 |
| TRIP-01 | Seven campsites and round-robin monthly rotation | 2 | Implemented migration seeds seven sites; monthly generator preserves suggested/selected site and next-position cursor. Tests CAL-01/02 and DB-01. |
| TRIP-02 | Rolling 12-month calendar, no duplicate month, catch-up | 2, 7 | Implemented `phase2_generate_calendar` + monthly Cron and admin catch-up; unique `month_key`, repeat-safe. Local tests CAL-01/03; hosted Cron/monitoring remains unverified (P2-R12). |
| TRIP-03 | Friday–Sunday default; admin can edit dates/timezone | 2 | Dates and timezone/deadline are configurable per poll; timezone is required before open. Admin must enter actual dates; no assumed weekend dates. Tests CAL-04/05, P2-UI-04. Contractual cabin-buffer deadline remains Phase 3 because cabin booking data is absent. |
| TRIP-03A | Editing a saved deadline preserves the trip timezone and deadline instant | 2 | `pollDeadlineAt` is formatted to the immutable per-trip timezone snapshot before populating date/time inputs; the trusted operation keeps that snapshot on later edits even if the club default changes. Tests CAL-06/P2-UI-10/DB-08. |
| TRIP-04 | Binary Coming / Not coming RSVP | 2 | Implemented with optimistic versions and append-only `trip_rsvp_events`; members see own answer and aggregate Coming count. Tests RSVP-01/02/04, DB-01, P2-UI-01/02. |
| TRIP-05 | Default threshold four and structured trip override; count basis and payer-coverage treatment are owner-selected and unset until approval | 2, 3 | Planning minimum (default 4) is configurable and stored, but is not evaluated; `minimum_basis` remains NULL and has no API write path. No confirmation/cancellation/contribution automation. OD-01/02 pending. Tests DB-03, CAL-04. |
| TRIP-06 | Cutoff is earlier of 35 days pre-trip or contract deadline minus default 5-day buffer | 2, 3 | Phase 2 supports configurable poll deadline and lead-day default, but does not calculate the cabin-contract deadline formula because cabin booking state is not implemented. Formula remains gated for Phase 3. Tests CAL-05 cover configured poll deadline only. |
| TRIP-07 | Below-minimum at cutoff automatically cancels and emails members/admins; any money already received is unresolved | 3 | Not implemented by design in Phase 2. OD-01/02/06/07 pending; polls only close at cutoff and create no trip decision or money fact. Phase 3 tests remain planned. |
| TRIP-08 | Post-confirmation withdrawal request follows the owner-selected effectiveness rule; if effective attendance falls below minimum, prompt admin decision, never auto-cancel | 3 | Phase 2 stores a post-deadline request separately and leaves Coming unchanged; no confirmed-trip or effective-withdrawal function. OD-03 pending. Tests RSVP-05, API-04, P2-UI-07 cover interest-poll request only. |
| TRIP-09 | Admin late entries; cancelled trip reinstatement needs cabin verification | 2, 3 | Phase 2 `admin_record_interest` is implemented for admin-managed poll responses; Coming requires exact member acknowledgment. No cancelled state/reinstatement exists. Tests RSVP-03, API-03. |
| TRIP-10 | Actual attendee roster is recorded for expense allocation | 3, 5 | Attendance reconciliation tests |
| TRIP-11 | Cancellation does not silently change rotation position | 2 | TRIP-01 |
| CAB-01 | Separate club trip and cabin reservation states; track reference, contract date, request, confirmation, refund/credit | 3 | CAB-11 |
| CAB-02 | Admin assigns cabin payment recipient and usable method before signup | 3 | CAB-01 |
| CAB-03 | Each attendee has $50 commitment; timing depends on owner-approved minimum basis (`received_contribution` before cutoff or `coming_rsvp` after confirmation); late additions get request | 3 | TRIP-03A/B, CAB-02/03 |
| CAB-04 | Member withdrawal after confirmation does not erase $50 obligation; paid amount is non-refundable on member withdrawal | 3, 6 | TRIP-10, CAB-05/08 |
| CAB-05 | Recipient/admin confirms actual external receipt; email does not prove payment | 3, 6 | CAB-03/04, OPS-01 |
| CAB-06 | Vendor expense, contribution payment events and settlement transfers are distinct, linked facts and never double-counted; payer coverage marker is non-posting | 6 | CAB-06/07/08, FIN-09/15/16 |
| CAB-07 | For pre-confirmation cancellation or withdrawal, `coming_rsvp` has no $50 due before confirmation; under `received_contribution`, receipts may already exist and remain unresolved pending owner policy | 3 | CAB-09, CAB-13, TRIP-04A, TRIP-04B, TRIP-10, TRIP-14 |
| CAB-08 | Club cancellation after confirmation has explicit refund/credit decision and no auto-forfeit/refund | 3, 6 | CAB-10; approved policy gate |
| CAB-09 | Contribution receipts above actual cabin cost are not silently reallocated | 6 | CAB-08A/B, FIN-09; owner policy gate |
| RULE-01 | General rules, trip-only rules, and linked trip overrides | 2 | Implemented immutable general/trip versions and expiring override linked to exact current general version; tests RULE-TS-01/02, DB-04/05, API-05, P2-UI-05. |
| RULE-02 | Behavior uses typed structured values, not prose parsing | 2, 6 | Implemented validated JSON values stored separately from human-readable text; Phase 2 does not execute financial policies. Tests RULE-TS-01/03 and DB-04. |
| RULE-03 | Trip rule operational expiry with immutable applicable policy snapshot retained 12 months | 2, 6, 7 | Expiry/effective-window resolution is refreshed for open polls on authenticated calendar/Constitution reads and before new Coming entries. Identical hashes reuse the current bundle; effective/expiry boundaries create a new immutable version. Prior accepted bundles remain immutable; cleanup/12-month retention worker is not implemented. Tests DB-07, API-06; retention remains future OPS-08. |
| RULE-03A | A current Coming response does not require re-acknowledgment when rules later change or expire | 2, 7 | Current RSVP remains pinned to its exact accepted bundle; the new bundle is used only for a new/changed-to-Coming response. Existing test DB-06/RULE-05 remains valid. |
| RULE-04 | Coming signup requires acknowledgment of complete applicable rule bundle | 2 | Implemented atomic exact-current bundle check + acknowledgment + RSVP. Tests RSVP-01/02, DB-06, API-02, P2-UI-01/02. |
| RULE-05 | Acknowledgment records exact version/hash/time and remains unchanged after later rule edits; no re-ack | 2, 7 | Implemented append-only member/trip/bundle/hash/statement/time record; existing Coming RSVP retains old pointer after later publication. Tests RSVP-06, DB-06, P2-UI-06. |
| RULE-06 | Effective rule snapshot at trip confirmation may be distinct from prior signup acknowledgment | 2, 3 | Confirmation-time snapshot is not implemented; signup acknowledgment is preserved. Phase 3 gate, no confirmation path. |
| VEH-01 | Driver earns 76 cents/mile when carpool minimum 3 including driver | 4, 5, 6 | LOG-04, financial unit tests |
| VEH-02 | $5 per participant car-wash contribution included in travel budget | 5, 6 | Expense/policy tests |
| VEH-03 | Van guidance: 4 normally one; 5 one if fits otherwise exception; up to 8 aim for 2, 3 an exception | 4 | Transport validation tests |
| VEH-04 | Driving counts toward workload | 4 | LOG-04 / workload test |
| PREF-01 | Common packing checklist + trip-specific admin additions | 4 | Signup component and persistence tests |
| PREF-02 | Coffee/tea choice separately Sat/Sun, includes neither/no preference | 4 | Preference validation test |
| PREF-03 | Vegetarian/non-vegetarian default and per-meal overrides/not eating | 4 | LOG-01 |
| PREF-04 | Meal preferences freeze at admin shopping deadline | 4 | LOG-01 |
| RESP-01 | Responsibilities for Fri night, Sat morning, Sat night, Sun morning; first-come assignment | 4 | LOG-02/03 |
| RESP-02 | Admin can add tasks such as activity planning; Sunday cleanup capacity may be weighted | 4 | Task CRUD/workload tests |
| RESP-03 | Full responsibility slot does not block RSVP; Needs assignment and admin resolution | 4 | LOG-02 |
| LODGE-01 | Bed shortage triggers server-side random draw for admin-entered count | 4 | LOG-05 |
| LODGE-02 | Lottery records roster/hash, result, actor/time, algorithm/source, rerun reason and mutual exchanges; seed enables replay but is not proof of unbiasedness | 4 | LOG-05/06/07 |
| EXP-01 | Expense has payer, date, description, category, amount, receipt and participants | 5 | EXP-01/03/06 |
| EXP-02 | $50 shared food target is upfront nonalcoholic; targets are soft warnings | 5 | Expense target and warning tests |
| EXP-03 | Alcohol only split among explicit opt-ins; no non-drinker charge by majority | 5 | EXP-04 |
| EXP-04 | Member allocations are proposals; all-attendee split requires admin approval | 5 | EXP-04 |
| EXP-05 | Admin review, expense deadline, lock, audited reopen | 5 | EXP-05 |
| EXP-06 | Allocation sums exact and supports equal/custom/percent/individual/reimbursement | 5, 6 | EXP-02/03, FIN-01/02 |
| FIN-01 | Aggregate different expense subsets globally before optimizing transfers | 6 | FIN-07 |
| FIN-02 | Integer cents, deterministic remainder allocation, financial invariants | 6 | FIN-01/02/14 |
| FIN-03 | Minimum transfer count exact at owner-approved bound; currently recommended ≤12, with deterministic fallback above; operation count is pinned | 6 | FIN-03–06; owner decision gate |
| FIN-04 | Exact solution's primary objective is fewest transfers; method compatibility is secondary only | 6 | FIN-04/06; compatibility approval gate |
| FIN-05 | Payer may be excluded from expense subset; payer credit remains correct | 6 | FIN-08 |
| FIN-06 | Only admin finalizes; immutable version and actor/time/hash recorded | 6 | FIN-12/13 |
| FIN-07 | Partial sent/received amounts, disputes, and settlement correction after payment | 6 | FIN-10/11 |
| FIN-08 | Versioned adjustment preserves old transfers/events and avoids duplicate request | 6 | FIN-11 |
| FIN-09 | Immutable financial facts and payment events; status fields are rebuildable projections | 1, 6 | FIN-18; catalog projection coverage |
| FIN-10 | Scoped idempotency with hash mismatch, replay window, non-reexecution after expiry and concurrency lock | 1, 3, 6 | FIN-19 and API contract tests |
| FIN-11 | Exact worked-case reconciliation: 4/$240/3 receipts; 8/$250/8 commitments; member withdrawal; club cancellation; partial correction | 6 | FIN-15–18, FIN-11; independent accounting oracle |
| PAY-01 | App never initiates money transfer | 1, 3, 6 | API/security contract review |
| PAY-02 | Transfer instructions show involved parties, amount, method, reference and safety warning | 6 | Instruction integration test |
| PAY-03 | Payer marks sent; recipient/admin confirms received; four statuses tracked | 6 | Payment state tests |
| WA-01 | Admin manually creates WhatsApp group and restricted invite link is removed at completion | 3, 7 | RLS and retention tests |
| MEDIA-01 | No photo/video storage in app | 1, 8 | Storage bucket inventory audit |
| NOTIFY-01 | Transactional email, outbox, retries, idempotency, recipient-level status and admin escalation | 3, 7 | OPS-01–04 |
| OPS-01 | Supabase Cron operates independent of website traffic; deadline processing every five minutes, ≤10-minute due-work objective while reachable, external heartbeat/escalation | 3, 8 | OPS-04/05/11 |
| OPS-02 | Jobs catch up safely after downtime and missed deadlines are visible | 3, 8 | OPS-04/05 |
| OPS-03 | Supabase Free pause risk and manual cabin cancellation fallback | 3, 8 | OPS-05 |
| OPS-04 | Nightly off-site backup, proposed RPO 24h/RTO one business day; restore rehearsed | 8 | OPS-06/07 |
| OPS-05 | Backups separately cover app DB, Auth mapping, Storage objects, secrets/config and Cron | 8 | OPS-06/07 |
| OPS-06 | Named primary, backup administrator, export operator and owner escalation; cabin contract deadline has manual fallback | 3, 8 | OPS-11 and rehearsal record |
| OPS-07 | Every lifecycle state maps to source fact, projection, authorized transition, audit and notification | 1–8 | OPS-12; matrix completeness check |
| OPS-08 | Supabase Free inactivity, 500 MB database read-only threshold, Storage quota and undownloadable managed backups have independent alert/export fallback | 1, 8 | OPS-05/13; usage and restore exercise |
| RET-01 | Keep high-level location/date/attendee trip history | 7 | OPS-10/history test |
| RET-02 | Minimal ledger and effective policy snapshot 12 months after closure/resolution | 7 | OPS-08 |
| RET-03 | Sensitive payment identifiers and receipt files deleted after 3 months | 7 | SEC-10/OPS-08 |
| RET-04 | Operational trip data expires and cleanup is idempotent/auditable | 7 | OPS-08 |
| DEP-01 | Migrations/config versioned; separate environments; Render deployment/rollback accounted for | 1, 8 | G1, OPS-09 |
| DEP-02 | Complete certification before launch | 8 | G1–G6 report |

## Phase 1 executed evidence summary

| Evidence | Result | Requirements covered |
| --- | --- | --- |
| `npm run typecheck` | PASS | ARC-01, AUTH-02, UI-01 |
| `npm test` | PASS — 8 tests / 3 files | AUTH-02, UI-01 |
| `npm run test:db` | PASS — 22 pgTAP assertions | ARC-02, AUTH-03, SEC-01/02/05, SEC-15/16 |
| `npm run test:integration` | PASS | AUTH-01–03, SEC-01/03–05, SEC-14–19 |
| `npm run build` | PASS | ARC-01, SEC-04 |
| `npm run security:scan` | PASS | SEC-04 |
| Local Chrome smoke, 1440×900 and 390×844 | PASS; temporary Playwright only, no repo dependency | UI-01 |
| Render deploy / hosted Supabase staging | NOT RUN; explicitly outside Phase 1 authorization | ARC-01/02; G1 PASS WITH RISK |

Full command evidence, screenshots and limitations: [PHASE1_CERTIFICATION.md](PHASE1_CERTIFICATION.md).

## Phase 2 executed evidence summary

| Evidence | Result | Requirements covered |
| --- | --- | --- |
| `npm run typecheck` | PASS | Phase 1 and Phase 2 TypeScript contracts. |
| `npm test` | PASS — 26 tests / 6 files | CAL-01–06, RULE-TS-01–03, RSVP-01–06, P2-UI-01–10; member/admin journeys, timezone-safe deadline editing, campsite management, late interest, exact rule version, poll settings, overrides, pending withdrawal. |
| `npm run test:db` | PASS — 59 pgTAP assertions across Phase 1 and Phase 2 SQL tests | DB-01–08; calendar uniqueness/rotation, RLS and grants, poll configuration/close, immutable rules and acknowledgments, effective/expiry boundaries, stale-bundle rejection, and timezone snapshot preservation. |
| `npm run test:integration` | PASS — Phase 1 local Auth/Edge/RLS/security regression | Existing SEC-14–19 and invitation/payment-identifier boundary evidence preserved. |
| `npm run test:phase2-integration` | PASS — synthetic local member/admin and Edge Function integration | API-01–06, RSVP-01–06; authorization, idempotency, refreshed calendar/Constitution reads, direct Data API bundle denial, admin site/rule actions, exact acknowledgment, poll close and withdrawal request. |
| `npm run build` | PASS — Vite production bundle generated | ARC-01, Phase 2 UI compile/bundle. |
| `npm run security:scan` | PASS — no privileged credentials/payment identifiers found in frontend bundle | SEC-03/04. |
| Render or hosted Supabase deploy | NOT RUN; not authorized | No production deployment or real-member onboarding. |
| Hosted Cron/email/backup/recovery | NOT RUN | Remains operational risk P2-R01/P2-R04/P2-R12. |

The final local command sequence was `npm run verify`, which executes the commands above in order. See [PHASE2_CERTIFICATION.md](PHASE2_CERTIFICATION.md) for environment, limitations, risk disposition and owner gates.

## 2. Evidence ownership

- Phase owner records test job URL/commit and the exact requirements covered.
- Security phase reviewer signs off every table and function row in SEC-07/08.
- Finance reviewer signs off solver oracle, cabin advance/cancellation tests and finalization invariants.
- Operations owner signs backup export, identity restore, Storage restore, paused-project catch-up, and manual cabin calendar exercises.
- Owner decision records link the approved policy text to the relevant gate; no decision is implied by a passing test.
