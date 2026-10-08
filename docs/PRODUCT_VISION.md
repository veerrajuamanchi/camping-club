Camping Club — Product Vision & Requirements
Version: 2.0
Status: Approved for incremental implementation planning
Deployment Target: Render
Operating Model: Private, invitation-based, nonprofit camping coordination platform
Primary Objective: Provide a free, low-maintenance application that manages camping activities from planning through financial settlement.

1. Executive Vision
Build a centralized camping club application that enables members to:
Register once and maintain their contact and payment preferences.
View camping opportunities for the next 12 months.
Participate in monthly camping polls.
Rotate camping locations across seven predefined campsites.
See campsite availability information gathered by an administrator or automated local research tools.
Receive confirmation or cancellation notifications.
Review the club's Camping Constitution.
Record camping expenses and identify the participants sharing each expense.
Calculate each participant's financial obligations.
Receive simplified payment instructions showing exactly whom to pay and how much.
Track payment acknowledgments and settlement completion.
Administrators control camping schedules, polls, campsite selections, confirmation decisions, expense finalization, and notifications.
The system will not process payments or collect banking credentials. It will only coordinate reimbursements using participants' preferred external payment methods.
2. Product Principles
Free for all members.
Mobile-friendly and accessible through a standard browser.
No native mobile application required.
No dedicated server administration required.
No mandatory paid hosting subscriptions.
Members should register only once.
Administrative decisions must be traceable.
Financial calculations must be deterministic and auditable.
All monetary calculations must use integer cents or exact decimal arithmetic, never floating-point approximations.
Automated activities must be idempotent and recoverable.
Sensitive member information must be accessible only to authorized users.
No payment transfers will be initiated by the application.
Implement incrementally, but deliver the complete planned scope before public launch.
3. User Roles
3.1 Visitor
Can view the public-facing introduction and optionally the Camping Constitution, depending on administrator configuration.
Cannot see private member information, camping participant lists, or financial records.
3.2 Registered Member
Can:
Maintain their profile.
View upcoming camping opportunities.
Join or withdraw from eligible polls.
View camping confirmations.
View other confirmed participants' names where authorized.
Submit expenses for camping trips they attended.
Select which attendees share each expense.
Review expense calculations.
View finalized settlement instructions.
Confirm that payments have been sent or received.
View their personal camping history.
3.3 Administrator
Can:
Manage members and roles.
Configure the seven campsites.
Create, edit, cancel, and close camping polls.
Override campsite rotation.
Maintain availability information.
Configure camping dates and deadlines.
Publish and revise the Camping Constitution.
Manage attendee lists.
Review and correct expenses.
Generate and finalize settlements.
Publish payment instructions.
Reopen a financial period through an audited revision process.
Review notification history and delivery failures.
4. Member Registration and Authentication
Collect the following information:
Field
Requirement
Full Name
Required
Email Address
Required; verified
Phone Number
Required
Preferred Payment Method
Required
Payment Identifier
Required according to method
Account Status
Active, inactive, or suspended
Member Role
Member or administrator

Supported payment methods:
Zelle
Confirm the Zelle-enrolled phone number.
Allow an alternate Zelle email in a future enhancement.
Explain that the entered number must be registered with Zelle.
Venmo
Confirm the Venmo username, including the @ identifier.
PayPal
Confirm the email associated with the PayPal account.
Apple Cash
Confirm the phone number associated with Apple Cash.
Validation confirms the format and asks the member to attest that the identifier is correct. The application cannot independently verify ownership of external payment accounts.
Authentication should use secure email-based sign-in, such as a one-time code or magic link.
Phone numbers and payment identifiers must be protected by access controls. Other members should not have unrestricted access to the membership directory.
5. Camping Locations and Round-Robin Rotation
The system initially supports seven campsites:
Rotation
Campsite
1
Del Monte
2
Wishon Cove
3
DeSabla
4
Almanor
5
Shasta
6
Britton
7
Pit River

The rotation repeats after the seventh campsite.
For example, if the first scheduled month uses Del Monte, the eighth month uses Del Monte again.
5.1 Rotation Requirements
Generate campsite assignments for a rolling 12-month calendar.
Maintain a configurable rotation starting point.
Persist the assigned campsite with each monthly poll.
Allow administrators to select another campsite using a dropdown.
Preserve the original suggested campsite for audit purposes.
Manual overrides must not silently change the underlying rotation sequence.
Administrators can explicitly reset or reorder the rotation.
Cancelled months retain their scheduled rotation position by default.
The rotation should not depend on whether a trip actually occurred.
5.2 Campsite Configuration
Each campsite record should include:
Campsite name.
Availability website URL.
Location description.
Optional address or directions.
Cabin capacity.
Available cabin types.
Reservation instructions.
Estimated rates.
Administrator notes.
Active/inactive status.
The system must support adding additional campsites later.
6. Campsite Availability Research
Availability research is an optional automation capability and must not prevent manual poll creation.
Initial sources:
Del Monte: https://www.psea.info/psea-camps/del-monte-rate-and-availability/
Wishon Cove: https://www.psea.info/psea-camps/wishon-rate-and-availability/
DeSabla: https://www.psea.info/psea-camps/desabla-rate-and-availability/
Almanor: https://www.psea.info/psea-camps/almanor-rate-availability/
Shasta: https://www.psea.info/psea-camps/shasta-rate-and-availability/
Britton: https://www.psea.info/psea-camps/britton-rate-and-availability/
Pit River: https://www.psea.info/psea-camps/pit-river-rate-and-availability/
6.1 Local Research Model
The administrator may execute availability collection scripts on their local computer.
The scripts should:
Access permitted campsite availability pages.
Extract supported availability and pricing information.
Normalize the results into a structured format.
Record source URLs and retrieval timestamps.
Distinguish confirmed availability from uncertain or unavailable data.
Produce a reviewable JSON or CSV file.
Allow administrator review before publishing.
Upload approved results into the application's database through an authenticated administrative interface.
Do not assume that websites permit crawling, provide machine-readable availability, or display live reservation inventory.
Respect access restrictions, robots directives where applicable, website terms, and reasonable request rates. Never bypass CAPTCHA, login restrictions, or access controls.
If automated extraction is unreliable, the administrator can enter availability manually.
6.2 Availability Status
Supported statuses:
Available
Limited availability
Unavailable
Unknown
Requires manual confirmation
Store the source, last verification time, and verification method.
Availability is informational until the administrator verifies it. The system must never automatically claim a cabin has been reserved.
7. Monthly Camping Polls
Maintain a rolling schedule of 12 future monthly polls.
Each poll contains:
Month and year.
Campsite.
Camping start date.
Camping end date.
Registration deadline.
Minimum required participants.
Optional maximum capacity.
Cabin availability status.
Estimated cabin cost.
Additional trip information.
Current signup count.
Poll status.
7.1 Poll Statuses
Draft
Open
Closed — Pending Decision
Confirmed
Cancelled
Completed
7.2 Minimum Participation
Default minimum: 4 registered participants.
The administrator may configure a different minimum for a particular trip.
Only active, confirmed registrations count toward the minimum.
7.3 Registration Deadline
Default registration deadline: 35 calendar days before the trip's configured reservation start date.
The application should support a separate contractual cancellation deadline and configurable safety buffer.
If the cabin cancellation deadline is 30 days before the reservation start, the default 35-day registration cutoff provides a five-day administrative buffer.
The application must use the configured local timezone consistently and show the exact closing date and time.
7.4 Automatic Decision
At the poll deadline:
When participants meet or exceed the minimum:
Close registration.
Mark the trip as confirmed, subject to any configured administrator booking-verification gate.
Notify registered participants.
Notify the administrator to verify or complete the cabin reservation.
When participants fall below the minimum:
Close registration.
Mark the trip as cancelled.
Notify registered participants.
Notify the administrator to cancel any existing cabin reservation before the contractual deadline.
Cancellation of the camping event must never be represented as proof that the external cabin reservation has been cancelled.
The administrator must record the actual cabin cancellation confirmation separately.
7.5 Member Withdrawal
Members may withdraw before the registration deadline.
Withdrawals after confirmation require administrator approval.
Late withdrawal does not automatically cancel a confirmed trip.
Any financial responsibility for late withdrawal must follow the Camping Constitution.
8. Notifications
The system must support email notifications for:
Member registration and verification.
New camping polls.
Upcoming poll closing reminders.
Camping confirmation.
Camping cancellation.
Campsite or date changes.
Camping reminders.
Expense submission reminders.
Expense settlement publication.
Settlement revision.
Payment sent acknowledgment.
Payment received acknowledgment.
Notification recipients must be determined by event type.
For example, a cancelled poll should notify its registered participants, the administrator, and optionally other members subscribed to club-wide updates.
Every notification must have an auditable delivery record.
Use a background or scheduled mechanism independent of website visits.
9. Camping Constitution
Create a dedicated Camping Constitution page.
Administrators can maintain structured sections including:
Club purpose.
Minimum camping participation.
Registration deadlines.
Cabin reservation responsibilities.
Cancellation and refund policies.
Late withdrawal rules.
Driving arrangements.
Driver reimbursement rules.
Fuel and transportation expenses.
Cabin expenses.
Food and grocery expenses.
Shared equipment expenses.
Alcohol or other excluded expense categories, if applicable.
Expense submission deadlines.
Payment deadlines.
Dispute resolution.
Member conduct.
Administrator responsibilities.
Initial default rule:
A camping trip requires a minimum of four confirmed participants to proceed.
All additional rules remain configurable and may be supplied later.
The Constitution must support version history, publication dates, and administrator editing.
Members should be able to review the rules applicable to a particular camping trip, even if the Constitution is revised later.
10. Camping Expense Management
This is a core application capability.
10.1 Expense Entry
Members who actually attended a trip can submit expenses.
Each expense includes:
Camping trip.
Expense description.
Category.
Date.
Total amount.
Paying member.
Participants sharing the expense.
Split method.
Optional receipt attachment.
Notes.
Submission timestamp.
The default split method is equal sharing among selected participants.
10.2 Participant Selection
Display the actual attendees of the completed camping trip as checkboxes.
Example:
Expense: Groceries — $120
Selected participants:
Veerraju
Syed
Manmohan
Surya
The application divides the $120 expense equally among those four participants.
Each selected participant owes $30 toward the expense.
Other attendees who are not selected owe nothing for this expense.
The payer does not have to be included among the people sharing the expense.
10.3 Supported Split Methods
The architecture must support:
Equal split among selected participants.
Custom fixed amounts.
Custom percentages.
Individual-only expenses.
Driver-specific reimbursements.
Administrator adjustments with explanations.
Equal split will be the default.
All split allocations must add up exactly to the expense total.
When cents cannot be divided evenly, use a deterministic rounding and remainder-allocation rule.
10.4 Expense Categories
Initial categories:
Cabin
Groceries
Restaurant
Fuel
Transportation
Parking
Equipment
Other
Administrators can add or modify categories.
10.5 Expense Review
Members may submit and edit their own expenses until the expense submission deadline.
The administrator can:
Review all expenses.
Correct inaccurate entries with audit records.
Reject duplicates.
Resolve disputes.
Lock expense submissions.
Preview settlements.
Finalize financial obligations.
11. Expense Settlement Engine
The settlement engine must calculate each participant's net position across all approved expenses.
For each participant:
Net Balance = Total Amount Paid − Total Expense Share
A positive net balance means the participant should receive money.
A negative net balance means the participant owes money.
A zero balance means the participant is settled.
11.1 Core Algorithm
Retrieve all approved trip expenses.
Calculate exact shares for each selected participant.
Aggregate the amount paid by each member.
Aggregate the expense share owed by each member.
Calculate each member's net balance.
Verify that all net balances sum to zero.
Separate debtors and creditors.
Generate an optimized set of payments from debtors to creditors.
Verify that the proposed payments settle every balance exactly.
Present a settlement preview.
Allow the administrator to finalize the settlement.
Freeze the finalized calculation.
Generate individual payment instructions.
Send settlement notification emails.
11.2 Payment Minimization
The primary goal is to reduce the number of payment transactions while settling all obligations correctly.
The engine must not simply instruct each participant to reimburse every person who originally paid an expense.
Instead, it should net all approved obligations first.
Where feasible, favor solutions in which a debtor pays one creditor rather than several.
A greedy largest-balance matching algorithm may be used as a fallback, but it is not guaranteed to produce the minimum possible number of transfers.
For small camping groups, implement an exact or bounded optimization algorithm that minimizes the number of transfers.
For larger groups, use a deterministic fallback with documented optimization limitations.
Secondary preferences:
Favor fewer payment recipients per debtor.
Prefer transfers compatible with available payment methods.
Avoid unnecessarily small transfers.
Maintain deterministic output for identical inputs.
Payment method compatibility is a preference, not a reason to change the amount owed.
11.3 Financial Validation
Before finalization, verify:
All approved expenses are included.
Every expense is fully allocated.
Every participant belongs to the trip.
Total credits equal total debits.
Total outgoing settlements equal total incoming settlements.
All participant balances become zero after the proposed transfers.
No negative or zero-value transfer is generated.
No participant pays themselves.
All financial calculations are reproducible.
11.4 Settlement Finalization
Only an administrator can finalize expenses.
After finalization:
Lock the approved expense snapshot.
Assign a settlement version number.
Store the calculated transfers.
Record the finalizing administrator and timestamp.
Generate a settlement summary.
Notify affected participants.
Do not silently recalculate finalized settlements after members have received payment instructions.
Corrections require an explicit audited revision.
12. Payment Preferences and Settlement Instructions
Each member has one preferred payment method.
The settlement notification must include:
Camping trip.
Payer's name.
Recipient's name.
Exact amount.
Recipient's preferred payment method.
Recipient's configured payment identifier.
Settlement reference.
Payment deadline, if configured.
12.1 Mandatory Payment Safety Message
Include the following warning in every payment instruction:
Before sending money, contact the recipient directly and reconfirm their payment details, including the phone number, username, or email address. Do not rely solely on the details displayed in this email. Verify the recipient and amount before transferring funds.
Payment details should be disclosed only to the parties involved in the transfer and authorized administrators.
Never include a complete member payment directory in a group email.
12.2 Payment Tracking
Allow the payer to mark a transfer as sent.
Allow the recipient to mark it as received.
Supported payment statuses:
Pending
Marked Sent
Confirmed Received
Disputed
The application must not automatically mark payments as completed merely because an email was sent.
13. Application Pages
Member Pages
Welcome / Club Home
Registration / Sign In
My Profile
Camping Calendar
Monthly Poll Details
My Camping Signups
Camping Constitution
Trip Details and Attendees
Trip Expense Entry
Trip Expense Summary
My Settlement Instructions
My Payment History
Administrator Pages
Administrator Dashboard
Member Management
Campsite Management
Campsite Availability Import
Rotation Configuration
Monthly Poll Management
Camping Confirmation / Cancellation Management
Cabin Booking and Cancellation Tracking
Constitution Editor
Expense Review
Settlement Preview and Optimization
Settlement Finalization
Payment Tracking
Notification History
Application Configuration
14. Technical Architecture
Frontend
React
TypeScript
Responsive layout
Mobile-first design
Static deployment on Render
Backend and Database
Preferred architecture:
Supabase PostgreSQL
Supabase Authentication
Row Level Security
Server-side functions for privileged operations
Scheduled background automation
The database must persist independently of Render's ephemeral runtime.
SQLite may be used for local development or testing but must not be the primary production database on Render's free web service.
Notifications
Use a transactional email provider with a suitable free tier.
Notification delivery must be retried safely and recorded.
Local Automation
Use Python for optional campsite availability collection.
The administrator may run these scripts manually or through a local scheduled job.
Publish approved availability data through an authenticated application API or administrative import.
Deployment
GitHub source repository.
Render static frontend hosting.
Managed database and authentication.
Protected application secrets.
Environment-specific configuration.
Repeatable deployment procedures.
The system must remain functional without the administrator's local computer being continuously online.
15. Data Model
Core entities:
Users
MemberProfiles
PaymentPreferences
Campsites
CampsiteAvailabilitySnapshots
AvailabilityImports
RotationConfiguration
CampingTrips
CampingPolls
PollRegistrations
TripAttendees
CabinReservations
ConstitutionVersions
TripConstitutionAcknowledgments
ExpenseCategories
Expenses
ExpenseAllocations
ExpenseReceipts
SettlementRuns
SettlementBalances
SettlementTransfers
PaymentAcknowledgments
NotificationOutbox
NotificationDeliveryAttempts
AuditEvents
ApplicationSettings
All financial records must preserve historical identifiers, amounts, and versions needed for an audit.
Do not delete historical financial records when members become inactive.
16. Nonfunctional Requirements
Security
Authenticated access to member functionality.
Role-based authorization.
Database-level access restrictions.
Secure administrative APIs.
No sensitive API keys in frontend bundles.
Protected payment identifiers.
Input validation.
Rate limiting where appropriate.
Protection against duplicate submissions.
Secure handling of receipt attachments.
Reliability
Idempotent scheduled jobs.
Safe notification retries.
Transactional settlement finalization.
Database backup and restore procedures.
Monitoring for missed poll deadlines.
Administrative alerts for failed automation.
No reliance on website traffic to execute business rules.
Usability
Clear mobile navigation.
Simple checkbox-based expense splitting.
Visual poll participation progress.
Clear confirmation and cancellation status.
Easy-to-understand payment instructions.
Accessible forms and status indicators.
Financial Accuracy
Exact monetary arithmetic.
Deterministic rounding.
Reproducible settlement results.
Comprehensive automated financial tests.
Immutable finalized settlement snapshots.
17. Incremental Implementation Plan
Phase 1 — Foundation
Authentication, member profiles, payment preferences, database schema, authorization, and deployment.
Phase 2 — Campsites and Polls
Seven campsites, round-robin scheduling, 12-month polls, registration, deadlines, and administrator overrides.
Phase 3 — Camping Decisions and Notifications
Automated poll closing, minimum participation checks, confirmation/cancellation, reminders, and email delivery.
Phase 4 — Availability Research
Local Python availability tools, structured imports, provenance, review, and manual overrides.
Phase 5 — Camping Constitution
Rules page, administrator editor, version history, and trip-specific rules snapshots.
Phase 6 — Expense Management
Expense submissions, checkbox participant selection, split methods, receipt handling, and administrative review.
Phase 7 — Settlement Optimization
Net balance calculations, minimized transfer generation, settlement preview, finalization, and audit records.
Phase 8 — Payment Notifications
Individual payment instructions, payment preference handling, safety warnings, and acknowledgment tracking.
Phase 9 — Production Readiness
End-to-end testing, security review, scheduled-job reliability, database recovery, email verification, and deployment certification.
18. Release Criteria
The application must not be considered production-ready until:
All seven campsites are configured.
The rolling 12-month schedule works.
Round-robin scheduling and manual overrides work.
Poll deadlines are enforced correctly.
Four-person minimum logic is validated.
Confirmation and cancellation emails work.
The Camping Constitution is available.
Expense entry and participant-specific splitting work.
Settlement calculations pass automated tests.
Administrator finalization works.
Payment instructions include mandatory verification warnings.
Sensitive payment information is appropriately protected.
Scheduled tasks execute without relying on a member visiting the site.
Backups and restoration are tested.
All critical user journeys pass end-to-end tests.
Final Product Vision: A complete, free-to-use camping coordination platform that eliminates spreadsheet-based planning, manual participation tracking, expense reconciliation, and fragmented payment communication while preserving administrator control over cabin reservations and financial decisions.

camping-club/
├── AGENTS.md
├── README.md
├── render.yaml
├── .github/
│   └── workflows/
│       └── ci.yml
│
├── docs/
│   ├── PRODUCT_VISION.md
│   ├── FUNCTIONAL_REQUIREMENTS.md
│   ├── SYSTEM_ARCHITECTURE.md
│   ├── TECHNOLOGY_STANDARDS.md
│   ├── RENDER_DEPLOYMENT_ARCHITECTURE.md
│   ├── SECURITY_ARCHITECTURE.md
│   ├── DATABASE_SCHEMA.md
│   ├── BUSINESS_RULES.md
│   ├── SETTLEMENT_ENGINE_SPEC.md
│   ├── NOTIFICATION_SPEC.md
│   ├── OPERATIONS_AND_RECOVERY.md
│   ├── ARCHITECTURE_DECISIONS.md
│   └── IMPLEMENTATION_PLAN.md
│
├── frontend/
│   ├── src/
│   ├── package.json
│   └── vite.config.ts
│
├── supabase/
│   ├── migrations/
│   └── functions/
│
├── packages/
│   └── settlement-engine/
│
├── scripts/
│   └── campsite-availability/
│
└── tests/


There is a difference between free hosting and reliable unattended operation.
Render's static hosting is appropriate for your application. But a database that can pause after inactivity creates a risk for automated 35-day cancellation deadlines. Free Render web services also have ephemeral filesystems and idle shutdown behavior.

Supabase Docs
+1
I would require the agent to evaluate two operating models:


Completely free
Low-cost reliability option
Render frontend
Free static site
Free static site
Database
Free tier with inactivity risk
Persistent service without inactivity suspension
Automation
Free scheduler with monitoring
More reliable managed scheduler
Email
Free quota
Free quota or small paid plan
Operational reliability
Best effort
Better suited to deadline-sensitive operation
Cost
Target $0/month
Cost to be determined

My recommendation: Approve the Render Static Site + React + Supabase architecture as the baseline, but require the agent to certify the scheduling and database reliability before production launch. Your local Mac should only be needed for optional campsite availability collection, never for essential cancellation notifications.
The most important document is AGENTS.md, because it tells the coding agent to follow the approved architecture every time it works on the repository—not just during the initial design phase.





