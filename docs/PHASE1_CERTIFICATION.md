# Phase 1 Certification — Repository Foundation, Identity, Profiles, and Render Skeleton

**Certification date:** October 8, 2026

**Authorized scope:** Phase 1 only

**Result:** **PASS WITH RISK**
**Production deployment / real-member onboarding:** Not performed; not authorized.

## Scope delivered

- React, TypeScript, Vite shell with sign-in, invitation acceptance, member profile, payment preference, and admin-member route boundary.
- Supabase Auth local configuration with public signup disabled, verified-email requirement, admin-issued invitations, and a guarded one-time first-admin bootstrap.
- PostgreSQL migration for member profiles, private contacts, safe payment-method metadata, encrypted private identifiers, invitations, append-only audit, public settings, bootstrap control, and durable idempotency records.
- Explicit table grants, RLS policies, service-role-only trusted RPCs, last-active-admin protection, safe error envelopes, request correlation, CORS allowlist, and Render Static Site Blueprint.
- Unit, pgTAP, local Edge/API integration, client bundle scan, and local browser smoke evidence below.

Phase 1 adds no trips, rules, RSVP, cabin money policy, expenses, settlement behavior, photo/video storage, or WhatsApp API. Owner decisions remain pending in [OWNER_DECISIONS.md](OWNER_DECISIONS.md).

## Certification findings

| Area | Result | Evidence / boundary |
| --- | --- | --- |
| Technology and repository | PASS | React + TypeScript + Vite; locked npm dependencies; modular static frontend; Render Blueprint targets Static Site. |
| Invitation and identity | PASS | Local Auth integration exercises bootstrap invite, verified invite profile completion, ordinary admin invite, and disabled public signup. Auth identity is resolved server-side. |
| Admin authorization | PASS | Admin actions read current database role/status; member action is denied; direct role update is denied; last active admin cannot be removed; membership change writes audit. |
| RLS and Data API | PASS | pgTAP checks grants, owner filtering, update-column boundary, private schema denial, RPC execute grants and idempotency. Integration checks another-member access and direct identifier endpoint denial. |
| Payment identifier handling | PASS | WebCrypto AES-256-GCM encrypts before database write. Integration verifies ciphertext/nonce/key version at rest, safe API response, safe method metadata, and no identifier field through public Data API. Client bundle scan found no privileged/payment key configuration. |
| Idempotency and audit | PASS | Same key/same request replays; changed request conflicts; concurrent claim reports in-progress; expired replay is rejected; admin mutations are audited with request-key deduplication. |
| Local browser shell | PASS | Local Chrome/Playwright smoke at 1440×900 and 390×844: correct page title, sign-in heading and fields, input interaction, no horizontal overflow, no console/page errors. Screenshots: `/tmp/camping-club-phase1-desktop.png`, `/tmp/camping-club-phase1-mobile.png`. Temporary Playwright tooling was outside repository dependencies. |
| Render / hosted Supabase | PASS WITH RISK | Configuration is implemented, but no hosted project, Render preview, SMTP, production secrets, migration application or deploy was exercised. This is intentionally outside authorization. |
| Invitation external side effect | PASS WITH RISK | Supabase Auth email creation and PostgreSQL invitation/audit persistence are separate services. An ambiguous provider/database failure can leave an unprofiled Auth identity; administrator recovery must reconcile Auth and the HMAC invitation row before retrying. |
| HMAC key rotation | PASS WITH RISK | Idempotency records persist a key version and use `v1`. Do not rotate that secret until multi-version lookup/retention is implemented and reviewed. |

## Executed local evidence

Commands are run from the repository root. The integration script resets only the local Supabase database and creates synthetic users.

| Command | Result |
| --- | --- |
| `npm run typecheck` | Pass |
| `npm test` | Pass — 8 component tests across 3 files |
| `npx supabase db reset --local` | Pass — migration applied from clean local database |
| `npm run test:db` | Pass — pgTAP RLS/idempotency suite |
| `npm run test:integration` | Pass — bootstrap, invited profile, Auth/JWT, RLS/Data API, encrypted identifier, admin/audit, CORS and idempotency flows |
| `npm run build` | Pass — Vite production bundle generated |
| `npm run security:scan` | Pass — no privileged credentials or payment-key material in client artifacts |
| Local Chrome smoke (temporary Playwright) | Pass — desktop/mobile sign-in shell and one input interaction; screenshots listed above |

The exact test counts and current outputs are also recorded in [TEST_STRATEGY.md](TEST_STRATEGY.md) and the Phase 1 entries in [REQUIREMENTS_TRACEABILITY.md](REQUIREMENTS_TRACEABILITY.md).

## Outstanding risks and limits

- The Supabase project and Render service are not linked, and production deployment was not attempted. Production Auth URL allowlists, Render environment values, Edge Function secrets, CORS origin, SMTP sender/delivery, migration rollout and rollback still require an isolated staging rehearsal.
- Supabase Auth invitation email and SQL invitation persistence are not a distributed transaction. If a call times out after Auth creates the identity but before the invitation row is stored, an administrator must reconcile the unprofiled Auth identity before retrying. Do not delete an ambiguous Auth identity automatically.
- Idempotency uses the configured `v1` HMAC key. Keep it stable; a key rotation requires old-key lookup support through tombstone retention.
- Local tests certify this migration and local Auth/RLS behavior; they do not prove hosted provider behavior, backups, Render deployment, email delivery, or Phase 2–8 functionality.
- No owner policy was selected for the minimum-four basis, post-confirmation withdrawal effect, cabin verification gate, cabin contribution cancellation/excess handling, settlement optimizer bound, payment compatibility, or lottery/recovery decisions.

## Phase 2 readiness

**Owner reviewed and conditionally approved this certification as PASS WITH RISK, then authorized Phase 2 on October 8, 2026.** Phase 2 work proceeds with formal trip-registration and lifecycle transitions failing closed until OD-01, OD-03 and OD-04 are resolved. OD-02 is additionally required only if OD-01 selects received contributions. Phase 3/6 financial disposition and optimizer gates remain governed by the owner decision register.
