# Camping Club 2.0 — Staging Environment & Sanitized Data Strategy

## 1. Staging Environment Identity & Isolation

To guarantee that Camping Club 1.0 production operations are never affected during 2.0 development and testing, all integration and staging verification takes place in a strictly isolated environment.

### Environment Identification
- **Production Supabase Project:** `camping-club` (Reference: authoritative production project).
- **Staging Supabase Project:** `camping-club-staging` (Reference: `rwmizunhxszjvcsaqkre`).
- **Production Web Application:** `https://private-camping-club.com` (Render Static Site).
- **2.0 Staging Frontend:** Local Vite preview on port `5173` or staging preview deployment.
- **Fail-Closed Rule:** If the active project reference or environment variables are ambiguous, all mutations fail closed immediately.

---

## 2. Production Database Schema Inventory

The authoritative database structure comprises 28 migrations:

```
supabase/migrations/
├── 20261008173426_phase1_foundation_auth_members.sql
├── 20261008185225_phase2_calendar_polls_rules.sql
├── 20261009023746_phase3_lifecycle_cabin_registration.sql
├── 20261009180000_phase4_logistics_responsibilities.sql
├── 20261010090000_phase5_financials_settlement.sql
├── 20261014080000_campsite_management_enhancements.sql
├── 20261014093000_fix_admin_configure_trip_poll_events.sql
├── 20261015093000_driver_workload_credits.sql
├── 20261016140000_daily_responsibilities_and_meal_schedule.sql
├── 20261018090000_activities_vouchers_and_waivers.sql
├── 20261021180000_master_gear_and_grocery_catalogs.sql
├── 20261023011500_trip_meal_preferences_and_not_going_guardrails.sql
└── ... (total 28 migrations)
```

---

## 3. Production Data Classification Matrix

| Category | Tables / Columns | Sensitivity Classification | Staging Handling Strategy |
| :--- | :--- | :--- | :--- |
| **Reference Configuration** | `campsites`, `rule_definitions`, `master_duties`, `master_gear_catalog`, `master_grocery_catalog`, `master_activities`, `club_configuration` | Non-sensitive Reference Data | Replicated directly via migrations and standard seed scripts. |
| **Member Identities & Auth** | `auth.users`, `members.email`, `members.full_name`, `members.phone_number` | Highly Sensitive PII & Auth | **Zero Copy.** Synthetically generated using standard aliases (e.g. `member.alpha@example.com`, `admin.user@example.com`). |
| **Payment Identifiers** | `private.payment_identities.encrypted_payload` (Zelle emails, Venmo tags) | Extreme Financial PII | **Strictly Prohibited in Staging.** Replaced with mock test handles (`mock-zelle@test.local`) encrypted under staging-only test keys. |
| **Activity Vouchers** | `activity_vouchers.voucher_code` (Groupon codes) | Sensitive Commercial Value | Replaced with deterministic synthetic test codes (`TEST-VOUCH-1001`). |
| **Tour Waivers** | `trip_activity_participants.waiver_document_url` | Personal Legal Records | Replaced with local test PDF links (`https://example.com/test-waiver.pdf`). |
| **Financial Ledger** | `ledger_expenses`, `expense_allocations`, `settlement_transfers` | Member Financial Transactions | Synthetically generated realistic integer-cent test scenarios matching exact worked examples. |

---

## 4. Synthetic Scenario Generation Pipeline

To ensure the **Action Resolution Service** and **Trip Health Engine** are verified against complex real-world state combinations without exposing real member data, a comprehensive synthetic seed script (`scripts/seed-staging-scenarios.ts`) generates 5 canonical scenario trips:

### Scenario 1: The "Immediate Action" Upcoming Trip (Monterey Cabin)
- **Status:** `confirmed`, departing in 18 days.
- **Attendance:** 6 Confirmed, 1 Waitlisted (Capacity: 6).
- **Test States Covered:**
  - 2 members with verified $50 deposits.
  - 1 member with submitted deposit awaiting accountant verification.
  - 1 member with unsubmitted deposit.
  - 1 member missing daily workload weight (Saturday at 0.0× of 2.0× target).
  - 1 driver assigned Inbound Driver (2.0× on Friday) and Outbound Driver (2.0× on Sunday), each contributing strictly to that date.
  - Historical `trip_driver_credits` records present for backward-compatibility schema checks.
  - 1 member with self-reported signed waiver awaiting operator call sheet confirmation.

### Scenario 2: The "At-Risk Cutoff" Trip (Pinnacles Camping)
- **Status:** `tentative`, registration cutoff in 3 days.
- **Attendance:** 3 Going (Minimum threshold: 4).
- **Test States Covered:**
  - Contractual cabin cancellation deadline within 5 days.
  - Action Resolution triggers `ACT-ADM-CUTOFF` and `ACT-ADM-CABIN-CANCEL`.
  - Trip Health evaluates to `at_risk`.

### Scenario 3: The "Active Camping" Trip (Big Sur)
- **Status:** `confirmed`, starts today (Day 0).
- **Test States Covered:**
  - Lifecycle presentation switches to Phase 3 (Gate codes, camp host phone dialer, emergency hospital directions).
  - Daily Workload Progress bar renders active meals for today.

### Scenario 4: The "Completed & Unsettled" Trip (Yosemite Pines)
- **Status:** `confirmed`, concluded 3 days ago.
- **Test States Covered:**
  - Total expenses: $510.00 (Cabin $240, Groceries $180, Fuel $90).
  - Finalized settlement run with Greedy Max-Flow transfer graph.
  - 1 transfer in `pending` state (`[Mark Sent]` active).
  - 1 transfer in `sent` state (`[Confirm Received]` active).

### Scenario 5: The "New Member Access" Scenario
- **Test States Covered:**
  - 2 pending member access requests in `members` table.
  - Admin Operations surfaces `ACT-ADM-APPV`.

---

## 5. Outbound Communication & Notification Safety

To prevent accidental emails or notifications to real club members during testing:
1. **Email Domain Guard:** Supabase Auth and Edge Function email sinks are configured to deliver only to `@example.com` or an in-memory test mail trap.
2. **Outbound Webhook Disable:** All external third-party webhook integrations are disabled in the staging project configuration.
3. **Isolated Storage Bucket:** Receipts and waiver uploads in staging target `staging-receipts` private bucket, completely isolated from production media.
