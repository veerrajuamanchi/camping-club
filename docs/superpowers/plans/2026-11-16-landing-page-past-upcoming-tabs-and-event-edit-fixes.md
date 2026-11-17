# Landing Page Past/Upcoming Tabs & Event Edit Resilience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the landing page into a clean 2-tab view ("Upcoming" vs "Past Trips") with settlement awareness for completed events, disable irrelevant RSVP controls on past events, and fix error reporting and capacity UX in the trip edit modals.

**Architecture:** 
- In `TripCalendarPage.tsx`, partition loaded trips into `upcomingTrips` and `pastTrips` based on trip end dates (`endsOn < todayPST`) and event status.
- Add a top segment switcher (`Upcoming (${count})` / `Past Trips (${count})`).
- If any past trip has an unfinalized or unsettled financial state, surface a dismissible notification banner on the Upcoming tab directing admins and attendees to complete settlement.
- In `EventCard`, suppress active RSVP pill buttons when an event is in the past, replacing them with a completed status badge and a direct "View Financials & Settlement ➔" button.
- In both `TripCalendarPage.tsx` and `EventDetailsPage.tsx`, capture and render exact backend error messages (`err.message`) in the edit modal, and provide clear explanatory copy for the optional Max Capacity override.

**Tech Stack:** React 18, TypeScript, Vitest, React Testing Library.

**Spec:** Proposal B approved by owner on November 16, 2026.

## Global Constraints

- Monetary calculations remain 100% untouched; integer cents everywhere.
- Maintain existing RLS and security boundaries; no direct client database mutations.
- Maintain responsive layout with zero horizontal overflow on mobile viewports (`scrollWidth <= innerWidth`).
- Must pass both `main` and `feature/camping-club-v2` test suites and Vite builds with zero errors.

## Review Focus

1. **Past Date Determination:** Ensure Pacific Time (the club timezone) is used to check whether `endsOn < today` so timezone boundary edge cases don't prematurely mark trips as past.
2. **Draft Trips:** Trips without `startsOn` or `endsOn` remain in the "Upcoming" / planning view.
3. **Empty Past Trips View:** When there are 0 past trips, render a helpful empty state rather than a blank screen.
4. **Error Message Clarity:** Modal error displays must cleanly unpack API error JSON or strings without showing raw `[object Object]`.
5. **RSVP Invariant:** Past events must never allow submitting new RSVPs.

---

### Task 1: Add Past vs. Upcoming Partitioning & Tab Switcher in `TripCalendarPage`

**Files:**
- Modify: `frontend/src/features/trips/TripCalendarPage.tsx`
- Test: `frontend/src/features/trips/TripCalendarPage.test.tsx`

**Step 1: Write failing tests for Upcoming and Past Trips tab switching**
Add tests asserting:
- Partitioning of trips: trips with `endsOn < today` appear under "Past Trips"; upcoming trips appear under "Upcoming".
- Default tab is "Upcoming".
- Clicking "Past Trips" displays the completed events.
- An alert banner is visible when a past trip has an unfinalized settlement.

**Step 2: Implement helper `isTripPast(trip, todayStr)` and tab state in `TripCalendarPage.tsx`**
- Compute `todayStr` in Pacific Time (`YYYY-MM-DD`).
- Partition `calendar.trips` into `upcomingTrips` and `pastTrips`.
- Render segment buttons: `Upcoming (${upcomingTrips.length})` and `Past Trips (${pastTrips.length})`.
- Display the pending settlement alert banner when `pastTrips.some(t => t.eventStatus !== "financially_settled" && t.tripStatus !== "financially_settled")`.

**Step 3: Run Vitest and verify tests pass**
```bash
npm --prefix frontend test TripCalendarPage.test.tsx
```

---

### Task 2: Update `EventCard` for Past Events (Completed Badge & Direct Financials Link)

**Files:**
- Modify: `frontend/src/features/trips/TripCalendarPage.tsx`
- Test: `frontend/src/features/trips/TripCalendarPage.test.tsx`

**Step 1: Write failing test in `TripCalendarPage.test.tsx`**
- Assert that an event in the past does NOT render the "Your RSVP" buttons ("Yes, Going", "No, Not Going").
- Assert that it renders a "🏁 Completed Event" badge and a link/button to "View Financials & Settlement".

**Step 2: Update `EventCard` in `TripCalendarPage.tsx`**
- Check `isPast = isTripPast(trip, todayStr)`.
- If `isPast`, hide `.rsvp-section` and render:
  - Completed status bar with settlement indicator (`Draft Calculation`, `Finalized`, or `Fully Settled`).
  - Action button: `<button onClick={() => navigate(`/trips/${trip.tripId}?tab=financials`)}>💰 View Financials & Settlement ➔</button>`.

**Step 3: Run Vitest to verify all tests pass**
```bash
npm --prefix frontend test TripCalendarPage.test.tsx
```

---

### Task 3: Enhance Error Reporting & Capacity Helper Copy in Edit Modals

**Files:**
- Modify: `frontend/src/features/trips/TripCalendarPage.tsx` (in `EditTripModal`)
- Modify: `frontend/src/features/trips/EventDetailsPage.tsx` (in `EditTripDetailsModal`)
- Test: `frontend/src/features/trips/TripCalendarPage.test.tsx`
- Test: `frontend/src/features/trips/EventDetailsPage.test.tsx`

**Step 1: Write tests verifying error messages and helper text**
- Test that server errors (such as 409 stale version or custom validation errors) display the specific error message text returned from the server.
- Test that helper copy for `maxCapacity` is rendered.

**Step 2: Update Edit Modals**
- In `TripCalendarPage.tsx` and `EventDetailsPage.tsx`:
  - Update `catch` block to extract `err?.message || err?.error || "Could not save trip configuration."` and set `msg`.
  - Add descriptive helper under `Max capacity (optional)` input:
    `<small style={{ color: "#6b7280", display: "block", marginTop: "0.25rem" }}>Optional cap. Leave blank to automatically compute from Camping Type Sites Count × Site Capacity.</small>`

**Step 3: Run full frontend test suite**
```bash
npm --prefix frontend test
```

---

### Task 4: Sync to `camping-club-v2` Worktree, Build & Verify

**Files:**
- Sync: `frontend/src/features/trips/TripCalendarPage.tsx`
- Sync: `frontend/src/features/trips/TripCalendarPage.test.tsx`
- Sync: `frontend/src/features/trips/EventDetailsPage.tsx`
- Sync: `frontend/src/features/trips/EventDetailsPage.test.tsx`

**Step 1: Copy modified files to `/Users/veerrajuamanchi/camping-club-v2`**
**Step 2: Run test suite and production build in both worktrees**
```bash
npm --prefix frontend test && npm --prefix frontend run build
cd /Users/veerrajuamanchi/camping-club-v2 && npm --prefix frontend test && npm --prefix frontend run build
```
**Step 3: Commit and push both branches (`main` and `feature/camping-club-v2`)**
