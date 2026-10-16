# Daily responsibility planner QA — 2026-10-16

The owner approved the bounded per-date checkbox plan in chat. Scope and requirement IDs RESP-01–03, SEC-02/05 and DEP-03 are recorded in [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md#owner-approved-daily-responsibility-planning--2026-10-16). Work is on `feature/per-date-responsibilities`. Production and remote main remain unchanged.

## Resulting behavior

- Every actual date from event start through end has a checklist of active master responsibilities. A complete plan requires at least one selection per date; event creation and RSVP remain available independently.
- No weekday/title preset is generated. New duties inherit master weight/capacity and use a `daily` time block without implied simultaneous scheduling. Specific legacy timed slots retain their overlap checks.
- Existing enabled duties appear selected. Keeping them preserves their identities, capacity/weight overrides, repeated timed duties and assignments. Existing retired selections can be retained, but retired masters cannot be newly selected elsewhere.
- Daily totals show selected task weight and capacity-weighted volunteer workload. Saving refreshes an already-open Tasks & Meals tab immediately and survives a full browser reload.
- Unchecking a claimed duty requires explicit confirmation. Removal soft-disables the duty; assignment history remains. Inactive duties and disabled slots are excluded from daily and legacy progress, including calendar/details badges. Re-enabling a retained duty can restore its assignments.

## Backend and security

`20261016205101_daily_responsibility_plan.sql` adds the daily block, retires preset generation and introduces an atomic plan-save RPC with active-admin validation, exact date coverage, valid templates, trip version, trip/duty row locks, audit and Edge Function idempotency. New/changed RPCs are service-only SECURITY INVOKER. No table or financial policy is added.

A confirmed P1 legacy bypass also allowed direct authenticated RPC calls to impersonate a supplied administrator/member ID. Actual `authenticated`-role tests reproduced unauthorized duty updates and drops. `20261016214035_responsibility_rpc_boundary.sql` makes the remaining ten responsibility mutations service-only SECURITY INVOKER. Existing browser operations continue through `trip-api`, which resolves the current active actor. The acceptance journey probes every signature with a real member JWT and verifies function-level permission denial; trusted API configuration, assignment/reassignment, dropping and driver-credit operations are independently checked in PostgreSQL.

The official Supabase [function documentation](https://supabase.com/docs/guides/database/functions), [migration documentation](https://supabase.com/docs/guides/deployment/database-migrations), and [changelog](https://supabase.com/changelog) were checked before implementation. Architecture, secrets, financial terms and retention rules remain unchanged.

## Verification evidence

| Check | Recorded result |
| --- | --- |
| Baseline frontend tests | 184 passed before this work |
| Final `npm test` | Shared helper checks and 186 frontend tests passed |
| Final `npm run test:db` | Clean reset/replay; 363 assertions across 17 files, including 27 planner/security checks, passed |
| `npm run test:phase2-integration` | Calendar, version/idempotency, admin denial, RSVP/rules, RLS and policy checks passed |
| Type checking, build, bundle credential scan | Passed; existing bundle-size advisory remains |
| Hosted staging planner journey | Desktop, Android and iPhone passed across focused runs; final iPhone layout run passed in 1.3 minutes |
| Hosted staging security follow-up | Desktop passed in 1.7 minutes, including all forged-actor denials and legitimate API persistence checks |
| Final complete local browser suite | 48 passed in 11.9 minutes (16 per browser); workers 1; zero failed, skipped or flaky cases |
| Independent review | Legacy-progress and actor-spoofing findings fixed and re-reviewed; no remaining actionable findings |

`daily-responsibility-plan.spec.ts` verifies four actual weekday dates and a one-day event, realistic names with spaces/parentheses/hyphens/query strings, PostgreSQL readback, immediate task-list refresh, full reload, multiple untimed member claims, removal confirmation/history, mobile overflow and touch targets. The complete suite also covers the prior workload and event/access maintenance flows.

Regressions were observed failing before their fixes: absent per-date choices, false daily overlap, inactive duties satisfying legacy quotas, forged actors through legacy RPCs and stale task-list refresh. iPhone diagnostics identified a 9px page overflow caused by roster checkbox sizing and long names; fixed dimensions/wrapping resolved it. Duty-manager controls also wrap with minimum 44px button height and 44px capacity-stepper width. Failure screenshots, videos, console logs and traces were used for diagnosis. Earlier full-suite attempts were deliberately interrupted to include discovered fixes before final certification.

## QA environment and release limits

Hosted QA uses local Vite with isolated `camping-club-staging` (`rwmizunhxszjvcsaqkre`), as allowed by the staging setup plan. Both new migrations applied through normal forward migration after dry-run; no reset, history repair or secret changes were used. Only `trip-api` was redeployed with the explicit import map. All fixtures are synthetic; trips are archived, templates retired and accounts disabled afterward. Production is excluded from test writes. There is no newly published public frontend preview.

Hosted sessions use real password JWTs because there is no local mail sink in that project; local acceptance retains OTP/mail-sink login. These checks do not certify production email delivery. Local Auth logs show a few seconds of clock skew, and rapid iPhone admin-route navigation can log the pre-existing uncaught constitution/calendar request rejection; those diagnostics are retained without claiming a broader platform fix. A physical-iPhone smoke check has not been performed.

Production release requires both new migrations, the updated `trip-api`, and the frontend deployment. This QA work does not publish that release.

Final `npm run test:e2e` exited 0 on the complete final code and both migrations. Desktop Chromium, iPhone Mobile WebKit and Android Mobile Chromium each passed all 16 cases. The planner journey recorded zero console error lines on all three browsers. `git diff --check` passed. The implementation remains on its local QA branch, ready for a separate production release decision.
