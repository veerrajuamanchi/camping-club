Camping Club — Architecture Governance and Technology Selection
Mission
Establish the technical architecture for the Private Camping Club Management Platform before implementing application features.
Repository: camping-club
Application: Private Camping Club
Formal Name: Private Camping Club Management Platform
Primary Hosting Platform: Render
Primary Database Platform: Supabase PostgreSQL
Cost Objective: $0 recurring hosting and infrastructure costs wherever feasible.
Development Environment: macOS, VS Code, GitHub, local Python and Node.js.
1. Architecture Decisions
The following decisions are approved architectural baselines.
ADR-001: Static Frontend Hosting
Use Render Static Sites.
Build the frontend with React, TypeScript, and Vite.
Do not introduce server-side rendering, an always-running Node.js backend, or a Docker-based application service without explicit architectural approval.
ADR-002: Persistent Database
Use Supabase PostgreSQL.
Do not use SQLite as the production database.
All persistent application state, including member registrations, polls, expenses, settlements, and notification records, must reside in durable storage.
ADR-003: Backend Business Logic
Use server-side functions or secure database operations for privileged business logic.
The browser must never be trusted to authorize:
Poll confirmation or cancellation.
Administrative changes.
Settlement finalization.
Financial record modification after finalization.
Payment notification dispatch.
Membership role changes.
Use database transactions, authorization checks, and Row Level Security.
ADR-004: Financial Settlement Engine
Implement settlement calculations as a pure, deterministic TypeScript module.
Use integer cents for monetary values.
The calculation module must be independently testable without a browser, database, or email provider.
Execute authoritative settlement finalization on the server.
For small groups, use an exact minimum-transfer algorithm with configurable computational limits.
Maintain an auditable settlement snapshot.
ADR-005: Scheduling and Automation
Scheduled processes must operate independently of Render website traffic.
Required scheduled activities include:
Poll deadline evaluation.
Camping confirmation or cancellation.
Registration reminders.
Notification retries.
Monitoring for missed deadlines.
All scheduled processes must be idempotent.
Use a durable job or notification outbox where appropriate.
The architecture must include recovery procedures for interrupted or missed executions.
ADR-006: Email Notifications
Use a transactional email provider.
All notification sending must occur through trusted backend functions.
Never expose email API credentials in frontend JavaScript.
Record notification status, delivery attempts, and failures.
Ensure duplicate scheduled executions do not generate duplicate business notifications.
ADR-007: Campsite Availability Collection
Implement campsite availability collection as a separate Python utility.
The utility runs locally on the administrator's Mac.
It must not be required for normal application operation.
Availability data must be validated before publication.
Provide an authenticated import mechanism.
Preserve source URLs, collection timestamps, and administrator verification status.
ADR-008: Authentication and Security
Use Supabase Auth.
Require verified email addresses.
Support administrator and member roles.
Apply Row Level Security to sensitive tables.
Do not expose database service-role keys, email provider credentials, or other privileged secrets to the frontend.
Payment identifiers must be disclosed only to authorized parties.
ADR-009: Infrastructure Cost Governance
Prefer free-tier services.
Before introducing a new external service, document:
Why it is required.
Whether it has a free tier.
Free-tier quotas and limitations.
Inactivity and suspension policies.
Potential future costs.
Available alternatives.
Do not introduce a paid dependency without administrator approval.
Do not claim that free-tier services guarantee production availability.
ADR-010: Deployment and Operations
Deploy the frontend through Render using the GitHub repository.
Maintain deployment configuration as code where supported.
Use separate development and production configuration.
Document all required environment variables.
Maintain database migration scripts.
Include backup and restoration procedures.
Do not assume local files or processes on Render persist between deployments.
2. Required Architecture Artifacts
Create:
docs/TECHNOLOGY_STANDARDS.md
docs/RENDER_DEPLOYMENT_ARCHITECTURE.md
docs/SYSTEM_ARCHITECTURE.md
docs/SECURITY_ARCHITECTURE.md
docs/OPERATIONS_AND_RECOVERY.md
docs/ARCHITECTURE_DECISIONS.md
AGENTS.md
The architecture documents must cover component boundaries, data flows, technology selection, authentication, authorization, infrastructure configuration, scheduling, deployment, monitoring, backup, and disaster recovery.
3. Render Deployment Requirements
Document and implement:
Render service type: Static Site.
Application root: frontend/.
Build command: npm ci && npm run build.
Publish directory: dist.
Git branch: main.
Automatic deployment configuration.
SPA rewrite: /* to /index.html.
HTTPS configuration.
Frontend environment variables.
Production deployment validation.
Rollback procedure.
Provide a render.yaml Blueprint where appropriate.
The frontend must not contain privileged credentials.
4. Agent Development Rules
Before implementing a capability:
Read the product vision.
Read AGENTS.md.
Read the relevant architecture documents.
Identify applicable architecture decisions.
Review dependencies and security implications.
Implement the capability.
Add automated tests.
Validate architecture compliance.
Update documentation when needed.
Report any deviations or unresolved risks.
Do not silently change approved technologies.
Do not introduce unnecessary infrastructure.
Do not use mock financial results in production workflows.
Do not claim a capability is complete without validating its acceptance criteria.
5. Architecture Certification
Before feature implementation begins, produce an architecture certification report covering:
Render compatibility.
Database persistence.
Authentication and authorization.
Financial settlement integrity.
Scheduled automation reliability.
Email delivery architecture.
Free-tier limitations.
Recovery from service suspension.
Backup and restoration.
Deployment repeatability.
Operational cost estimates.
Classify findings as:
PASS
PASS WITH RISK
BLOCKED
Explicitly identify any risks that could cause a missed cabin cancellation deadline, loss of financial records, or incorrect payment instructions.
Do not certify the architecture as production-ready while any critical reliability or financial integrity risk remains unresolved.
6. Initial Assignment
Create the architecture governance documents and proposed deployment design.
Do not begin application feature development yet.
Present the selected technologies, architectural decisions, operational risks, estimated costs, and implementation sequence for review.
Once approved, implement incrementally using the architecture as the governing baseline.


