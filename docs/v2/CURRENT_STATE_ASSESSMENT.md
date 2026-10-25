# Camping Club 2.0 — Current State Assessment (1.0 Baseline)

## 1. Technical Baseline Inventory

### Frontend Architecture
- **Framework & Tooling:** React 18, TypeScript 5.x, Vite, React Router v7.
- **Hosting & CDN:** Render Static Site deployed via Git integration, custom DNS with canonical redirection (`https://private-camping-club.com`).
- **Styling & Design System:** Custom CSS design system adhering to `#244435` (Deep Forest Green), `#2e7d32` (Forest Green Accent), `#ffffff` cards, and `#f8fafc` page backgrounds. Zero heavy external component libraries.
- **Client State:** Direct integration with Supabase JS Client (`@supabase/supabase-js`), optimistic local state updates with rollback on network failure.

### Backend & Database Architecture
- **Persistent Data Store:** Supabase PostgreSQL (Managed Postgres 15+).
- **Security & Authorization:** 
  - Row Level Security (RLS) enabled across 100% of exposed public tables.
  - Custom PostgreSQL security invoker/definer functions: `is_admin()`, `is_accountant()`, `is_active_member()`.
  - Sensitive payment identifiers (Zelle emails, Venmo handles) encrypted and stored exclusively in the private, non-exposed `private.payment_identities` schema.
- **Serverless Operations:** Supabase Edge Functions (`api-trip`) executing server-authoritative mutations with transactional integrity, idempotency keys, and audit logging.
- **Automated Scheduling:** Supabase `pg_cron` running hourly sweeps for registration cutoff deadlines, cabin cancellation buffers, and unconfirmed RSVP cancellations.

---

## 2. Database Schema & State Machines Inventory

The Camping Club 1.0 database comprises 28 sequential migrations establishing authoritative relational structures:

| Domain | Key Tables | Authoritative State Values |
| :--- | :--- | :--- |
| **Members & Roles** | `members`, `member_roles` | Roles: `member`, `accountant`, `admin`. Status: `pending`, `active`, `suspended`. |
| **Campsites & Calendar** | `campsites`, `camping_trips`, `trip_poll_events` | Trip status: `tentative`, `confirmed`, `cancelled`. Cabin booking: `booked`, `pending`, `sites_available`, `no_vacancy`. |
| **Attendance & RSVP** | `trip_rsvps`, `trip_waitlist` | RSVP: `going`, `not_going`. Waitlist: `active`, `promoted`, `dropped`. |
| **Constitution & Rules** | `rule_definitions`, `rule_bundles`, `member_rule_acknowledgments` | Versioned bundles with cryptographic `content_hash` and immutable timestamped signatures. |
| **Cabin Financials** | `cabin_commitments`, `cabin_deposit_records` | Deposit status: `unsubmitted`, `submitted`, `verified`. |
| **Duties & Workload** | `master_duties`, `trip_duties`, `trip_duty_assignments` | Assignment: `claimed`, `completed`, `dropped`. Workload weights: 0.5–5.0× (default 2.0× daily target per day). Carpool Driver duties assigned per arrival/departure date. |
| **Logistics & Carpools** | `trip_vehicles`, `trip_carpool_riders` | Vehicle capacity (e.g. 4–7), departure times, passenger assignments. |
| **Gear & Groceries** | `master_gear_catalog`, `trip_gear_items`, `master_grocery_catalog`, `trip_grocery_items`, `packing_checklist_items` | Categories: `individual`, `shared`. Status: `unclaimed`, `claimed`, `packed`. |
| **Activities & Tours** | `master_activities`, `trip_activities`, `trip_activity_participants`, `activity_vouchers`, `tour_call_sheet_notes` | Status: `opted_in`, `opted_out`. Voucher code: encrypted string. Waiver: `none`, `member_signed`, `operator_verified`. |
| **Settlement & Ledger** | `ledger_expenses`, `expense_allocations`, `settlement_runs`, `settlement_transfers` | Settlement run: `draft`, `finalized`. Transfers: `pending`, `sent`, `confirmed`. |

---

## 3. UI/UX Pain Point Analysis (Camping Club 1.0)

### Pain Point 1: Calendar Landing Page Overload
- **1.0 State:** Every trip card displays a full-width photo banner, dates, RSVP buttons, cabin booking status, attendee list, and a large **5-checkpoint readiness scorecard** (Poll, Cabin, Duties, Gear/Groceries, Settlement).
- **Impact:** Members are hit with a wall of status badges before understanding whether they themselves need to take action. Secondary metadata pushes the primary RSVP action below the fold on mobile.

### Pain Point 2: Monolithic Event Details Overview
- **1.0 State:** The Event Details page currently contains six top-level tabs (`Overview`, `Tasks & Meals`, `Logistics`, `Activities`, `Financials`, `Constitution`). Furthermore, `Overview` functions as a monolithic dump containing campsite photos, weather notes, full rule summaries, deposit buttons, and a complete attendee roster.
- **Impact:** On mobile browsers, scrolling through `Overview` takes up to 5 full screen lengths. Members cannot distinguish immediate personal tasks from general reference data.

### Pain Point 3: Fragmented Administrative Workflows
- **1.0 State:** Administrators must inspect multiple distinct sub-screens to monitor trip readiness:
  - Attendance & Waitlist: `Overview` tab.
  - Chores & Meals: `Tasks & Meals` tab.
  - Carpool & Logistics: `Logistics` tab.
  - Vouchers & Waivers: `Activities` tab.
  - Deposits & Expenses: `Financials` tab.
  - Master Catalogs: Scattered across separate settings modals.
- **Impact:** Administrators must act as human synchronizers. If a member signs a waiver or claims a duty, the admin must navigate through several pages to verify readiness.

### Pain Point 4: Mobile Viewport & Touch Target Constraints
- **1.0 State:** On mobile viewports (e.g. 390px iPhone), action buttons in tables and cards are often squeezed into narrow multi-column blocks, resulting in awkward word breaks (`Verify Now` wrapping into two lines) and touch targets under 36px.
- **Impact:** Accidental clicks and tap frustration on physical devices.

---

## 4. Current Test Suite & Code Health

The repository has an extensive automated test suite certifying 1.0 functionality:
- **TypeScript Typecheck:** 0 errors across frontend and Edge Functions.
- **Unit & Domain Tests:** 31 test files, 317 unit tests passing (100%).
- **Database RLS & Security Tests:** 26 test files, 622 tests passing (100%).
- **Phase 1 & 2 Integration Checks:** 100% passing.
- **Playwright E2E Suite:** Multi-browser test suite certifying Desktop Chromium, iPhone Mobile WebKit, and Android Mobile Chromium with sequential execution (`workers: 1`).

**Conclusion:** The underlying domain logic, database schemas, financial settlement math, and security policies are rock-solid. Camping Club 2.0 must preserve this foundation entirely while delivering a radically simpler, action-oriented user experience.
