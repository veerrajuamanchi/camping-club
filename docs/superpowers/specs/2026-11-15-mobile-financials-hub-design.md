# Mobile Financials Hub & Responsive Settlement UX Design

**Date:** 2026-11-15  
**Status:** Approved by Owner  
**Target Platform:** React + TypeScript + Vite (Render Static Web Application)  
**Primary Target Viewports:** Smartphones (iPhone 13–17: 390px–430px; Samsung Galaxy S20–S25: 360px–412px) and Desktop  

---

## 1. Vision & User Intent

Members of the private camping club coordinate expenses, cabin prepayment advances, carpool mileage reimbursements, and external peer transfers (Zelle, Venmo, PayPal, Apple Cash) before, during, and after camping trips. While the platform is a web application, members primarily access it on smartphones at campsites, grocery stores, or immediately after returning home.

Because the club is a trusted group of friends, the mobile experience must satisfy two essential needs:
1. **Frictionless Mobile Ergonomics:** Within five seconds of opening the page on a phone, a member must know their exact settlement position (*"You owe $37.50"* or *"You receive $112.50"*), have a 1-tap action to copy Zelle details or mark as sent, and have an immediate way to record a receipt.
2. **Complete Accounting Transparency:** Friends want to inspect how expenses are shared and calculated. The full **Unified Expense Ledger**, including **Total Share Owed**, **Paid Out-of-Pocket**, and **Net Settlement Position**, must be easily accessible in a dedicated, transparent audit tab.

---

## 2. Core Functional Requirements

### 2.1 Hero Personal Settlement Snapshot (First Screen)
- Rendered at the top of the mobile financials experience for the logged-in member.
- Displays the member's current net settlement position in high-contrast color coding:
  - **Negative Balance (Owes):** Highlighted in light red with amount (e.g. `-$37.50 (You Owe)`).
  - **Positive Balance (Gets Back):** Highlighted in emerald green with amount (e.g. `+$112.50 (Gets Back)`).
  - **Zero Balance (Settled):** Highlighted in slate gray (`$0.00 (Fully Settled)`).
- Subtitle provides an instant reconciliation equation: *"Based on $50.00 deposit paid vs $87.50 total fair share"*.
- **1-Tap Action Pill:** If the member owes money, an immediate action box displays the recipient's name, preferred method (e.g., Zelle), phone number/identifier, and left-aligned buttons:
  - `📋 Copy Details`: Copies phone/identifier to clipboard and provides toast/haptic feedback.
  - `✓ Mark as Sent`: Opens the transfer confirmation modal directly.

### 2.2 Prominent First-Screen "+ Add Shared Expense" Action
- Located directly on the primary first screen (below the Hero snapshot and above navigation pills).
- Strictly visible to confirmed attendees and organizers as long as financials are unlocked (`!isFinalized`). Automatically hides when the settlement is locked by an administrator.
- Tapping opens a mobile-optimized modal / bottom sheet:
  - **Amount Input:** Formatted with `inputmode="decimal"` and large numerical display so mobile devices automatically open the numeric decimal keypad instead of the full text keyboard.
  - **Description:** Concise text field (e.g., *"S'mores kit, firewood, camp groceries"*).
  - **Who Paid:** Defaults to the authenticated user; administrators can select any confirmed attendee from a native picker.
  - **Camera / Receipt Upload:** Uses `<input type="file" accept="image/*,application/pdf" capture="environment">` to allow taking a live photo of paper receipts at grocery checkout or attaching existing photos/PDFs.
  - **Split Mode:** Single-tap toggle between `🌐 All Campers (Equal)` (auto-includes all confirmed attendees) and `👥 Select Campers` (touch-friendly chips).
  - **Full-Width Save Action:** Large 48px touch target: `✓ Save & Recalculate Split`.

### 2.3 4-Tab Segmented Navigation Control
On mobile screens (`< 768px`), tab navigation organizes content into four focused, bite-sized views rather than an overwhelming single vertical scroll:
1. `⚡ Summary`:
   - Hero Personal Snapshot & 1-tap peer payment action.
   - Prominent `+ Add Shared Expense` button.
   - Trip high-level metric cards (Total Cost, Confirmed Campers, Reconciled Transfers).
   - Peer Settle-Up Transfers list (who pays whom).
2. `🧾 Receipts`:
   - Itemized feed of member-submitted shared receipts (S'mores, firewood, drinking water, coolers, groceries).
   - Receipt viewer link (`📄 View Receipt`), edit button, and delete button (for payers/admins).
   - Expandable split drawers showing participating campers.
3. `👥 Campers`:
   - Vertical card roster of all confirmed attendees.
   - Each card displays member name, Total Paid (including deposit breakdown), Fair Share, and a colored Net Balance badge (`Owes $XX.XX` or `+ $XX.XX`).
   - Completely replaces wide horizontal table panning for a quick camper roster check.
4. `📊 Full Ledger` (Complete Transparency Audit):
   - Preserves 100% of the accounting audit data for all friends.
   - Features a sub-view toggle between **Cards** (clean itemized cards for cabin prepayment advance, carpools, website fees, receipts) and **Matrix** (the comprehensive spreadsheet matrix).
   - **Spreadsheet Matrix Slide Ergonomics:**
     - Features a **frozen sticky first column** for Expense Item / Camper Name (`position: sticky; left: 0; z-index: 10;`).
     - As the user slides horizontally across the 12+ attendee columns, the title stays locked on the left.
     - Includes right-edge gradient hint and top swipe indicator (`👈 Slide to view all campers 👉`).
     - Fully preserves the three canonical reconciliation footer rows:
       1. **Camper Fair Share Total** (Total Share Owed)
       2. **Paid Out-of-Pocket**
       3. **Net Settlement Position**

### 2.4 Ergonomics & Button Alignment
- All action button groups (`Copy Details`, `Mark Sent`, `Confirm Received`, `View Receipt`, `Edit`, `Make Custom`, `Delete`) are **left-aligned** directly beneath item descriptions.
- Minimum tap targets: 44px × 44px for thumb accessibility.
- Zero horizontal viewport overflow on mobile (`scrollWidth <= innerWidth`).

---

## 3. Architecture & State Management

- Implemented entirely within `frontend/src/features/trips/TripFinancialsTab.tsx` and accompanying subcomponents.
- Uses existing Supabase backend procedures (`get_trip_financials`, `admin_manage_trip_expense`, `update_settlement_transfer`).
- Preserves all financial safety invariants (exact integer cents, no floating-point arithmetic, immutable finalized runs).
