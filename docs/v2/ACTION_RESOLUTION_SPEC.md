# Camping Club 2.0 — Derived Action Resolution Service Specification

## 1. Architectural Philosophy & Guiding Constraints

The **Action Resolution Service** is a pure, functional TypeScript domain evaluation layer. It calculates outstanding tasks, reminders, and exceptions dynamically from authoritative database records in memory.

### Core Invariants
1. **Zero Database State Duplication:** The service never writes to a "pending_actions" or "alerts" table. Business state lives solely in authoritative domain tables (`trip_rsvps`, `cabin_deposit_records`, `trip_duty_assignments`, `trip_activity_participants`, etc.).
2. **Deterministic Evaluation:** Given the same user identity and database snapshot, the service produces identical, ordered action lists.
3. **Multi-Consumer Consistency:** The same underlying engine powers:
   - Calendar Landing Cards (Trip-level single Next Action callout).
   - Event Overview (Trip-level pending actions with individual deep-links).
   - My Actions Hub (Global cross-trip personal task list).
   - Admin Operations (Cross-trip exception dashboard).
4. **Explainability & Privacy:** Every action item answers: *What is required? Why am I seeing this? When is it due? Where do I go to resolve it?* Private financial handles or sensitive records of peers are never leaked in reasons or descriptions.

---

## 2. TypeScript Interfaces & Data Contracts

```typescript
export type ActionPriority = "critical" | "high" | "normal" | "info";

export type InformationLevel = 
  | "action_required"      // User must act to maintain status or unblock trip
  | "review_recommended"    // User should review, but not strictly blocking
  | "informational";       // Awareness only (e.g. packing list ready)

export type ActionAudience = "member" | "admin" | "accountant";

export interface ActionItem {
  id: string;                      // Deterministic ID: `${ruleId}:${tripId}:${entityId}`
  ruleId: string;                  // Canonical rule identifier (e.g. ACT-MEM-RESP)
  tripId?: string;                 // Linked trip ID (if trip-scoped)
  memberId?: string;               // Target member ID
  
  title: string;                   // Concise imperative title (e.g. "Select Responsibility")
  reason: string;                  // Clear explanation of why action exists
  explanationDetails?: string;     // Contextual breakdown (e.g. "1 of 2 credits earned")
  
  priority: ActionPriority;        // Priority ordering
  informationLevel: InformationLevel;
  audience: ActionAudience;
  
  dueAt?: string;                  // ISO timestamp of deadline (if applicable)
  actionUrl: string;               // Deep link to exact resolution UI drawer/tab
  
  sourceType: string;              // Table name (e.g. "trip_duty_assignments")
  sourceId: string;                // Primary key of source record
  
  completionCondition: string;     // Evaluated condition that clears the action
}
```

---

## 3. Authoritative Action Rules Catalog

### A. Member Action Rules

| Rule ID | Title | Priority & Level | Eligibility & Source | Reason & Explanation | Resolution Destination |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `ACT-MEM-RSVP` | Submit Trip RSVP | `critical` · `action_required` | Member has not RSVP'd for upcoming trip; Cutoff > now | "Registration closes on {pollDeadlineAt}. Your attendance determines cabin capacity." | `/trips/:tripId?tab=overview` |
| `ACT-MEM-CONST` | Acknowledge Camping Constitution | `critical` · `action_required` | RSVP is `going`, but active Constitution bundle not acknowledged | "Constitution version {version} ({hash}) requires signed acknowledgment." | `/trips/:tripId?tab=overview&action=sign-constitution` |
| `ACT-MEM-DEP` | Submit $50 Cabin Deposit | `high` · `action_required` | RSVP is `going`, trip confirmed, deposit status `unsubmitted` | "The $50 non-refundable cabin deposit is due to the cabin host ({hostName})." | `/trips/:tripId?tab=payments&action=submit-deposit` |
| `ACT-MEM-RESP` | Complete Daily Responsibilities | `high` · `action_required` | RSVP is `going`, any camping day has claimed weight < 2.0× target | "{unmetDayCount} day(s) need duty selections ({unmetDayDates}). Target is 2.0× weight per day." | `/trips/:tripId?tab=prepare&section=duties` |
| `ACT-MEM-VOUCH` | Enter Activity Voucher Code | `normal` · `review_recommended` | Opted into activity requiring vouchers; voucher status `missing` | "Voucher redemption code required for {activityName} tour operator." | `/trips/:tripId?tab=activities&action=enter-voucher` |
| `ACT-MEM-WAIV` | Sign Tour Operator Waiver | `critical` · `action_required` | Opted into activity; waiver status `none` or `unsubmitted` | "Tour operator requires a signed liability waiver before departure." | `/trips/:tripId?tab=activities&action=sign-waiver` |
| `ACT-MEM-SETTLE-SEND` | Send Settlement Transfer | `high` · `action_required` | Finalized settlement run exists; member has net negative balance; transfer `pending` | "Settlement finalized for {monthKey}. Please send ${amount} to {recipientName}." | `/trips/:tripId?tab=payments&action=mark-sent` |
| `ACT-MEM-SETTLE-RECV` | Confirm Settlement Received | `normal` · `action_required` | Finalized settlement run; member is payee; transfer status `sent` | "{senderName} marked transfer of ${amount} as sent. Please confirm receipt." | `/trips/:tripId?tab=payments&action=confirm-received` |

### B. Administrator & Accountant Action Rules

| Rule ID | Title | Audience | Priority & Level | Reason & Explanation | Resolution Destination |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `ACT-ADM-APPV` | Review Access Request | `admin` | `high` · `action_required` | "New user {name} ({email}) requested access to Private Camping Club." | `/admin/members?filter=pending` |
| `ACT-ADM-DEP-VERIF` | Verify Cabin Deposit | `accountant` | `normal` · `action_required` | "{memberName} submitted $50.00 deposit via {method}. Awaiting verification." | `/trips/:tripId?tab=payments&action=verify-deposit&depositId={id}` |
| `ACT-ADM-WAIV-VERIF` | Verify Operator Waiver | `admin` | `high` · `action_required` | "{memberName} self-reported signing waiver. Needs confirmation on call sheet." | `/trips/:tripId?tab=activities&action=call-sheet` |
| `ACT-ADM-WAITLIST` | Promote Waitlisted Camper | `admin` | `normal` · `action_required` | "Spot opened up on {tripName}. {memberName} is #1 on waitlist." | `/trips/:tripId?tab=overview&action=manage-roster` |
| `ACT-ADM-CUTOFF` | Approaching Cutoff (Below Minimum) | `admin` | `critical` · `action_required` | "Trip has {confirmed} RSVPs (minimum {min}). Cutoff in {days} days." | `/trips/:tripId?tab=overview&action=trip-controls` |
| `ACT-ADM-CABIN-CANCEL` | Cabin Cancellation Buffer Warning | `admin` | `critical` · `action_required` | "Contractual cabin cancellation deadline is {date} (5 days remaining)." | `/trips/:tripId?tab=overview&action=trip-controls` |
| `ACT-ADM-SETTLE-FINAL` | Finalize Trip Settlement | `admin` | `normal` · `action_required` | "Trip ended on {endsOn}. All expenses submitted; ready for finalization." | `/trips/:tripId?tab=payments&action=finalize-settlement` |

---

## 4. Authoritative Daily Workload Evaluation Logic

In Camping Club 2.0, member responsibility satisfaction is strictly evaluated on **Daily Workload Weights**, evaluated independently for each calendar date of the trip:

### Core Rules
1. **Default Requirement:** Every attendee must satisfy **`2.0×` workload weight for each camping day** by default.
2. **Multi-Day Evaluation:** For a 3-day trip spanning dates $[d_1, d_2, d_3]$, each day is independently checked:
   $$\text{Status}(d) = \begin{cases} 
     \text{satisfied} & \text{if } \sum_{i \in \text{claimed}(d)} \text{weight}(i) \ge 2.0 \\
     \text{needs\_selection} & \text{otherwise} 
   \end{cases}$$
   All 3 daily targets must be satisfied for the member's responsibilities to be complete (totaling $6.0\times$ across the trip).
3. **Carpool Driver Architecture:**
   - **Inbound Driver:** Assigned to the arrival day with configured weight (currently `2.0×`), satisfying that day's target.
   - **Outbound Driver:** Assigned to the departure day with configured weight (currently `2.0×`), satisfying that day's target.
   - Each driver duty contributes its weight **only toward the daily target of the specific day to which it is assigned**. There is no special multi-day credit offset or synthetic driver calculation.
4. **Removal of Redundant Driver Credits UI:**
   - The separate *"🚗 Approved Driver Credits / Grant Driver Credit"* UI section is completely removed. Carpool driving is claimed directly from the schedule as a standard $2.0\times$ duty. Historical database records (`trip_driver_credits`) and audit trails are preserved in PostgreSQL.
5. **UI Summary Format:**
   - Landing Cards: If all days are satisfied, renders `✓ Responsibilities Complete (All days met)`. If any day is deficient, renders the specific day: `⚡ Saturday duty needed (2.0× target) · [Choose Saturday Duty]`.
   - Prepare Accordion: Displays total progress and daily breakdown:  
     *`Responsibilities & Meals: 6.0× of 6.0× weight met · All 3 days covered`* (or *`4.0× of 6.0× met · Saturday needs 2.0×`*). Never displays legacy raw counts like "5 of 2 chosen".

---

## 5. Multi-Link Resolution & Contextual Routing

When an action summary evaluates multiple pending items spanning different destinations:
1. **Never use a single generic button:** If a member owes both a chore (Prepare) and a waiver (Activities), the UI must not use a single button labeled "Prepare".
2. **Dual-Link Resolution:**
   - In **Event Overview**, the banner renders individual functional links:  
     `⚡ 2 items need your attention: [Choose Chore →] · [Sign GoCar Waiver →]`
   - In **Landing Cards** (where space is limited), the card renders the single highest-priority action, accompanied by a count badge:  
     `⚡ Required: Sign GoCar Waiver · (+1 more item) · [Resolve Now]`
   - Clicking `(+1 more item)` navigates directly to `/actions` (My Actions Hub).

---

## 6. Strict State Semantics Preservation

The service preserves the exact semantic definitions established in 1.0:

### Financial Semantics
- **`unsubmitted`:** Member has not initiated or sent payment.
- **`submitted`:** Member marked payment sent (or provided transfer notes), but host/accountant has not verified bank funds. **Does NOT constitute confirmed receipt.**
- **`verified`:** Accountant or assigned host verified cash in bank. Fully locks in attendee cabin contribution.

### Waiver Semantics
- **`none`:** Member has not taken action.
- **`member_signed`:** Member clicked external operator link and self-reported completion. **Does NOT constitute certified compliance.**
- **`operator_verified`:** Admin or Tour Lead confirmed signature on the official tour operator call sheet roster.
