# Requirements Traceability Matrix

**Source of truth:** [Conditionally approved design](superpowers/specs/2026-10-08-camping-club-platform-design.md). A conflict is not an owner decision; unresolved alternatives remain gated in the [Consistency Remediation Report](CONSISTENCY_REMEDIATION_REPORT.md) and tracked in the [Owner Decision Record](OWNER_DECISIONS.md).
**Purpose:** Every requirement has an implementation phase, test evidence and launch gate. “Test IDs” refer to [TEST_STRATEGY.md](TEST_STRATEGY.md).

| ID | Requirement | Phase | Planned evidence / tests |
| --- | --- | --- | --- |
| ARC-01 | React + TypeScript + Vite on Render Static Site; no persistent Render filesystem dependency | 1, 8 | G1, deployment smoke, Render rollback rehearsal |
| ARC-02 | Supabase Auth + PostgreSQL + RLS are production identity and data store | 1–8 | SEC-01–10, G1/G2 |
| ARC-03 | Modular monolith; no always-running app server | 1, 8 | Deployment topology review, G1 |
| ARC-04 | Edge Functions/narrow DB operations own privileged lifecycle and finance | 1–8 | API contract tests, SEC-05/06/08, G2 |
| ARC-05 | Optional local Python availability collection; authenticated reviewed import | 5 | EXP-07 |
| ARC-06 | Full platform scope preserved; no poll-only public launch | 1–8 | Phase 8 scope checklist |
| AUTH-01 | Invitation-only verified-email identity | 1 | SEC-04, invite journey |
| AUTH-02 | Member profile, contact and account lifecycle | 1 | SEC-03/04/13 |
| AUTH-03 | Admin/member roles changed only through trusted audited path | 1 | SEC-05/06 |
| AUTH-04 | Deactivation preserves financial and attendance history | 1, 7 | SEC-13, OPS-10 |
| SEC-01 | Visitors cannot see member rosters, private profiles, finance or payment IDs | 1–8 | SEC-01/02/09 |
| SEC-02 | Every table/view/function has explicit grant and RLS or is private/non-exposed | 1–8 | SEC-07/08 and certification matrix |
| SEC-03 | Payment identifiers limited to exact obligated payer, recipient, and audited admin exception; no direct Data API identifier read | 1, 3, 6 | SEC-09/11/12; private schema/grants tests |
| SEC-04 | Secret/service-role credentials never enter frontend | 1, 8 | SEC-08 build scan, deployment config review |
| SEC-05 | User metadata/request JSON cannot authorize admin or cross-member actions | 1–8 | SEC-05/06 |
| SEC-06 | Private receipt storage and three-month deletion | 5, 7 | SEC-10, EXP-06, OPS-08 |
| TRIP-01 | Seven campsites and round-robin monthly rotation | 2 | TRIP-01 |
| TRIP-02 | Rolling 12-month calendar, no duplicate month, catch-up | 2, 7 | TRIP-01 |
| TRIP-03 | Friday–Sunday default; administrator-managed club timezone is an IANA identifier (`America/Los_Angeles` as approved 2026-10-08); trip dates and deadlines use that zone without hardcoded offsets; a timezone change that would alter existing deadlines requires administrator confirmation and an audit event | 2 | TRIP-03, PH2-POLL-03/04, timezone/DST integration tests |
| TRIP-04 | Binary Coming / Not coming RSVP | 2 | TRIP-09 |
| TRIP-05 | Default threshold four and structured trip override; count basis and payer-coverage treatment are owner-selected and unset until approval | 2, 3 | TRIP-03A/B/C, TRIP-04A/B/C |
| TRIP-06 | Cutoff is earlier of 35 days pre-trip or contract deadline minus default 5-day buffer | 2, 3 | TRIP-02 |
| TRIP-07 | Below-minimum at cutoff automatically cancels and emails members/admins; any money already received is unresolved | 3 | TRIP-04/05/14, CAB-09/13, OPS-03 |
| TRIP-08 | Post-confirmation withdrawal request follows the owner-selected effectiveness rule; if effective attendance falls below minimum, prompt admin decision, never auto-cancel | 3 | TRIP-10 |
| TRIP-09 | Admin late entries; cancelled trip reinstatement needs cabin verification | 2, 3 | TRIP-11/12 |
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
| RULE-01 | General rules, trip-only rules, and linked trip overrides | 2 | Rule CRUD/version tests |
| RULE-02 | Behavior uses typed structured values, not prose parsing | 2, 6 | Rule validation and policy engine tests |
| RULE-03 | Trip rule operational expiry with immutable applicable policy snapshot retained 12 months | 2, 6, 7 | Snapshot hash and OPS-08 |
| RULE-04 | Coming signup requires acknowledgment of complete applicable rule bundle | 2 | TRIP-06/07 |
| RULE-05 | Acknowledgment records exact version/hash/time and remains unchanged after later rule edits; no re-ack | 2, 7 | TRIP-07/08 |
| RULE-06 | Effective rule snapshot at trip confirmation may be distinct from prior signup acknowledgment | 2, 3 | TRIP-08 |
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
| DEP-03 | Phase 2 poll save is verified end to end against an identified isolated development/staging Supabase project; hosted frontend, migrations, Edge Functions, environment allowlist, grants/RLS and API connectivity are evidenced before certification | 2 | PH2-POLL-01–10; `docs/PHASE2_CERTIFICATION.md` |

## 2. Evidence ownership

- Phase owner records test job URL/commit and the exact requirements covered.
- Security phase reviewer signs off every table and function row in SEC-07/08.
- Finance reviewer signs off solver oracle, cabin advance/cancellation tests and finalization invariants.
- Operations owner signs backup export, identity restore, Storage restore, paused-project catch-up, and manual cabin calendar exercises.
- Owner decision records link the approved policy text to the relevant gate; no decision is implied by a passing test.
