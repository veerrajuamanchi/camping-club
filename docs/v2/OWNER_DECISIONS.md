# Camping Club 2.0 — Canonical Register of Owner Decisions

## 1. Governance & Boundary Rules

In accordance with Section 2 of `AGENTS.md`:
- A recommendation in an artifact is **not** an owner decision.
- This document is the canonical register of resolved and unresolved business, financial, UX, and operational choices.
- Agents must never turn recommendations into policy without explicit, dated owner approval.
- If a business rule remains unresolved, the system must **preserve state for human administrator review** and block the affected automated transition rather than inventing a policy.

---

## 2. Resolved Architectural & UX Decisions (Approved for 2.0)

| Decision ID | Date Approved | Topic | Owner Decision & Preserved Implementation |
| :--- | :--- | :--- | :--- |
| `DEC-2026-10-25-01` | 2026-10-25 | **Evolutionary Approach** | Evolve the existing application by building a navigation, prioritization, and explanation layer. **Do not create a greenfield rewrite.** |
| `DEC-2026-10-25-02` | 2026-10-25 | **Landing Card Layout** | Shorten the campsite hero image to a compact banner (95px) using authentic Campsite Directory photos. Display trip dates, RSVP quick-toggle, attendance badge, and a single derived Next Action pill above the fold. Move registration deadline to its own row. |
| `DEC-2026-10-25-03` | 2026-10-25 | **Event Details Navigation** | Consolidate the six 1.0 tabs into **four clear destinations**: `Overview`, `Prepare`, `Activities`, and `Payments`. Render as a responsive 2×2 grid on mobile viewports so `Payments` is never hidden. |
| `DEC-2026-10-25-04` | 2026-10-25 | **Prepare Structure** | Organize Prepare into **three independently expandable accordion cards**: (1) Responsibilities & Meals, (2) Transportation & Carpools, (3) Gear, Groceries & Packing. Each card must show a default status summary when collapsed. |
| `DEC-2026-10-25-05` | 2026-10-25 | **Action Resolution Engine** | Build a shared, derived TypeScript evaluation engine over existing PostgreSQL tables. **Never create a parallel pending-actions database.** |
| `DEC-2026-10-25-06` | 2026-10-25 | **Daily Workload Requirement** | The default workload requirement is **2.0× per attendee per camping day, independently evaluated across every day of the trip**. For a 3-day event (e.g. Fri, Sat, Sun), each camper must satisfy 2.0× on Friday, 2.0× on Saturday, and 2.0× on Sunday (totaling 6.0× across the trip). Progress is tracked by daily workload weight, never raw chore counts. |
| `DEC-2026-10-25-07` | 2026-10-25 | **Carpool Driver Responsibilities Architecture** | Inbound Driver is assigned to the arrival day (e.g. Friday) and Outbound Driver is assigned to the departure day (e.g. Sunday). Each driver responsibility has its own configured workload weight (currently 2.0×) and contributes its weight **only toward the daily workload target of the specific day to which it is assigned**. No special multi-day driver-credit allocation or synthetic credit offset exists. |
| `DEC-2026-10-25-08` | 2026-10-25 | **Removal of Redundant Driver Credits UI** | The redundant *"🚗 Approved Driver Credits / Grant Driver Credit"* UI section is completely removed from the Camping Club 2.0 interface. Carpool driving is claimed and managed uniformly as standard weighted responsibilities. Existing historical database records (`trip_driver_credits`) and audit entries are strictly preserved in PostgreSQL. |
| `DEC-2026-10-25-09` | 2026-10-25 | **Multi-Link Action Routing** | If an action summary evaluates multiple pending items spanning different destinations, provide individual direct links or route to My Actions, rather than a misleading single button. |
| `DEC-2026-10-25-10` | 2026-10-25 | **Financial & Waiver Semantics** | Strictly preserve distinct states: `submitted` vs `verified` for $50 deposits; and `member_signed` (self-reported) vs `operator_verified` for activity waivers. |
| `DEC-2026-10-25-11` | 2026-10-25 | **Post-Trip Settlement UX** | Expand Payments to display finalized settlement runs, exact personal net balance, who-owes-whom transfer instructions, `[Mark Sent]`, and `[Confirm Received]` workflows. |
| `DEC-2026-10-25-12` | 2026-10-25 | **Admin Exception Dashboard** | Admin Operations surfaces prioritized exceptions with full-width (min 44px) mobile action buttons directly below the description. |
| `DEC-2026-10-25-13` | 2026-10-25 | **Admin Configuration Hub** | Maintain a dedicated master configuration hub providing uncompromised access to all 8 master catalogs and settings. |
| `DEC-2026-10-25-14` | 2026-10-25 | **Staging Data Isolation** | Test in staging project `rwmizunhxszjvcsaqkre` using **zero raw production PII**. Use synthetic records matching complex real-world state scenarios. |

---

## 3. Canonical Register of Unresolved Policy Decisions

The following choices remain unresolved pending explicit owner determination. The Camping Club 2.0 platform preserves safe fallbacks and blocks automated execution for these specific paths:

### Unresolved Item 1: Minimum Attendance Count Basis
- **The Ambiguity:** Earlier design counted active Coming members only after a confirmed $50 deposit receipt; later design revision counted active Coming RSVPs and requested $50 after trip confirmation. Under the received basis, whether the assigned cabin payer's non-posting booking coverage counts is also open.
- **2.0 Safe Fallback:** The platform **does not hardcode either policy**. At the cutoff deadline, if participation is near the threshold, the system flags an `ACT-ADM-CUTOFF` exception for explicit human administrator review, displaying both counts (`RSVP Count: X` and `Verified Deposit Count: Y`).

### Unresolved Item 2: Pre-Confirmation Deposit Disposition
- **The Ambiguity:** If a trip is cancelled before cutoff due to insufficient participation, what is the exact financial disposition of premature $50 deposits? (Full automated refund vs credit towards next trip vs forfeiture).
- **2.0 Safe Fallback:** The platform **prohibits automated deposit forfeiture or silent balance absorption**. Any receipts collected for a cancelled trip are segregated into an `Audited Admin Disposition Queue` requiring explicit administrator action.

### Unresolved Item 3: Post-Confirmation Club-Initiated Cancellation
- **The Ambiguity:** If the club must cancel a trip post-confirmation due to weather, park closures, or wildfire smoke, how are non-refundable deposits and incurred vendor reservation fees split?
- **2.0 Safe Fallback:** Settlement finalization is **blocked** until an administrator selects an audited cost-sharing policy in the settlement configuration modal.
