# Design Specification: Trip Activities, Vehicle Pairings & Master Catalog

**Date:** 2026-10-23  
**Status:** Draft (Awaiting Builder Check & Owner Approval)  
**Target Specification Path:** `docs/superpowers/specs/2026-10-23-trip-activities-and-master-catalog-design.md`  

---

## 1. Intent and Why

During club camping trips, members regularly engage in signature off-site adventures (e.g., Monterey GoCar storytelling tours, American River white water rafting, ATV desert trails, horseback riding). Organizing these activities currently introduces significant coordination friction for administrators and attendees:

1. **Third-Party Deal Coordination:** Direct operator bookings are often expensive (e.g., $328.00 per 2-person GoCar in Monterey), but group voucher deals (e.g., Groupon with coupon code `Halloween` at $174.60) offer massive savings ($153.40 saved per vehicle). However, having 4 different pairs purchase individual vouchers without a unified tracking system results in lost voucher codes, missing security PINs, and chaotic check-in.
2. **Vehicle & Group Pairing:** Activities have fixed physical capacities (e.g., 2 people per GoCar, 2 per tandem kayak, 1 per ATV/horse, 6 per raft). Members need to know clearly who their partner or crew is, without relying on external chat threads.
3. **Admin Call Sheet & Operator Booking:** Operators require all voucher numbers, security PINs, and order references over the phone to confirm multi-vehicle reservations. Admins need a single printable/copyable call sheet.
4. **Attendance & Readiness Clarity:** Not all campers participate in every activity. Campers need an upfront choice in the **⚡ Required From You** readiness scorecard to opt in or opt out (relaxing at the campsite). Opted-out campers must not be assigned vehicles or charged activity expenses.
5. **Reusability via Master Catalog:** Popular activities (like Monterey GoCars or Tahoe Kayaking) should be curated once in a Master Activity Catalog and cloned into future trips with one click.

---

## 2. Goals, Non-Goals, and Anti-Goals

### Goals
- **Master Activity Catalog:** Provide an administrative directory under Master Catalogs to manage template activities with titles, categories, images, locations, default capacities, and booking instructions.
- **Trip Activities (1:many):** Allow trips to schedule multiple activities across a weekend (e.g., Saturday GoCars + Sunday Kayaking), each with independent dates, operating hours, addresses, and directions.
- **Dynamic Ledger & Settlement Integration:** When a purchaser enters their voucher cost (e.g., $174.60), the system automatically logs a shared trip expense in the ledger. The cost dynamically splits equally across all confirmed attendees who have opted in (excluding anyone who opted out). If campers subsequently opt in or out, the dynamic calculation automatically detects the change and updates fair shares.
- **Trip Readiness Scorecard Integration:** Expand the "⚡ Required From You" checklist to include Activity Participation (`Count Me In! 🚗` vs `Opt Out / Stay at Camp 🏕️`) as a standard 5th item.
- **Vehicle & Group Pairings:** Automatically or manually assign opted-in campers into groups matching unit capacity (e.g., 4 cars of 2 for 8 campers).
- **Personalized Rider Badges:** Prominently display who the member is paired with on the card (`✓ You are Riding with <Name>`) instead of an impersonal vehicle index.
- **Voucher & PIN Tracking:** Track Purchase Date, Groupon Order/Ref #, Voucher/Redemption Code, and Security Code/PIN per vehicle. Allow both the purchasing camper and admins to enter/update these fields.
- **Admin Tour Operator Call Sheet:** Provide a consolidated, copyable table summarizing all vehicles, riders, order numbers, voucher codes, and PINs.
- **Partner Protection & Swap Workflow:** By default (Option A), once a vehicle's voucher is purchased, its spot is locked to protect the purchasing partner; members who withdraw remain responsible for their fair share unless replaced. Admins can configure flexible opt-out (Option B) per activity. Mutual partner swaps are supported for pending vehicles with full admin override.

### Non-Goals
- **In-App Money Transfer:** Campers purchase vouchers directly on external platforms (Groupon, operator websites) or settle balances peer-to-peer (Zelle/Venmo). The app does not process credit cards or hold funds.
- **Automated Tour Operator API Integration:** No scraping or proprietary booking API bots for Groupon or tour vendors. The platform collects vouchers and provides a human-readable call sheet for admin booking.
- **Real-Time GPS Vehicle Tracking:** The app does not track vehicles on the road during the activity.

### Anti-Goals
- **Never auto-charge or assign opted-out campers:** Campers who opt out must never be assigned to a vehicle or assigned a fair share obligation for that activity.
- **Never lose purchased voucher details on roster shuffle:** If campers swap partners or the admin reassigns riders, voucher codes and order numbers remain securely anchored to the vehicle/booking record.

---

## 3. Constraints & Architecture Alignment

- **Database & RLS (Supabase PostgreSQL):**
  - Strictly enforce Row Level Security.
  - Active members can view trip activities and their assigned groups.
  - Participants assigned to a group can enter/edit their group's voucher details.
  - Only administrators can create/edit activities, force-reassign pairings, or lock activity rosters.
- **API Boundary (Supabase Edge Functions):**
  - Endpoints routed via `trip-api` using strict Zod schemas and transactional Postgres RPCs (`phase6_manage_activity`, `phase6_submit_voucher`, `phase6_request_swap`).
  - No client-side direct writes to activity or pairing tables.
- **Frontend (React + Vite + Render Static Site):**
  - Seamlessly integrate with the existing Trip Hub design language (Overview, Tasks & Meals, Activities, Expenses).
  - Responsive across Desktop Chromium, iPhone Mobile WebKit, and Android Mobile Chromium without horizontal scroll overflow.
- **Automated Testing:**
  - Unit tests in Vitest for components and RPC mocks.
  - pgTAP tests in PostgreSQL for RLS and RPC constraints.
  - Playwright browser acceptance tests verifying full persistence after `page.reload()`.

---

## 4. User Experience & Screen Workflows

### 4.1 Master Activity Catalog (Admin Directory)
- Located at `/admin/catalogs` under a new **Activities** sub-tab alongside Responsibilities and Packing Items.
- Admins can create template activities:
  - Title (e.g. *Monterey GoCar Full-Day Tour*)
  - Category (e.g. *Sightseeing / Driving*, *Water Sports*, *Hiking*, *Adrenaline*)
  - Default Image URL
  - Location Name & Address
  - Directions / Maps URL
  - Unit Capacity (1 = Solo, 2 = Pair/Tandem, 4 = Cart/Group, 6+ = Raft)
  - Booking & Deal Notes Template (e.g. Groupon coupon instructions)

### 4.2 Adding an Activity to a Trip
- In the Trip Hub, under the **🎯 Activities** tab, an admin clicks `+ Add Activity`.
- Options:
  1. *Clone from Master Catalog* (pre-fills all fields)
  2. *Create Custom Activity*
- Configures trip-specific details:
  - Activity Date (e.g. Saturday, Aug 14, 2027)
  - Start Time & End Time (e.g. 10:00 AM – 5:00 PM)
  - Specific meeting address & notes

### 4.3 Trip Readiness Scorecard: Standard 5-Item Checklist
- **Scorecard Contract:** Trips always include at least one activity, making the **⚡ Required From You** checklist 5 items standard:
  1. RSVP Status (Going)
  2. $50 Cabin Deposit (Confirmed)
  3. Daily Chores Workload (Target Reached)
  4. Meals & Drinks Preferences (Coffee, Meal, Alcohol)
  5. **🎯 Activity Participation (Action Needed / Responded)**
- For each scheduled activity, members choose their participation:
  - *"🎯 Saturday Activity: Monterey GoCar Full-Day Tour (~$87.30 via Groupon) — Choose Participation"*
  - Buttons: `[✓ Count Me In! (Ride 🚗)]` or `[Opt Out (Stay at Camp 🏕️)]`
- Responding completes the 5th item, bringing readiness to 100% (5 of 5 completed).
- Campers who opt out appear in a distinct *"🏕️ Staying at Campsite (Opted Out)"* section on the activity screen and are excluded from vehicle pairing and expense splitting.

### 4.4 Vehicle & Group Pairings
- Based on unit capacity (e.g. 2 per car), the platform structures the participating roster into vehicles (Car #1, Car #2, Car #3, Car #4).
- The admin can click `👥 Manage Pairings` to drag-and-drop or select camper assignments.
- An `🎲 Auto-Shuffle` button pairs up unassigned campers automatically.

### 4.5 Personalized Rider Badges
- Campers see their personal pairing prominently:
  - 2-Person Ride: **`✓ You are Riding with Veerraju Amanchi (Car #1)`**
  - Multi-Person Ride: **`✓ You are in a group with Veerraju, Manmohan & Srini (Raft #1)`**
  - Opted Out: **`🏕️ Opted Out (Relaxing at Camp)`**

### 4.6 Voucher Entry & Automatic Dynamic Ledger Entry
- Each vehicle card shows the voucher status: `⏳ WAITING` or `✓ READY`.
- Either rider in that car (or an admin) clicks `🎟️ Enter Voucher Details` to open a modal with 6 fields:
  1. **Purchase Date** (date picker)
  2. **Purchaser** (select self or partner)
  3. **Amount Paid ($ USD)** (e.g. `$174.60` -> `17460` integer cents)
  4. **Groupon Order / Reference Number** (e.g. `10842918-01`)
  5. **Redemption / Voucher Code** (e.g. `GP-998234-A`)
  6. **Security Code / PIN** (e.g. `4819`)
- **Automatic Ledger Posting:** When submitted, the system automatically posts or updates a corresponding record in `trip_expenses` paid by the purchaser with `split_mode = 'all_attendees'` dynamically restricted to campers attending the activity (all confirmed attendees minus anyone who opted out).
- **Dynamic Re-splitting:** If another camper opts in or opts out later, or joins the trip, the dynamic calculation engine detects the change and automatically re-splits the fair shares across the active participants.
- **Privacy & Security Boundary:** Vehicle pairing and status (`✓ Ready`) are visible to all confirmed trip attendees. However, sensitive voucher credentials (the Voucher Code and Security PIN) are visible in plain text only to that car's assigned riders and administrators. Other campers see the vehicle pairing and status only.

### 4.7 Admin Tour Operator Call Sheet
- A dedicated view accessible via `[📞 Tour Operator Call Sheet]`.
- Displays a clean table:
  - Vehicle / Unit #
  - Assigned Campers & Designated Purchaser
  - Purchase Date
  - Groupon Order #
  - Voucher / Redemption Code
  - Security Code / PIN
  - Status (`✓ Ready` vs `⏳ Waiting`)
- Includes a `📋 Copy All to Clipboard` button formatted for easy phone reading.

### 4.8 Mutual Partner Swap Workflow & Restrictions
- A camper clicks `[🔄 Request Partner Swap]` on their car card.
- Selects the target camper they want to trade with.
- The target camper receives an in-app banner with `[Accept Swap ✓]` and `[Decline]`.
- If accepted, the pairing tables update atomically.
- **Voucher Lockout:** If a voucher has already been entered (`voucher_status = 'purchased'` or `'verified'`) for either vehicle, camper-initiated swaps are disabled with a clear notice: *"A voucher has already been purchased for this car. Please coordinate with an admin to adjust pairings."*
- **Admin Override:** Administrators can force-reassign any camper directly or click `[🔒 Lock Pairings]` once operator booking is confirmed.

### 4.9 Opt-Out Lifecycle & Partner Protection Policy
- **Default Policy (Option A — Partner Protection):** Once a voucher has been purchased for a vehicle, that vehicle's pairing is locked. If a camper subsequently attempts to opt out (or cancels their overall trip RSVP), the system warns them that the vehicle spot is committed; they remain responsible for their fair share ($87.30) to their car partner unless a replacement camper from the roster or waitlist claims their seat.
- **Configurable Flexibility (Option B):** Administrators can toggle the activity policy to `flexible` if the operator permits free cancellations or solo riders, allowing opt-outs at any time with manual admin reassignment.

---

## 5. Technical Architecture & Database Schema

### 5.1 Tables

```sql
-- 1. Master Activity Catalog
CREATE TABLE public.master_activities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'other',
    image_url TEXT,
    location_name TEXT,
    address TEXT,
    directions_url TEXT,
    unit_label TEXT NOT NULL DEFAULT 'Vehicle', -- e.g. Car, Kayak, Raft, Horse
    unit_capacity INTEGER NOT NULL DEFAULT 2,   -- e.g. 2 per GoCar
    booking_notes TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Trip Activities
CREATE TABLE public.trip_activities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trip_id UUID NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
    master_activity_id UUID REFERENCES public.master_activities(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'other',
    image_url TEXT,
    activity_date DATE NOT NULL,
    start_time TIME WITHOUT TIME ZONE,
    end_time TIME WITHOUT TIME ZONE,
    location_name TEXT,
    address TEXT,
    directions_url TEXT,
    unit_label TEXT NOT NULL DEFAULT 'Vehicle',
    unit_capacity INTEGER NOT NULL DEFAULT 2,
    booking_notes TEXT,
    opt_out_policy TEXT NOT NULL DEFAULT 'locked_on_voucher' CHECK (opt_out_policy IN ('locked_on_voucher', 'flexible')),
    is_pairings_locked BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Activity Participation (Opt-In / Opt-Out)
CREATE TABLE public.trip_activity_participants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    activity_id UUID NOT NULL REFERENCES public.trip_activities(id) ON DELETE CASCADE,
    member_id UUID NOT NULL REFERENCES public.members(id) ON DELETE RESTRICT,
    status TEXT NOT NULL CHECK (status IN ('attending', 'opted_out')),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (activity_id, member_id)
);

-- 4. Activity Groups / Vehicles
CREATE TABLE public.trip_activity_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    activity_id UUID NOT NULL REFERENCES public.trip_activities(id) ON DELETE CASCADE,
    group_number INTEGER NOT NULL,
    group_name TEXT, -- e.g. 'Car #1 (Yellow)'
    purchaser_member_id UUID REFERENCES public.members(id) ON DELETE SET NULL,
    purchase_date DATE,
    amount_cents INTEGER DEFAULT NULL,
    expense_id UUID REFERENCES public.trip_expenses(id) ON DELETE SET NULL,
    order_reference_number TEXT,
    voucher_code TEXT,
    security_pin TEXT,
    voucher_status TEXT NOT NULL DEFAULT 'pending' CHECK (voucher_status IN ('pending', 'purchased', 'verified')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (activity_id, group_number)
);

-- 5. Activity Group Members (Assignments)
CREATE TABLE public.trip_activity_group_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id UUID NOT NULL REFERENCES public.trip_activity_groups(id) ON DELETE CASCADE,
    member_id UUID NOT NULL REFERENCES public.members(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (group_id, member_id)
);

-- 6. Partner Swap Requests
CREATE TABLE public.trip_activity_swap_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    activity_id UUID NOT NULL REFERENCES public.trip_activities(id) ON DELETE CASCADE,
    requester_member_id UUID NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
    target_member_id UUID NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at TIMESTAMPTZ
);
    UNIQUE (group_id, member_id)
);

-- 6. Partner Swap Requests
CREATE TABLE public.trip_activity_swap_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    activity_id UUID NOT NULL REFERENCES public.trip_activities(id) ON DELETE CASCADE,
    requester_member_id UUID NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
    target_member_id UUID NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at TIMESTAMPTZ
);
```

### 5.2 RLS & Security Policies
- `master_activities`: Readable by authenticated members; writable only by admins.
- `trip_activities`: Readable by trip confirmed attendees/members; writable only by admins.
- `trip_activity_participants`: Members can insert/update their own status; admins can manage all.
- `trip_activity_groups`: Readable by trip attendees. Update of voucher fields permitted for assigned group members or admins. Group creation/deletion by admins only.
- `trip_activity_group_members`: Readable by trip attendees. Direct writes restricted to trusted RPCs (`phase6_manage_activity_pairings`).
- `trip_activity_swap_requests`: Requester can create/cancel; target member can accept/decline; admins can resolve.

---

## 6. What's Left to the Builder

- Exact PostgreSQL migration script naming (`20261024...`).
- Writing pure database functions and security-invoker RPC boundaries.
- Creating the `ActivityTab.tsx` component hierarchy and integrating the 5th item in `TripOverviewTab.tsx` / `RequiredFromYou.tsx`.
- Implementing the Master Catalog sub-tab under `/admin/catalogs`.
- Comprehensive Vitest unit tests covering edge cases (odd attendee counts, 1-person vehicles, opt-out toggling).
- Playwright E2E browser acceptance suite verifying reload persistence on Desktop Chromium, iPhone Mobile WebKit, and Android Mobile Chromium.
