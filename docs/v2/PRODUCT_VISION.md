# Camping Club 2.0 — Product Vision & Core Architecture

## 1. Executive Summary

Private Camping Club is a personal, private web application used by a tight-knit community of friends to coordinate monthly camping trips across California state and regional parks. 

Over its initial release (Camping Club 1.0), the platform successfully established robust, server-authoritative capabilities spanning:
- Member registration, multi-role access control (`member`, `accountant`, `admin`), and profile management.
- A 7-site rolling campsite rotation and annual scheduling calendar.
- Binary RSVP (`Going` / `Not Going`), capacity management, and automatic waitlisting.
- The Camping Constitution, complete with versioned rule bundles and immutable cryptographic acknowledgment audits.
- Pre-trip cabin bookings, contractual cancellation buffers, and non-refundable attendee deposits ($50).
- Chore assignment, meal scheduling, daily workload balance (2.0× target per camping day), and dedicated carpool driver duties.
- Individual packing checklists and shared group gear/grocery commitments.
- Carpool coordination with seat capacities and departure schedules.
- Signature group activities (e.g., Monterey GoCar tours), voucher tracking, tour operator call sheets, and waiver compliance.
- Itemized expense tracking and deterministic, exact-cent financial settlement calculations.

**The challenge in 1.0 is usability and cognitive overload, not missing functionality.** 
Members report that navigating across six sprawling tabs to understand what they need to do is overwhelming. Administrators report having to visit multiple separate screens to manually verify whether an upcoming trip is ready.

**Camping Club 2.0 evolves the application into an action-oriented personal camping assistant without rewriting the proven backend or altering persistent business state.**

---

## 2. Core Architectural Principle

> **"Do not build a new application. Build a new navigation, prioritization, and explanation layer on top of the existing application."**

Camping Club 2.0 is an evolutionary UX, navigation, and decision-support layer. It strictly adheres to the following boundaries:
1. **Zero Business State Duplication:** The new layer does not create a parallel "pending tasks" or "alerts" database table. All action items, health statuses, and exception counts are purely derived projections calculated dynamically from authoritative PostgreSQL records.
2. **Preserve 100% of Existing Capabilities:** Not a single feature, catalog, administrative control, or audit record from 1.0 is retired or lost.
3. **Strict Financial & Security Invariants:** All financial calculations remain in integer cents. Row Level Security (RLS) is maintained with security invoker policies. Sensitive payment handles remain encrypted in the non-exposed `private` schema.
4. **Isolated Development:** All 2.0 work is conducted in an isolated Git worktree (`/Users/veerrajuamanchi/camping-club-v2`) on `feature/camping-club-v2`, targeting the staging database project until formal Gate 5 production authorization.

---

## 3. User Personas & Experience Goals

### Persona A: The Club Member
- **Mental Model:** *"I want to know if I'm going, and exactly what I need to do next to be ready."*
- **1.0 Friction:** Must click through Overview, Logistics, Tasks & Meals, Activities, and Financials to discover whether they still owe a chore, need to pay a deposit, or need to complete a waiver.
- **2.0 Experience:** 
  - Opens the app on their phone and immediately sees upcoming trips in chronological order.
  - Sees their RSVP status and a single, crystal-clear next action:  
    *`⚡ Required From You: 1 chore commitment needed before Nov 01 · [Choose Chore]`*
  - Opening the trip reveals four consolidated destinations (`Overview`, `Prepare`, `Activities`, `Payments`).
  - The `Prepare` destination groups all logistics into 3 clean, expandable cards with default summaries (`1 of 2 credits · 1 action required`, `Carpool assigned · Departure 3:30 PM`, `2 shared items claimed · Packing 5/7`).

### Persona B: The Trip Administrator
- **Mental Model:** *"I want an exception-management assistant that tells me what requires operational intervention."*
- **1.0 Friction:** Must manually inspect attendance rosters, financial ledgers, chores tables, and waiver lists across multiple views to detect missing items.
- **2.0 Experience:** 
  - Opens **Admin Operations** and immediately sees prioritized exceptions grouped by trip and severity:  
    *`November Monterey Camping: 1 cabin deadline warning, 2 deposits awaiting verification, 3 members missing responsibilities, 1 waiver unverified.`*
  - Every exception features a full-width, single-click action button that navigates directly to the exact drawer or modal needed to resolve it.
  - Maintains a dedicated **Admin Configuration** master hub to manage the Constitution, Campsite Directory, Responsibilities, Gear, Groceries, Activities, Schedule Defaults, and Member Directory.

### Persona C: The Club Accountant
- **Mental Model:** *"I want to know which pre-trip deposits need verification and which post-trip settlements require reconciliation."*
- **1.0 Friction:** Bank transfers take place outside the platform (Zelle/Venmo), requiring tedious back-and-forth cross-checking against the participant list.
- **2.0 Experience:**
  - Dedicated financial queues for unverified $50 cabin deposits.
  - Post-trip settlement review displaying the finalized transfer graph, individual member net balances, and `[Confirm Received]` reconciliation tools.

---

## 4. Key Performance Indicators & Anti-Goals

### Success Metrics
1. **Time-to-Next-Action:** Members can identify and navigate to their highest-priority incomplete task within 5 seconds of opening the application.
2. **Zero Information Scavenging:** 100% of administrative exceptions (deadlines, missing deposits, vacant critical chores, unverified waivers) are surfaced on the Admin Operations dashboard without opening individual trip sub-tabs.
3. **Mobile Usability:** Zero horizontal scroll overflow (`scrollWidth <= innerWidth`) on iPhone Safari and Android Chrome across all views, with minimum 44px touch targets.
4. **Data Durability & Integrity:** 100% of form edits persist to Supabase PostgreSQL and remain fully intact after a hard browser reload (`page.reload()`).

### Explicit Anti-Goals
- **No Parallel State Machines:** Never create a separate database table to store derived action items or trip health flags.
- **No Loss of Catalogs:** Never merge or remove the Master Constitution, Campsite Directory, Responsibilities Catalog, Camping Gear Catalog, Groceries Catalog, or Master Activities.
- **No Unsanitized Staging Copy:** Never copy raw production member PII, Supabase Auth tokens, or encrypted payment handles into the staging environment.
- **No Monolithic Scrolling:** Never replace multiple tabs with a single, endless 10-page scrolling screen. Expandable accordions with concise default summaries must be used.
