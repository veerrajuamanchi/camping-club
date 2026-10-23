# Specification: Participant Meal & Beverage Preferences and "Not Going" Guardrails

**Date:** 2026-10-23  
**Status:** Approved by Owner  
**Authors:** Antigravity & Club Administrator  

---

## 1. Executive Summary & Intent

Club rules mandate two specific attendee intake items for every trip:
1. **Morning Hot Beverage**: Collect each participant's choice of coffee or tea separately for Saturday and Sunday mornings.
2. **Dietary Preferences & Meal Opt-Out**: Collect vegetarian or non-vegetarian preferences for the trip or each planned meal, allowing participants to explicitly indicate if they are skipping a particular meal (e.g. eating trail rations or dining offsite).

Furthermore, club governance requires strict guardrails for **"Not Going"** respondents:
* Members who respond "Not Going" must never be permitted to claim volunteer chores, meals, shared gear, or grocery commitments.
* If a member previously marked "Going" and signed up for tasks or gear, switching their RSVP to "Not Going" must automatically release those commitments back to the pool so actual attendees can fulfill them.
* Members marked "Not Going" are completely omitted from meal and drink portion counts.

---

## 2. User Experience & Screen Design

### 2.1 Participant Experience ("My Trip Hub" on Overview Tab)

1. **When RSVP is "Going"**:
   - In the **⚡ Required From You** banner, a new card appears:
     - **☕🍽️ My Meals & Drinks**:
       - Summary badges: `Sat: ☕ Coffee, Sun: 🍵 Tea` and `🥗 Vegetarian (Eating All Meals)`.
       - A prominent button: **`[ Edit Choices ✏️ ]`**.
   - Clicking **`[ Edit Choices ✏️ ]`** opens an accessible modal with:
     - **Morning Hot Beverages**:
       - Saturday Morning: `☕ Fresh Brewed Coffee`, `🍵 Hot Chai / Tea`, `🚫 Neither (Water / Own)`.
       - Sunday Morning: `☕ Fresh Brewed Coffee`, `🍵 Hot Chai / Tea`, `🚫 Neither (Water / Own)`.
     - **Trip Meal Plan & Diet**:
       - Quick 1-click shortcuts: `[ ✓ Set All: 🥗 Vegetarian ]` and `[ Set All: 🍖 Non-Vegetarian ]`.
       - Granular per-meal breakdown listing all scheduled meals for the trip (e.g., *Fri Dinner*, *Sat Breakfast*, *Sat Lunch*, *Sat Dinner*, *Sun Breakfast*):
         - Each meal has 3 toggle pills: `[🥗 Veg]`, `[🍖 Non-Veg]`, `[🚫 Skip]`.
     - **Dietary Restrictions & Allergies**:
       - Optional text field for notes (e.g., *"Nut allergy"*, *"Gluten-free"*).
     - **Action Buttons**: `[Cancel]` and `[Save Preferences ✓]`.

2. **When RSVP is "Not Going"**:
   - The **⚡ Required From You** banner collapses into a single status card:
     > *"You have responded Not Going. No cabin deposits, chores, or meal preferences are required from you."*
   - Includes a button: **`[ Change to Going → ]`** to reopen their RSVP.
   - Hides the $50 Deposit row, Daily Chores row, and Meal Preferences row.
   - In **Trip To-Do & Contributions**, volunteer buttons for shared gear and grocery staples are disabled with a tooltip: *"Only confirmed Going attendees can volunteer"*.

### 2.2 Cook & Organizer Experience ("Tasks & Meals" Tab)

1. **Morning Hot Beverage Headcount**:
   - A distinct card displaying:
     - **Saturday Morning**: `☕ Coffee: X`, `🍵 Tea: Y`, `🚫 None: Z`.
     - **Sunday Morning**: `☕ Coffee: X`, `🍵 Tea: Y`, `🚫 None: Z`.
2. **Meal Headcounts Table**:
   - A clean table listing every planned meal with:
     - Meal Name & Day
     - 🥗 Vegetarian Count
     - 🍖 Non-Vegetarian Count
     - 🚫 Skipping Count
     - **Total Campers Eating** (Sum of Veg + Non-Veg)
   - Eliminates guesswork for grocery shopping and meal preparation duties.

---

## 3. Data Model & Schema Design

### 3.1 Database Table: `public.trip_meal_preferences`

```sql
CREATE TABLE IF NOT EXISTS public.trip_meal_preferences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trip_id UUID NOT NULL REFERENCES public.camping_trips(id) ON DELETE CASCADE,
    member_id UUID NOT NULL REFERENCES public.member_profiles(member_id) ON DELETE CASCADE,
    saturday_beverage TEXT NOT NULL DEFAULT 'coffee' CHECK (saturday_beverage IN ('coffee', 'tea', 'none')),
    sunday_beverage TEXT NOT NULL DEFAULT 'tea' CHECK (sunday_beverage IN ('coffee', 'tea', 'none')),
    default_diet TEXT NOT NULL DEFAULT 'vegetarian' CHECK (default_diet IN ('vegetarian', 'non_vegetarian')),
    meal_choices JSONB NOT NULL DEFAULT '{}'::jsonb,
    allergies_notes TEXT CHECK (length(allergies_notes) <= 500),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_trip_member_meal_preferences UNIQUE (trip_id, member_id)
);

CREATE INDEX IF NOT EXISTS idx_trip_meal_preferences_trip ON public.trip_meal_preferences(trip_id);
```

### 3.2 Automated Task & Commitment Release on "Not Going"

When an RSVP is updated to `not_coming` (in `submit_rsvp` or `request_withdrawal`):
1. **Drop duty assignments**:
   ```sql
   DELETE FROM public.trip_duty_assignments
   WHERE trip_id = p_trip_id AND member_id = p_actor_id AND status IN ('claimed', 'assigned_by_admin');
   ```
2. **Release shared gear and food commitments**:
   ```sql
   UPDATE public.trip_commitments
   SET assigned_member_id = NULL,
       status = 'needed',
       updated_at = now()
   WHERE trip_id = p_trip_id AND assigned_member_id = p_actor_id;
   ```
3. **Delete or exclude meal preferences**:
   ```sql
   DELETE FROM public.trip_meal_preferences
   WHERE trip_id = p_trip_id AND member_id = p_actor_id;
   ```

### 3.3 Row Level Security & Authorization

* Table `trip_meal_preferences`:
  * Enable RLS.
  * `authenticated` can `SELECT` rows where `trip_id` belongs to an open/viewable trip.
  * `authenticated` can `INSERT/UPDATE` their own row (`member_id = auth.uid()`) ONLY IF they hold a confirmed `coming` RSVP in `trip_rsvps`.
  * `service_role` has full access.

---

## 4. API Contracts (`trip-api`)

1. **`get_trip_details` / `get_trip_task_matrix`**:
   - Returns `myMealPreferences`: `{ saturdayBeverage, sundayBeverage, defaultDiet, mealChoices, allergiesNotes }` for current user.
   - Returns `mealHeadcounts`:
     - `beverages`: `{ saturday: { coffee, tea, none }, sunday: { coffee, tea, none } }`
     - `meals`: `Array<{ slotId, slotLabel, slotDate, vegCount, nonVegCount, skipCount, totalEating }>`
2. **`save_meal_preferences`**:
   - Parameters: `{ tripId, saturdayBeverage, sundayBeverage, defaultDiet, mealChoices, allergiesNotes }`
   - Authorization: Requires authenticated member with `trip_rsvps.response = 'coming'`. Rejects if member is not coming.

---

## 5. Testing & Verification Gates

1. **Unit & Integration Tests**:
   - Test `submit_rsvp('not_coming')` releases active chores and unassigns gear commitments.
   - Test `save_meal_preferences` saves valid choices and rejects unconfirmed/not-going members.
   - Test aggregation calculations for morning coffee/tea and meal Veg/Non-Veg/Skip counts.
2. **Frontend Component Tests**:
   - `EventDetailsPage.test.tsx`:
     - Test that "Not Going" hides deposit, chores, and meal preferences.
     - Test clicking "Edit Choices" opens the meal preference modal.
     - Test submitting preferences updates the display chip.
   - `TripTasksAndMealsTab.test.tsx`:
     - Test that cook headcount cards render correct totals.
3. **Browser QA Certification Gate (AGENTS.md Rule 10)**:
   - Automated verification across Desktop Chromium, iPhone Mobile WebKit, and Android Mobile Chromium.
   - Verify `page.reload()` persists saved meal and drink choices.
