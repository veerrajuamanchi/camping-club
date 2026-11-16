# Mobile Financials Hub & Responsive Settlement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the web financials tab on phone viewports into a fast, thumb-friendly 4-tab mobile hub with a personal Hero snapshot, prominent first-screen Add Expense action with native camera capture, left-aligned action buttons, vertical camper cards, and a dedicated Full Ledger audit tab with smooth horizontal sliding.

**Architecture:** Extend `TripFinancialsTab.tsx` with responsive layout segmentation: on viewports under 768px, render a Hero Personal Snapshot, a 4-tab pill selector (`⚡ Summary`, `🧾 Receipts`, `👥 Campers`, `📊 Full Ledger`), and mobile-first bottom sheets, while preserving desktop layouts on wider screens and maintaining 100% of the mathematical accounting ledger.

**Tech Stack:** React 19, TypeScript, CSS-in-JS / responsive inline styling, Vite, Supabase client & Storage, Vitest / Testing Library.

**Spec:** `docs/superpowers/specs/2026-11-15-mobile-financials-hub-design.md`

## Global Constraints
- Integer cents only for all money calculations (never floating point money arithmetic).
- Zero horizontal viewport overflow on phone screens (`scrollWidth <= innerWidth`).
- Action buttons must be left-aligned directly under item content on mobile.
- + Add Shared Expense button must be visible on the first screen whenever financials are unlocked (`!isFinalized`).
- Preserves exact reconciliation rows in Full Ledger: Camper Fair Share Total, Paid Out-of-Pocket, and Net Settlement Position.
- Frozen sticky first column on horizontal sliding tables.

## Review Focus
1. First screen renders Hero Personal Settlement card and prominent `+ Add Shared Expense` button when `!isFinalized`.
2. Segmented 4-tab navigation correctly switches between Summary, Receipts, Campers, and Full Ledger.
3. Add Expense bottom sheet opens with numeric keypad support (`inputmode="decimal"`) and native camera capture.
4. Left-aligned action buttons across cards, transfers, and expense feeds.
5. Full Ledger spreadsheet matrix maintains frozen sticky first column, smooth horizontal scrolling, and all three reconciliation summary rows.

---

### Task 1: Add Automated Test Suite for Mobile Hub & Tab Switching
**Files:**
- Modify: `frontend/src/features/trips/TripFinancials.test.tsx`

- [x] Write failing test `renders Hero personal settlement snapshot and prominent Add Expense button on mobile summary view`
- [x] Write failing test `allows switching between Summary, Receipts, Campers, and Full Ledger tabs on mobile`
- [x] Write failing test `preserves Total Share Owed, Paid Out-of-Pocket, and Net Settlement Position in Full Ledger tab`
- [x] Run `npm test frontend/src/features/trips/TripFinancials.test.tsx` and verify test failure on missing tab pills.

### Task 2: Implement Personal Hero Snapshot & Prominent First-Screen Add Expense Action
**Files:**
- Modify: `frontend/src/features/trips/TripFinancialsTab.tsx`

- [x] Add `HeroPersonalSnapshot` component rendering authenticated user's net status (owes/gets/settled), breakdown explanation, and left-aligned 1-tap copy & mark sent buttons.
- [x] Add prominent `+ Add Shared Expense` button on the first screen right below the Hero snapshot, gated on `!isFinalized && (isAdmin || isConfirmedAttendee)`.
- [x] Add mobile camera capture support (`capture="environment"` and `inputmode="decimal"`) to the Add Expense modal form.

### Task 3: Implement 4-Tab Segmented Mobile Navigation & View Panels
**Files:**
- Modify: `frontend/src/features/trips/TripFinancialsTab.tsx`

- [x] Implement mobile tab state: `mobileActiveTab: "summary" | "receipts" | "campers" | "ledger"`.
- [x] Render 4-pill segmented control: `⚡ Summary`, `🧾 Receipts`, `👥 Campers`, `📊 Full Ledger`.
- [x] Render `⚡ Summary` panel: Hero snapshot, Add Expense button, quick cost & camper metrics, and settle-up transfers.
- [x] Render `🧾 Receipts` panel: Modern itemized receipt feed with left-aligned actions and camper split drawers.
- [x] Render `👥 Campers` panel: Vertical card roster with colored net balance pills (no horizontal table scroll needed).
- [x] Render `📊 Full Ledger` panel: Dedicated accounting audit view with Cards / Matrix sub-view toggle.

### Task 4: Polish Full Ledger Matrix Slide Ergonomics & Left-Aligned Actions
**Files:**
- Modify: `frontend/src/features/trips/TripFinancialsTab.tsx`

- [x] Verify sticky frozen first column (`position: sticky`, `left: 0`, `zIndex: 10`) on Spreadsheet Matrix.
- [x] Add right-edge gradient hint and swipe indicator banner above matrix table.
- [x] Verify Camper Fair Share Total, Paid Out-of-Pocket, and Net Settlement Position footer rows are rendered and formatted with exact cents.
- [x] Align all action buttons (`Copy Details`, `Mark Sent`, `Confirm Received`, `View Receipt`, `Edit`, `Make Custom`, `Delete`) to the left.

### Task 5: End-to-End Verification & Browser Build
**Files:**
- Test: `frontend/src/features/trips/TripFinancials.test.tsx`

- [x] Run `npm run typecheck` (verify 0 TypeScript errors).
- [x] Run `npm test` (verify all 31 test files / 335+ tests pass).
- [x] Run `npm run build` (verify production Vite client bundle builds cleanly).
