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
| `ACT-MEM-RESP` | Complete Responsibility Credits | `high` · `action_required` | RSVP is `going`, remaining credits > 0 (Quota - Claimed - DriverCredits) | "You have {earned} of {required} credits. Earn {remaining} more credit(s)." | `/trips/:tripId?tab=prepare&section=duties` |
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

## 4. Workload Credit & Driver Bonus Evaluation Logic

A critical enhancement in Camping Club 2.0 is that responsibility progress is evaluated on **Workload Credits Remaining**, not simply a count of chores:

$$\text{Credits Remaining} = \max\left(0, \text{Required Credits} - \sum \text{Duty Weights} - \text{Driver Bonus}\right)$$

- **Duty Weights:** Standard tasks carry 1 credit; intensive kitchen/cleanup tasks carry 2 credits.
- **Driver Bonus:** A confirmed driver transporting 3 or more campers receives **+1 Workload Credit**, directly reducing their required chore burden.
- **UI Display Rule:** The Prepare accordion displays:  
  *`1 of 2 credits · 1 action required`*  
  *(Never display "1 of 2 chores" if credit weights or driver bonuses are active).*

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
