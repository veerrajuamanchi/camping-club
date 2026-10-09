# Phase 2 Isolated Staging Setup Plan

**Status:** Conditionally approved for provisioning after dashboard verification of zero incremental cost; no external resources created.
**Purpose:** Safely run Phase 2 poll-save acceptance against synthetic data and verify the deployed migration/function interface without writing to production.
**Source:** GitHub `main` at `a5957fd723bbcb72aea3cd7a6c1a44788286f9e8`; work in a feature branch in the existing checkout folder. Do not create another worktree folder.

## Environment discovered

- The existing Supabase project `camping-club` (`kdxmwqxlhswcgwanlump`) is production according to the committed deployment certification.
- No isolated staging Supabase project or branch was found in local metadata.
- Render Blueprint names the Static Site `private-camping-club`; the deployed public host `camping-club.onrender.com` responds with HTTP 200, while `private-camping-club.onrender.com` responds with HTTP 404. The Render dashboard service ID and canonical deployment URL are unavailable locally.
- Local Phase 1 worktree is stale and has dirty changes that regress the current poll fields/tests. Preserve these changes; do not commit or apply them over GitHub `main`.

## Proposed staging topology

1. Create one dedicated Supabase project named `camping-club-staging` under the existing club organization, from the latest committed migrations and function sources. Do not clone production data, Auth users, Storage objects, secrets, or payment information. If project creation would add a charge, require a separate cost approval first.
2. Apply all versioned migrations and deploy all required Edge Functions to staging. Store staging-only function secrets in Supabase; use synthetic HMAC/encryption values and a test email sink. Record migration list and function version/status as release evidence.
3. Seed only synthetic campsite/trip data and synthetic administrator/member Auth identities. The November poll fixture must have an unmistakable synthetic marker. Verify the expected synthetic rows by database readback before running Playwright.
4. Run the React/Vite app locally in the existing source checkout, with only the staging Supabase URL and publishable key in browser configuration. Keep service-role/secret keys and the staging database connection string server-side/test-runner-only. Run Playwright against that local app and staging API; independently query staging PostgreSQL after save/failure/reload.
5. Use the existing production Render Static Site only for read-only routing/build-asset smoke checks. Do not deploy the feature branch to production. A separate Render PR preview is optional and is not required for this plan; if requested, first verify its environment variables point to staging before opening the page. Render PR previews inherit service settings, so the database endpoint must be overridden before use.
6. Run the full Phase 1 and Phase 2 suites against local Supabase reset from migrations and synthetic data, then run the Playwright poll-save journey against staging. Capture save, reload, calendar, failed-save, idempotency, past-deadline, and member-denial evidence. Inspect grants and RLS separately from schema exposure and scan browser assets for privileged credentials.
7. After evidence is recorded, delete only the uniquely tagged synthetic staging fixture rows and synthetic Auth users. Retain the isolated staging project only for the approved period; do not copy any production data into it.

## Cost and isolation constraints

Supabase documents that each project has a dedicated Postgres instance and compute is billed hourly; actual incremental cost depends on the current organization plan, compute size, credits, and project quota. Those account details are not available in this workspace, so **do not create the project until the owner reviews the dashboard estimate**. [Supabase compute billing](https://supabase.com/docs/guides/platform/manage-your-usage/compute)

Supabase Branching can provide distinct environments with separate credentials and defaults to data-less branches, but that capability/account entitlement is unverified here. This plan proposes a separately seeded project to make the synthetic-only boundary explicit. [Supabase Branching](https://supabase.com/docs/guides/deployment/branching)

Render's current documentation states that a service PR preview copies its base service settings, so preview database variables must be changed to staging before use. PR previews of a free Static Site are documented as free; full Render Preview Environments require a Pro workspace plan or higher and are billed as provisioned resources. [Render service previews](https://render.com/docs/service-previews), [Render preview environments](https://render.com/docs/preview-environments)

## Cost gate before provisioning

The owner authorized creation of the dedicated Supabase staging project only if the dashboard confirms the organization can accommodate another Free project at zero incremental cost. Before creation, verify the current plan, project capacity, and explicit $0 estimate in the dashboard. If the dashboard shows any charge, upgrade requirement, or uncertainty, stop without creating resources and report the billing limitation. Do not upgrade plans, enable paid compute, or create Render resources under this authorization.

No external resource has been created. No production project was modified, and no November poll was inspected or changed.
