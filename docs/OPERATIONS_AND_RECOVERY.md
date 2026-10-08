# Operations and Recovery — Private Camping Club Platform

**Status:** Normative operational plan; service/plan details must be revalidated before launch.
**Related:** [Implementation Plan](IMPLEMENTATION_PLAN.md), [Database Schema](DATABASE_SCHEMA.md)

## 1. Runtime topology

- Render serves the React/Vite build as a Static Site over HTTPS. The site is stateless; no application records live in Render's filesystem.
- Supabase provides Auth, PostgreSQL, RLS, Edge Functions and Cron.
- User requests invoke authenticated Edge Functions or RLS-governed Data API reads.
- Supabase Cron independently runs lifecycle, outbox, schedule and retention work. No job waits for website traffic, an administrator's open browser, or the local Python utility.
- Independent monitoring observes scheduler heartbeat and sends an alert if it is stale. A monitor does not guarantee a paused Supabase project can execute work; manual cabin-deadline fallback remains required for the Free pilot.
- Local Python availability collection is optional and never required to confirm/cancel a trip.

## 2. Environments and Render deployment

### Environments

- Local: Supabase CLI local stack, seeded synthetic users/data, test email sink.
- Preview: Render pull-request preview or equivalent isolated build; separate Supabase development project/config and synthetic data only.
- Production: Render Static Site plus separate Supabase project, verified domains, production-only secrets.
- Do not point previews at production Supabase or expose production member/payment data.
- Render environment contains only the Supabase project URL and publishable key. No database password, service-role/secret key, SMTP key or payment identifier.
- Keep Supabase migrations, Edge Function source, Cron definitions, frontend lockfile and Render Blueprint/configuration in version control.

### Deployment sequence

1. Build with the locked Node toolchain and run lint, types, frontend tests, database tests and function contract tests in CI.
2. Apply migrations to local Supabase and reset from migrations + synthetic seed to prove clean installation.
3. Apply the same migration set to isolated staging/preview; execute smoke journeys and RLS suite.
4. Deploy compatible Edge Functions.
5. Apply production migration using the documented release gate and a fresh backup/export check.
6. Deploy Static Site artifact, verify HTTPS, SPA rewrite, Auth redirect URLs, CORS and public settings.
7. Run read-only smoke checks, deadline heartbeat, mail provider health and admin login.
8. Record release ID, migration version, operator, deployment time and rollback/forward-fix reference.

### Rollback

- Render rollback restores frontend artifacts/config only; it does not reverse PostgreSQL migrations.
- Prefer expand-migrate-contract: deploy backward-compatible nullable/new columns, deploy code, backfill, switch reads/writes, then remove old columns in a later reviewed migration.
- If frontend/function behavior is bad, roll back code to compatible previous build and disable automatic deploy during repair if needed.
- If a migration corrupts data, stop writes, preserve incident copy, restore/repair from backup, replay migrations, reconcile Auth identity mapping and resume only after invariants pass.
- Never run an unreviewed destructive rollback migration against production.

## 3. Supabase scheduled work

### Cadence

| Job | Cadence | Work | Catch-up behavior |
| --- | --- | --- | --- |
| process-trip-deadlines | Every 5 minutes | Find open trips with registration_cutoff <= now; lock each, count Coming, confirm/cancel, write events/outbox | Query all overdue unprocessed trips; never assume only the exact current minute |
| process-notification-outbox | Every 5 minutes (can co-run with deadline job) | Claim due messages, send, record attempt/status and retry | Lease-expired messages are reclaimable; idempotency key prevents duplicate business notices |
| independent scheduler heartbeat | Every 5 minutes | Record successful job run and alert monitor | Monitor checks last successful run externally; stale heartbeat creates admin alert |
| Free-tier quota monitor | Daily from independent scheduled workflow | Read current database and Storage usage; alert at 80% of verified plan quota and retain prior sample off-site | Does not rely on writes to Supabase; stale/missing sample alerts operators. Recheck thresholds against current plan before launch. |
| replenish rolling trip calendar | Daily | Fill missing 12-month month keys and preserve rotation | Unique month key + transaction-safe upsert |
| freeze meal preferences | Every 5 minutes | Freeze trip meals at admin-defined deadline | Catch-up freezes overdue preference set |
| cabin reservation escalation | Daily and at configured pre-deadline checkpoints | Alert admin unresolved cancellation request and contractual deadline | Show overdue unresolved bookings until explicit resolution |
| retention cleanup | Daily | Purge eligible receipts/identifiers and operational data; preserve required ledger | Idempotent delete with dry-run and recorded row/object counts |
| backup/export | Nightly | Encrypted off-site dump and integrity manifest | Alert on missing/stale backup; retry next scheduled run without overwriting last good backup |

All jobs have a stable job key, scheduled_for value, execution ID, start/finish/result counts, safe redacted error, and idempotency key. Use bounded batches and short transactions; do not hold row locks while calling an email provider. Claim rows, commit lease, call provider, then append attempt/update state.

### Service objectives and named responsibility

These are pilot operational service objectives, not provider guarantees. Populate actual names and contact channels before Phase 8; launch is blocked while a primary or backup is blank.

| Role | Named operator | Accountability / takeover |
| --- | --- | --- |
| Primary trip administrator | `TBD — owner must name before launch` | Owns each trip's booking record, contractual refund date, member notices, cutoff review, and provider cancellation confirmation. A trip record stores the assigned primary admin. |
| Backup trip administrator | `TBD — owner must name before launch` | Acknowledges primary alerts within 10 minutes; takes over if primary has not acknowledged within 5 minutes or is unavailable. |
| Backup/export operator | `TBD — owner must name before launch` | Verifies nightly off-site export, object/identity backup coverage, restore access and a quarterly restore rehearsal. Separate from the database service credentials. |
| Club owner escalation | `TBD — owner must name before launch` | Resolves no-acknowledgment at 30 minutes, policy questions and any decision requiring owner approval. |

`process-trip-deadlines` runs every 5 minutes. A due-trip decision should be durably processed within 10 minutes of its configured cutoff while Supabase is reachable. A separate monitor checks an independently hosted heartbeat at least every 15 minutes and pages the primary when no successful job is observed within 15 minutes; if no acknowledgment in 5 minutes, page backup; at 30 minutes, escalate to owner. These response windows require a real independent monitoring path and named on-call contacts before certification. Email provider acceptance is not proof the notice arrived; failed cancellation mail triggers alternate manual contact.

## 4. Free-tier operational risks and manual cabin fallback

Current Supabase documentation says Free projects may pause after seven days of insufficient user database activity; the current restore window is one year. Do not assume Cron calls count as qualifying activity or that an independent monitor can wake a paused database. Recheck both limits during launch review. Current Free database size quota enters read-only mode above 500 MB; sample usage externally and alert at a proposed 400 MB (80%) threshold, then recheck current quota. In read-only mode even internal monitoring writes may fail. Managed database backups are not downloadable on Free, so the club must create its own encrypted logical exports; database exports do not include Storage objects and require separate Auth identity mapping/recovery. The application retains only expense receipt objects (no trip photo/video library); check current Free Storage quota, enforce upload size/type limits, and alert before receipt retention can exhaust it.

For a trip with a contractual cancellation deadline:

1. Maintain a separate administrator-owned calendar entry for the calculated cutoff and actual provider refund deadline, independent of app notification state.
2. Admin reviews RSVP count and cabin availability at seven days before the calculated cutoff.
3. Primary admin performs a second count using the explicitly owner-approved `minimum_basis` and checks the actual reservation action at cutoff. If below minimum, manually apply the same approved trip transition and contact the provider immediately. If basis is missing or disputed, escalate to owner; do not guess or move money.
4. Record the provider cancellation request and confirmation in the app once service is available; if Supabase is paused, keep dated evidence outside the app and backfill it after recovery.
5. Do not rely solely on Cron for any cancellation deadline until paused-project recovery, independent monitor alerting and catch-up have been rehearsed.
6. If a deadline is at risk and no operator can verify/cancel the cabin, contact the backup then owner using the named response windows. The trip's separate cabin-cancellation task stays unresolved until provider evidence is recorded; club cancellation alone does not mark the reservation cancelled.

This manual check is a safety fallback, not a replacement for automated job monitoring.

## 5. Notifications and delivery operations

- Use a transactional provider selected after verifying domain authentication (SPF/DKIM/DMARC), free-tier limits, transactional use terms, delivery/bounce webhooks and data retention.
- Supabase Auth invitations/magic links and application notices may have different SMTP paths/limits; validate both.
- Outbox templates are versioned and have stable idempotency keys based on event + recipient + template version.
- Track queued, accepted, delivered, bounced, failed and retry-scheduled distinctly where provider offers evidence. “Accepted” is not equivalent to delivered or read.
- Retry transient timeout/5xx/429 failures with capped exponential backoff and jitter. Do not retry permanent invalid-recipient/4xx failures without correction.
- After configured attempts are exhausted, mark failed, alert administrators, and show recipient-level status. A human can correct address and retry with a new attempt linked to the original notice.
- Cabin payment instructions are sent at the timing selected by the approved minimum basis: before cutoff for `received_contribution`, after confirmation for `coming_rsvp`. Each message is member-specific and includes only that member's obligation, assigned payee, method/identifier and safety message. Never include payment identifiers in a group email.
- If provider is down, persist outbox and leave trip transition committed; alert admin through in-app status plus independent monitor channel. Do not roll back trip status because email failed.

## 6. Backup and restore plan

### Backup content and important exclusions

A logical database export is not a full Supabase project backup. Current Supabase CLI documentation says db dump excludes managed auth/storage schemas by default; database backups also do not contain Storage API objects. Explicitly cover these components:

| Component | Backup/recovery method |
| --- | --- |
| public/private application schema and rows | Nightly Supabase CLI logical schema/data export; encrypt before leaving trusted runner; off-site retention and manifest/hash. |
| Schema/migrations/functions/Cron definitions | Git repository, reviewed releases and local replay. No secrets in repository. |
| Stable member IDs and Auth mapping | Encrypted export of stable club member ID, auth user ID, verified email and account status via documented Auth admin/export path; validate restore/re-invite path. Member UUIDs remain stable even if Auth users are recreated. |
| Receipt objects | Separate encrypted export of unexpired private Storage objects + object metadata, or explicitly test a recoverable replacement/restore process. Database dump alone is insufficient. |
| Edge Function/API/email secrets | Secure secret manager/password manager and operator-controlled rotation/re-entry; never store in DB dump/GitHub artifacts in plaintext. |
| Render/Supabase project settings | Versioned nonsecret config plus secure settings inventory and post-restore checklist. |
| Scheduled jobs and external monitor config | Source-controlled definitions and secret references; recreate/verify after restore. |

Candidate $0 automation is a scheduled hosted CI workflow (for example, GitHub Actions) that creates encrypted exports and uploads to an owner-approved private artifact destination with finite retention. This choice is not certified until the owner approves the destination, current free quota, encryption/access controls, retention behavior, and a successful restore drill. Do not commit raw database exports or user data to the source repository. If no $0 destination can meet RPO 24 hours, either revise the objective with owner approval or accept a documented cost; do not claim the target is met.

### Proposed pilot recovery targets

- RPO: no more than 24 hours of application database changes.
- RTO: restore member operations within one business day.
- Nightly export, verified hash/size, last-success alert, and quarterly restore rehearsal.
- Keep backups encrypted, access-restricted and separate from production project credentials.
- Choose backup retention that is finite and documented. In-app deletion does not erase older backups; before a restore is returned to service, replay retention cleanup and recheck identifiers/receipts.

### Restore rehearsal

1. Create an isolated recovery Supabase project using source-controlled config and migrations.
2. Restore application schema/data from encrypted export without copying personal data into ordinary development.
3. Recreate/rebind Auth accounts using stable member IDs and verify account deactivation/security settings.
4. Restore eligible Storage receipts separately, verify bucket privacy and remove expired objects.
5. Reapply/review function secrets, auth URLs, mail settings, Cron jobs and monitoring credentials.
6. Run RLS allow/deny tests, settlement invariants, notification outbox state checks, retention cleanup dry-run and deadline catch-up.
7. Compare migration version, stable record counts, hashes and last successful backup time.
8. Record actual RPO/RTO, recovery gaps, operator and remediation items. Do not certify a restore path that has not been run.

## 7. Incident runbooks

### Supabase paused or unreachable

- Independent monitor alerts admin; check project dashboard/status without exposing credentials.
- Resume project through Supabase dashboard under current provider procedure.
- Confirm database and Edge Function health; inspect the last successful job heartbeat.
- Run deadline catch-up and outbox scan. Confirm idempotency before enabling retries.
- Check separate club calendar for trips inside cutoff/cancellation window and perform manual provider action if needed.
- Record outage window, missed events and recovery evidence.

### Deadline job missed

- Do not manually edit trip status in Table Editor.
- Invoke approved admin recovery operation to reprocess due trips, or wait for catch-up job if healthy.
- Review computed deadline, selected minimum basis, count evidence/qualifying receipts, cabin contract date, cancellation decision, notification recipients and idempotency event.
- Verify one business transition and one outbox item per intended recipient; manually contact members/provider if email failed.
- Log reason and outcome.

### Cabin cancellation not confirmed

- Admin sees unresolved booking alert and calendar reminder.
- Contact campsite/provider before deadline; record request date, person contacted and confirmation/reference.
- Follow up until explicit cancellation/refund/credit result.
- Do not mark reservation cancelled based only on club trip state or outbound email.
- If contributions already exist, mark reconciliation unresolved and follow the owner-approved policy; no automatic forfeiture/refund.

### Email provider outage/bounce

- Outbox remains durable; provider errors are recorded and retryable only when transient.
- Admin checks bounced addresses and corrects member contact through trusted operation.
- Send critical cancellation notice through approved manual contact route and record that fallback.
- Reconcile outbox after provider recovery without duplicate delivery.

### Financial discrepancy or wrong instruction

- Pause settlement finalization/new instructions for affected trip.
- Preserve current run, hashes, transfers and event log.
- Verify payee identifier directly through an independent known channel before any new external payment.
- Admin creates a versioned adjustment; never delete or edit a finalized transfer.
- If sensitive identifier was exposed, restrict access, rotate the payment method, invalidate short-lived snapshots, notify affected members, and audit the incident.

### Failed backup or suspected data loss

- Alert admin; preserve last known good encrypted export.
- Stop destructive cleanup and schema changes.
- Restore isolated first; never overwrite production until counts/invariants are verified.
- Use forward repair or restore with explicit owner/operator approval.
- Re-run full security and settlement certification before reopening member writes.

## 8. Cost and launch gates

- Maintain a service inventory with plan, monthly cost, quotas, inactivity/suspension rules, data location, retention and upgrade trigger.
- No paid provider/add-on is introduced without owner approval.
- Supabase Free pause and downloadable backup limitations must be reflected in the operator checklist.
- Render previews and static hosting plan capabilities are rechecked before configuration.
- Public launch requires demonstrated backup export + restore, external monitoring, deadline simulation after downtime, working notification retries, and manually verified cabin cancellation fallback.
- If any of RPO 24 hours, RTO one business day, privacy retention or cabin deadline control cannot be shown, mark certification BLOCKED or explicitly obtain owner risk acceptance.

## 9. Current provider references

- [Supabase Free project pausing](https://supabase.com/docs/guides/platform/free-project-pausing)
- [Supabase backup guidance](https://supabase.com/docs/guides/platform/backups)
- [Supabase CLI database dump](https://supabase.com/docs/reference/cli/supabase-db-dump)
- [Supabase backup/restore with the CLI](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)
- [Supabase database size and Free read-only threshold](https://supabase.com/docs/guides/platform/database-size)
- [Supabase billing and current Free quotas](https://supabase.com/docs/guides/platform/billing-on-supabase)
- [Supabase Cron](https://supabase.com/docs/guides/cron)
- [Securing Supabase Edge Functions](https://supabase.com/docs/guides/functions/auth)
- [Render Static Sites](https://render.com/docs/static-sites)
- [Render rollbacks](https://render.com/docs/rollbacks)
