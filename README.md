# Private Camping Club Platform

The full private club coordination platform is governed by the approved design and phased implementation plan. Phase 1 establishes the repository, invitation-only identity, member profiles, protected payment preferences, initial RLS, and Render Static Site configuration. Trip, cancellation, contribution, and settlement features remain deferred to their approved phases; no unresolved owner policy has been selected.

## Current authorization

Phase 1 implementation is complete pending owner review of [the certification report](docs/PHASE1_CERTIFICATION.md). Do not start Phase 2, deploy to production, configure production secrets, or onboard real members until separately authorized.

## Technology

- React, TypeScript, and Vite in `frontend/`
- Render Static Site using `render.yaml`
- Supabase Auth, PostgreSQL, RLS, and Edge Functions
- Supabase CLI local stack and pgTAP database tests
- No persistent application server, in-app money movement, or trip media storage

## Local development

Requirements: Node.js 22.12 or newer, npm, Docker Desktop, and `psql` for the integration suite. The Supabase CLI is pinned in the root package manifest.

```sh
npm ci
npm --prefix frontend ci
npx supabase start
```

Copy `frontend/.env.example` to `frontend/.env.local`. Set only the local `API_URL` and `PUBLISHABLE_KEY` values shown by `npx supabase status`; never put a Supabase secret/service-role key in a `VITE_` variable. Then run:

```sh
npm run dev
```

Supabase local email is captured by its local mail sink. Public Auth signup remains disabled; use the one-time local bootstrap token created by the integration harness or a trusted local test fixture.

## Verification

```sh
npm run typecheck
npm test
npm run test:db
npm run test:integration
npm run build
npm run security:scan
```

`test:integration` resets only the local Supabase database, creates synthetic Auth users, exercises invitation/bootstrap/profile/admin/RLS/idempotency boundaries, and removes its user fixtures. It requires the local Supabase stack to be running. It does not contact a hosted Supabase project or Render.

## Secrets and deployment

The Render Blueprint builds `frontend/` and receives only `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. Edge Function secrets and their rotation notes are listed in `supabase/functions/.env.example`; keep actual values in the Supabase secret store. The bootstrap token is one-time and must be removed after initial administrator activation.

No production deployment has been performed. Configure Render/Supabase only after owner authorization and completion of the applicable launch gates in [Operations and Recovery](docs/OPERATIONS_AND_RECOVERY.md).

## Architecture artifacts

- [Product vision](docs/PRODUCT_VISION.md)
- [Approved platform design](docs/superpowers/specs/2026-10-08-camping-club-platform-design.md)
- [Implementation plan](docs/IMPLEMENTATION_PLAN.md)
- [Owner decision register](docs/OWNER_DECISIONS.md)
- [Database schema](docs/DATABASE_SCHEMA.md)
- [API contracts](docs/API_CONTRACTS.md)
- [Security architecture](docs/SECURITY_ARCHITECTURE.md)
- [Test strategy](docs/TEST_STRATEGY.md)
- [Requirements traceability](docs/REQUIREMENTS_TRACEABILITY.md)
- [Phase 1 certification](docs/PHASE1_CERTIFICATION.md)
