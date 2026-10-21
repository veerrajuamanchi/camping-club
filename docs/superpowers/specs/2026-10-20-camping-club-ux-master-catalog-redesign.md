# Design Specification: Master Catalogs & Participant Experience Redesign

**Document ID**: `2026-10-20-camping-club-ux-master-catalog-redesign`  
**Date**: October 20, 2026  
**Status**: Revised Post-Builder Check — Ready for Owner Review  
**Author**: Antigravity  

---

## 1. Executive Summary & Goals

This specification details the end-to-end redesign of the Private Camping Club platform covering two interconnected perspectives:

1. **The Admin Perspective**:
   - **Master Catalog Management** under Profile for **Camping Gear** (individual packing items vs. shared community gear) and **Food & Groceries**, alongside the existing **Master Responsibilities**.
   - Direct filter pills (`[All]`, `[🎒 Individual]`, `[⛺ Shared]`) and instant search for rapid catalog navigation.
   - **Auto-Include by Default**: Newly created trips automatically include all active master items so the organizer focuses solely on unchecking what is not applicable.
   - **Safe Deletion Protocol**: 
     - For `master_gear` and `master_food_groceries`, items snapshot their details into `trip_commitments`, allowing permanent deletion of master templates (`ON DELETE SET NULL`) without affecting historical trips.
     - For `master_responsibilities`, unused templates can be permanently deleted; templates referenced in historical trips are safely retired (`active = FALSE`) to preserve historical duty logs.
   - **Single-Copy Rules Experience**: The admin maintains a single, directly editable Markdown document for the Camping Constitution and trip-specific notes. The system seamlessly snapshots content hashes upon RSVP in the background to ensure strict compliance with AGENTS.md Rule 4.

2. **The Participant Experience ("My Trip Hub")**:
   - Mobile-first, action-centric layout dividing tasks into **⚡ Required Only** (mandatory attendee obligations) and **📋 Trip To-Do & Contributions** (voluntary signup and checklist).
   - **Binary RSVP** (Going / Not Going) where clicking "Going" seamlessly records rule agreement in the background.
   - **$50 Deposit Confirmation**: Clear one-click acknowledgment (*"I Have Sent $50"*) updating status to `submitted_by_member` for admin/cabin-payer verification. Attending cabin payers are automatically marked `exempt`.
   - **Daily Chores Selection**: Explicit daily workload target (e.g., *"Select chores worth 2× for Saturday"*); upon reaching the target, remaining chores for that day are greyed out to signal completion.
   - **Shared Expense Split**: Attendee checkboxes with full names prominently displayed alongside real-time cost-per-person calculations and Select All/Clear shortcuts.
   - **Individual Packing Checklist**: Read-only, mobile-friendly personal gear checklist.

---

## 2. User Experience & Personas

### 2.1 Participant Journey: "My Trip Hub" Dashboard

When a club member opens `/trips/:tripId`, the interface adapts to a mobile-first vertical layout using the club's design system (`frontend/src/styles.css`):

```
+-------------------------------------------------------------+
| 🏕️ Big Basin Redwoods Spring Camp (May 15 - May 17)        |
+-------------------------------------------------------------+
| ⚡ REQUIRED FROM YOU (2 of 3 Completed)                     |
|                                                             |
|  [✓] RSVP Status: Going                        [Change]     |
|  [⚠️] $50 Cabin Deposit: Pending          [I Have Sent $50] |
|  [✓] Saturday Chores: 2.0x target met          [Complete]   |
+-------------------------------------------------------------+
| 📋 TRIP TO-DO & CONTRIBUTIONS (Voluntary)                   |
|                                                             |
|  ⛺ Shared Gear: You volunteered for Propane Stove          |
|      [+ Claim More Shared Gear]                             |
|                                                             |
|  🍎 Food & Groceries: 3 open items needed                   |
|      [+ Volunteer to Bring Item]                            |
|                                                             |
|  🎒 Your Personal Packing Checklist (8 items)               |
|      [👁️ View Packing Checklist]                             |
|                                                             |
|  🧾 Shared Expenses: Bought supplies for the group?         |
|      [+ Record Shared Expense]                              |
+-------------------------------------------------------------+
| 📜 Camping Constitution & Trip Notes (Read Only)            |
+-------------------------------------------------------------+
```

#### Daily Chores Selection Behavior:
- For each event day, a banner reads: `Select chores worth 2.0x for [DayName]`.
- Each chore displays its weight (e.g. `1.0x`, `0.5x`), description, and current volunteer count.
- When an attendee checks chores that meet or exceed the target (e.g. 2.0x), the day banner turns green: `✓ Target Met for [DayName]!`.
- Remaining unchecked chores for that day are immediately greyed out (`opacity: 0.55`, `cursor: not-allowed`, disabled checkbox) to signal that the volunteer is done selecting chores for that day.
- The attendee can uncheck any previously selected chore at any time to re-enable remaining options.

#### Shared Expense Split Behavior:
- Located in `frontend/src/components/trips/TripFinancialsTab.tsx`.
- The participant split list shows:
  - Checkbox with **full attendee name** displayed prominently next to the checkbox (e.g. `[x] Veerraju Amanchi`, `[x] Sarah Jenkins`).
  - Real-time calculated per-person split preview (e.g. `$16.12/person`).
  - Quick action buttons: **[Select All]** and **[Clear]**.
  - Enforces exact integer cent distribution via `calculateEqualAllocations` so sum of allocations equals total amount.

---

### 2.2 Admin Journey: Master Catalogs & Trip Setup

#### Master Catalog Management (`frontend/src/pages/MasterCatalogPage.tsx`)
Admins access three tabbed master directories under Profile:
1. **Camping Gear**:
   - Filter pills at top: `[All]`, `[🎒 Individual Packing]`, `[⛺ Shared Community Gear]`.
   - Real-time instant search input.
   - Columns/Fields: Title, Category, Description, Type (`individual` vs. `shared`), Default Quantity, Actions (`[Edit]`, `[🗑️ Delete]`).
2. **Food & Groceries**:
   - Master list of common camp food/grocery staples (Pancake Mix, Cooking Oil, Firewood, Eggs, Marshmallows).
   - Columns/Fields: Item Name, Category, Default Quantity, Actions (`[Edit]`, `[🗑️ Delete]`).
3. **Responsibilities**:
   - Master chore templates with workload weights.
   - Safe deletion: If unused, permanently deleted; if previously referenced, soft-retired (`active = false`).

#### Auto-Include Trip Item Selection:
- When a new trip is created, all active items from `master_gear` and `master_food_groceries` are automatically seeded into `trip_commitments` for that trip.
- When the admin opens **"📋 Manage Trip Checklist"**, all seeded items are displayed with checkboxes checked (`Active`).
- The admin unchecks any item not applicable to that specific trip.
- Admins can add one-off trip-specific items without adding them to the global master catalog.

---

## 3. Architecture & Data Model

### 3.1 Database Schema Extensions

#### 1. `master_gear` Table
```sql
CREATE TABLE IF NOT EXISTS public.master_gear (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL CHECK (char_length(name) BETWEEN 2 AND 100),
    description TEXT CHECK (description IS NULL OR char_length(description) <= 500),
    gear_type TEXT NOT NULL CHECK (gear_type IN ('individual', 'shared')),
    category TEXT NOT NULL CHECK (category IN ('shelter', 'sleep', 'kitchen', 'lighting', 'safety', 'tools', 'clothing', 'other')),
    default_quantity TEXT DEFAULT '1',
    is_critical BOOLEAN NOT NULL DEFAULT FALSE,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_master_gear_type_active ON public.master_gear(gear_type, active);
```

#### 2. `master_food_groceries` Table
```sql
CREATE TABLE IF NOT EXISTS public.master_food_groceries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL CHECK (char_length(name) BETWEEN 2 AND 100),
    description TEXT CHECK (description IS NULL OR char_length(description) <= 500),
    category TEXT NOT NULL CHECK (category IN ('pantry', 'produce', 'dairy_meat', 'bakery', 'beverages', 'campfire', 'supplies', 'other')),
    default_quantity TEXT DEFAULT '1 pack',
    is_critical BOOLEAN NOT NULL DEFAULT FALSE,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_master_food_active ON public.master_food_groceries(active);
```

#### 3. Enhancements to `trip_commitments`
```sql
-- Update category check constraint to accommodate catalog categories
ALTER TABLE public.trip_commitments 
    DROP CONSTRAINT IF EXISTS trip_commitments_category_check;

ALTER TABLE public.trip_commitments
    ADD CONSTRAINT trip_commitments_category_check 
    CHECK (category IN ('gear', 'food', 'supplies', 'shelter', 'safety', 'sleep', 'kitchen', 'lighting', 'tools', 'clothing', 'pantry', 'produce', 'dairy_meat', 'bakery', 'beverages', 'campfire', 'other'));

ALTER TABLE public.trip_commitments
    ADD COLUMN IF NOT EXISTS master_gear_id UUID REFERENCES public.master_gear(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS master_food_id UUID REFERENCES public.master_food_groceries(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS commitment_type TEXT NOT NULL DEFAULT 'shared_volunteer' CHECK (commitment_type IN ('individual_pack', 'shared_volunteer')),
    ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

CREATE INDEX IF NOT EXISTS idx_trip_commitments_type_active 
    ON public.trip_commitments(trip_id, commitment_type, is_active);
```

#### 4. Enhancements to `trip_rsvps` for $50 Deposit Tracking
```sql
ALTER TABLE public.trip_rsvps
    ADD COLUMN IF NOT EXISTS deposit_status TEXT NOT NULL DEFAULT 'unpaid' 
        CHECK (deposit_status IN ('unpaid', 'submitted_by_member', 'confirmed_by_admin', 'exempt')),
    ADD COLUMN IF NOT EXISTS deposit_submitted_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS deposit_confirmed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS deposit_confirmed_by UUID REFERENCES public.member_profiles(member_id) ON DELETE SET NULL;
```

#### 5. Rules Management & Compliance with AGENTS.md Rule 4
- The single-copy markdown text is stored on `camping_trips.rules_markdown`.
- When an attendee submits RSVP "Going", the backend automatically creates or reuses the rule bundle for that exact markdown snapshot and writes to `trip_rule_acknowledgments` with content hash, timestamp, and member ID.
- This satisfies AGENTS.md Rule 4 and the existing database constraint `check (response <> 'coming' or rule_acknowledgment_id is not null)`.

---

### 3.2 Security & Row Level Security (RLS)

- **`master_gear` & `master_food_groceries`**:
  - `SELECT`: Allowed for all authenticated active members (`account_status = 'active'`).
  - `INSERT / UPDATE / DELETE`: Restricted to verified administrators (`member_role IN ('admin', 'administrator')`).
- **`trip_rsvps` Security**:
  - Per AGENTS.md Rule 5, browser direct table writes are denied. Status changes are performed exclusively via authenticated database RPCs:
    - `submit_member_deposit(p_trip_id UUID)`
    - `verify_member_deposit(p_trip_id UUID, p_member_id UUID, p_status TEXT)`

---

## 4. API & Edge Function Specifications

### 4.1 Master Catalog RPCs
1. `admin_manage_master_gear`: Admin CRUD with permanent delete.
2. `admin_manage_master_food`: Admin CRUD with permanent delete.
3. `admin_delete_master_responsibility`: Safe deletion—deletes row if unused in historical trips; soft-retires (`active = FALSE`) if referenced.

### 4.2 Trip Logistics & Commitments Endpoints
1. `seed_trip_commitments_from_master(p_trip_id UUID)`:
   - Invoked on trip creation.
   - Copies active `master_gear` and `master_food_groceries` into `trip_commitments` with `is_active = TRUE`.
2. `update_trip_commitment_status(p_commitment_id UUID, p_is_active BOOLEAN)`:
   - Admin unchecks/checks items for this trip.
3. `submit_member_deposit(p_trip_id UUID)`:
   - Sets `deposit_status = 'submitted_by_member'` and `deposit_submitted_at = now()`.
   - If attendee is the assigned `cabin_payer_member_id`, automatically resolves to `'exempt'`.
4. `verify_member_deposit(p_trip_id UUID, p_member_id UUID, p_status TEXT)`:
   - Admin confirms receipt of $50 deposit (`deposit_status = 'confirmed_by_admin'`).

---

## 5. Mobile-First QA & Verification Strategy

As required by **AGENTS.md Rule 10 (Mandatory Browser QA Certification Gate)**:
1. **Automated Playwright Suite (`npm run test:e2e`)**:
   - Must run across **Desktop Chromium**, **iPhone-sized Mobile WebKit**, and **Android-sized Mobile Chromium**.
   - Must verify form persistence after `page.reload()` for:
     - Master Catalog item creation, edit, filter, and delete.
     - Trip item exclusion/inclusion toggling.
     - Attendee RSVP + "I Have Sent $50" deposit submission.
     - Daily chores selection (2.0x target reached, greying out remaining chores, and swapping).
     - Shared expense creation with participant checkboxes and attendee names.
2. **Viewport Responsiveness**:
   - Verify `scrollWidth <= innerWidth` across mobile viewports (no horizontal overflow).
   - Minimum 44×44px touch targets for chore checkboxes, deposit buttons, and volunteer claims.
3. **Unit & Database Tests**:
   - Run via `npm test` across all 200+ unit, integration, and security tests.

---

## 6. Migration & Rollout Plan

1. **Step 1: Database Migration**:
   - Create migration `20261020140000_master_catalogs_and_deposit_status.sql`.
   - Seed default master camping gear and groceries.
2. **Step 2: API & Edge Function Updates**:
   - Update `trip-api` and RPC boundaries.
3. **Step 3: Frontend Implementation**:
   - Implement `frontend/src/pages/MasterCatalogPage.tsx`.
   - Refactor `frontend/src/pages/EventDetailsPage.tsx` to Option A "My Trip Hub".
   - Refactor attendee split checkboxes in `frontend/src/components/trips/TripFinancialsTab.tsx`.
4. **Step 4: Verification Gate**:
   - Full test run (`npm test` and `npm run test:e2e`) across all three target devices.
