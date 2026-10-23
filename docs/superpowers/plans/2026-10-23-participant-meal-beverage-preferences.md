# Participant Meal & Beverage Preferences & "Not Going" Guardrails Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement attendee morning beverage intake (Sat/Sun coffee/tea), granular per-meal diet/skipping preferences, live cook headcount summaries, and strict "Not Going" volunteer lockouts with automated chore/gear release.

**Architecture:** A durable PostgreSQL table `trip_meal_preferences` with RLS; database triggers/RPC logic to auto-release held chores and gear commitments on `not_coming` RSVP; Edge Function `trip-api` endpoints to persist preferences and aggregate cook headcounts; and a mobile-friendly React modal and headcount dashboard.

**Tech Stack:** Supabase PostgreSQL, Supabase Edge Functions (Deno / TypeScript), React, TypeScript, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-23-participant-meal-beverage-preferences-design.md`

## Global Constraints

- Use integer cents for any monetary calculations; zero floating-point arithmetic.
- Strict server-side authorization: only confirmed attendees (`response = 'coming'`) may volunteer for duties, claim gear, or submit meal preferences.
- Default-deny RLS on `trip_meal_preferences` with explicit permissions for authenticated attendees.
- Browser QA certification gate across Desktop Chromium, iPhone Mobile WebKit, and Android Mobile Chromium with `page.reload()` persistence verification.
- Mobile viewports must verify zero horizontal scroll overflow (`scrollWidth <= innerWidth`).

## Review Focus

1. If a member changes RSVP from "Going" to "Not Going", their active duty assignments in `trip_duty_assignments` and gear commitments in `trip_commitments` must be immediately cleared, freeing capacity for others.
2. If a member is "Not Going", any attempt to invoke `claim_duty`, `manage_trip_commitment`, or `save_meal_preferences` must be rejected with HTTP 403 / 42501.
3. If an attendee selects "Skipping" for a specific meal (e.g. Sat Lunch), the cook headcount for that meal must increment the skipping counter and decrement total eating campers.
4. If an attendee switches their default diet from Vegetarian to Non-Vegetarian, all meals not explicitly customized must update to Non-Vegetarian.
5. All editable preference choices must persist durably to PostgreSQL and remain completely intact after `page.reload()`.

---

### Task 1: Database Migration for `trip_meal_preferences` & Auto-Release on "Not Going"

**Files:**
- Create: `supabase/migrations/20261023011500_trip_meal_preferences_and_not_going_guardrails.sql`
- Test: `tests/database/meal_preferences.test.mjs`

**Interfaces:**
- Produces: Table `public.trip_meal_preferences` with columns `(id, trip_id, member_id, saturday_beverage, sunday_beverage, default_diet, meal_choices, allergies_notes, created_at, updated_at)`.
- Modifies: `public.phase2_submit_rsvp` or `public.submit_rsvp` to delete `trip_duty_assignments` and release `trip_commitments` when `p_response = 'not_coming'`.

- [ ] **Step 1: Write the failing integration test**

```javascript
// tests/database/meal_preferences.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

test("releases duty assignments and commitments when member switches to not_coming", async () => {
  // Test that setting RSVP to not_coming unassigns duties and commitments
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/database/meal_preferences.test.mjs`  
Expected: FAIL (table and trigger do not exist yet)

- [ ] **Step 3: Implement `supabase/migrations/20261023011500_trip_meal_preferences_and_not_going_guardrails.sql`**

Create table `trip_meal_preferences`, enable RLS, set policies, and add trigger/logic in `phase2_submit_rsvp` to clear `trip_duty_assignments` and reset `trip_commitments` where `assigned_member_id = p_member_id` on `not_coming`.

- [ ] **Step 4: Run migration and verify test passes**

Run: `npx supabase db query --linked --project-ref kdxmwqxlhswcgwanlump -f supabase/migrations/20261023011500_trip_meal_preferences_and_not_going_guardrails.sql && node tests/database/meal_preferences.test.mjs`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261023011500_trip_meal_preferences_and_not_going_guardrails.sql tests/database/meal_preferences.test.mjs
git commit -m "feat(db): add trip_meal_preferences and auto-release tasks on not going"
```

---

### Task 2: Backend Edge Function Extensions in `trip-api`

**Files:**
- Modify: `supabase/functions/trip-api/index.ts`
- Test: `supabase/functions/trip-api/meal_preferences.test.mjs`

**Interfaces:**
- Consumes: `trip_meal_preferences` table.
- Produces:
  - Action `save_meal_preferences`: `z.object({ tripId: uuid, saturdayBeverage: z.enum(['coffee','tea','none']), sundayBeverage: z.enum(['coffee','tea','none']), defaultDiet: z.enum(['vegetarian','non_vegetarian']), mealChoices: z.record(z.string(), z.enum(['veg','non_veg','skip'])), allergiesNotes: z.string().max(500).nullable().optional() })`
  - Action `get_trip_details`: includes `myMealPreferences` and `mealHeadcounts`.

- [ ] **Step 1: Write the failing test**

```javascript
// Test calling save_meal_preferences when not confirmed attendee (expect 403)
// Test calling save_meal_preferences as confirmed attendee (expect 200)
// Test get_trip_details returns computed morning beverage & meal headcounts
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node supabase/functions/trip-api/meal_preferences.test.mjs`  
Expected: FAIL

- [ ] **Step 3: Implement endpoints in `supabase/functions/trip-api/index.ts`**

Add `save_meal_preferences` handler with attendee verification. Extend `get_trip_details` and `get_trip_task_matrix` with live beverage and meal counts.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node supabase/functions/trip-api/meal_preferences.test.mjs && npm test`  
Expected: PASS

- [ ] **Step 5: Commit and deploy**

```bash
git add supabase/functions/trip-api/index.ts
git commit -m "feat(api): add meal preferences and cook headcount endpoints"
npx supabase functions deploy trip-api --project-ref kdxmwqxlhswcgwanlump
```

---

### Task 3: Frontend "Not Going" Strict Guardrails in Trip Hub & Tasks Tab

**Files:**
- Modify: `frontend/src/features/trips/EventDetailsPage.tsx`
- Modify: `frontend/src/features/trips/TripTasksAndMealsTab.tsx`
- Test: `frontend/src/features/trips/__tests__/NotGoingGuardrails.test.tsx`

**Interfaces:**
- Consumes: `details.myRsvp?.response`.
- Produces:
  - Collapsed single status card in "⚡ Required From You" when `response === 'not_coming'`.
  - Hides Deposit, Chores, and Meal preferences when `response === 'not_coming'`.
  - Disables volunteer buttons in "📋 Trip To-Do & Contributions" when `response !== 'coming'`.
  - Warning banner in `TripTasksAndMealsTab` when not confirmed attendee.

- [ ] **Step 1: Write the failing unit test**

```tsx
// frontend/src/features/trips/__tests__/NotGoingGuardrails.test.tsx
// Test that rendering EventDetailsPage with response: 'not_coming' hides deposit & chores rows
// Test that volunteer buttons display "Only confirmed Going attendees can volunteer"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix frontend test NotGoingGuardrails`  
Expected: FAIL

- [ ] **Step 3: Implement guardrails in `EventDetailsPage.tsx` & `TripTasksAndMealsTab.tsx`**

Only render deposit and chore workload rows inside `{isComing && ( ... )}`. If `myRsvp?.response === 'not_coming'`, show the clean status banner.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix frontend test NotGoingGuardrails && npm test`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/trips/EventDetailsPage.tsx frontend/src/features/trips/TripTasksAndMealsTab.tsx frontend/src/features/trips/__tests__/NotGoingGuardrails.test.tsx
git commit -m "fix(ui): enforce strict Not Going guardrails across Trip Hub and Tasks tab"
```

---

### Task 4: Frontend "My Meals & Drinks" Card, Edit Choices Modal & Cook Headcounts

**Files:**
- Create: `frontend/src/features/trips/MealPreferencesModal.tsx`
- Modify: `frontend/src/features/trips/EventDetailsPage.tsx`
- Modify: `frontend/src/features/trips/TripTasksAndMealsTab.tsx`
- Test: `frontend/src/features/trips/__tests__/MealPreferences.test.tsx`

**Interfaces:**
- Produces:
  - `<MealPreferencesModal>` component supporting Saturday/Sunday coffee/tea, Set All Veg/Non-Veg, per-meal toggles, and allergy notes.
  - "☕🍽️ My Meals & Drinks" summary card in Trip Hub.
  - Cook Headcount Summary card and table in `TripTasksAndMealsTab`.

- [ ] **Step 1: Write failing component test**

```tsx
// Test opening modal, selecting Coffee/Tea, toggling Veg/Non-Veg, and saving preferences
// Test Cook Headcount table rendering aggregated counts
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix frontend test MealPreferences`  
Expected: FAIL

- [ ] **Step 3: Implement components**

Build `MealPreferencesModal.tsx` matching approved mockup. Integrate card into `EventDetailsPage.tsx`. Integrate cook headcount table into `TripTasksAndMealsTab.tsx`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix frontend test MealPreferences && npm test && npm run typecheck`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/trips/MealPreferencesModal.tsx frontend/src/features/trips/EventDetailsPage.tsx frontend/src/features/trips/TripTasksAndMealsTab.tsx frontend/src/features/trips/__tests__/MealPreferences.test.tsx
git commit -m "feat(ui): add My Meals & Drinks preference editor and cook headcount widget"
```

---

### Task 5: End-to-End Browser QA Verification Gate

**Files:**
- Create: `e2e/meal-preferences-and-guardrails.spec.ts`
- Test: Playwright suite across Desktop Chromium, iPhone Mobile WebKit, and Android Mobile Chromium

- [ ] **Step 1: Write Playwright acceptance test**

Test attendee logging in, clicking "Going", opening "Edit Choices", setting Saturday Coffee and Sunday Tea, setting dietary preferences, saving, and verifying `page.reload()` persistence. Test setting "Not Going" and verifying tasks and deposits are locked out and no horizontal scroll overflow exists.

- [ ] **Step 2: Run browser acceptance test**

Run: `npm run test:e2e`  
Expected: PASS across Desktop Chromium, iPhone WebKit, and Android Chromium

- [ ] **Step 3: Run full verification suite**

Run: `npm run verify`  
Expected: PASS (typecheck, tests, database, security scans)

- [ ] **Step 4: Commit and deploy**

```bash
git add e2e/meal-preferences-and-guardrails.spec.ts
git commit -m "test(e2e): certify meal preferences and not going guardrails across desktop and mobile"
git push origin main
```
