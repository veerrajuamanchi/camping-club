# Event maintenance verification — 2026-10-15

Scope authorized by the owner's request to resume five fixes. Requirements: AUTH-02/04, TRIP-04/08/09, RESP-03. Local implementation only; hosted deployment is not performed by this maintenance run.

Changes:
- All logout paths navigate to `/signin`; the signed-out access message links there.
- Inactive/suspended membership removes upcoming Coming participation, active duties, and waitlist entries transactionally. The migration repairs already-disabled accounts. Past attendance, rule acknowledgments, audit history and all financial facts remain preserved.
- Tasks & Meals disambiguates the assignee FK from the releasing-member FK. This follows [Supabase's explicit foreign-key join syntax](https://supabase.com/docs/guides/database/joins-and-nesting); the official changelog was also checked before platform-specific changes.
- Member and admin RSVP changes remain available after poll cutoff/confirmation until the local trip end date. Cancelled/deleted/draft/ended events remain closed. Joining requires current personal rule acknowledgment and capacity checks. Withdrawal releases duties.
- Within-30-day member withdrawal displays the non-refundable $50 warning, potential cost burden, and administrator-coordinated replacement/external reimbursement option. It does not change financial allocation or automatically replace a member. OD-03 records the owner's immediate-withdrawal instruction; other decisions remain pending.
- Confirmed event details hide the minimum-participants display. Calendar cards wrap long titles, addresses and dates without stretching the mobile viewport.

Recorded verification:
- Regression tests failed before RSVP UI fixes: missing confirmed-event Not Going button; calendar cutoff disabled both choices.
- `npm test`: shared Node tests passed; 19 frontend files, 179 tests passed.
- `npm run typecheck`: exit 0.
- `npm run build`: exit 0. Existing bundle-size warning remains (approximately 609 kB JS).
- `npm run security:scan`: four built files scanned, no privileged credentials/payment key material found.
- `npm run test:db`: 15 files, 323 checks passed after migration replay.
- `npx supabase test db --local`: 15 files, 323 checks passed on the final schema. Maintenance transaction calls run as `service_role`.
- `node scripts/test-maintenance-backfill.mjs`: 18 transactional checks passed, including replay of the real migration against stale disabled-account fixtures, audit preservation and repeated-backfill idempotency.
- `npm run test:e2e`: all 42 tests passed in 8.9 minutes with `workers: 1` across Desktop Chromium, iPhone Mobile WebKit and Android Mobile Chromium. Each project passed the maintenance journey, PostgreSQL/reload assertions, both-role task reads, logout, member deactivation and mobile layout checks.
- Earlier runs detected missing late-signup bundles, duplicate synthetic fixture names, local Edge runtime HTTP 502, a Mobile WebKit task visibility timing failure, and calendar overflow with long titles. These were investigated before the final clean-database run; the corrected final suite passed every assertion. The development server still logged some request cancellations during route navigation; this does not certify production reliability.

Evidence command logs are captured locally under `/tmp/camping-maintenance-*.log`; Playwright writes `playwright-report/` and `test-results/`, including failure screenshot/video/trace and attached browser console logs. The maintenance journey uses real local PostgreSQL and checks RSVP values and full browser reloads. The final local database reset removes immutable synthetic fixture facts; no production data is used.

Limits: no production deployment, physical-iPhone smoke check, email delivery certification, full platform launch certification, or change to unresolved contribution disposition/settlement policies. Broader Phase 3 administrator notification and below-minimum lifecycle workflows remain subject to their existing gates.
