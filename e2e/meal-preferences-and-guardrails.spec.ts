import { test, expect, type Page } from "@playwright/test";
import crypto from "node:crypto";
import {
  createSyntheticUser,
  cleanupSyntheticUsers,
  supabaseAdmin,
  type TestUser,
} from "./helpers/supabase-admin";
import { authenticateSession } from "./helpers/auth";

test.describe("Meal & Beverage Preferences and Not Going Guardrails Acceptance Gate", () => {
  let adminUser: TestUser;
  const createdTripIds: string[] = [];
  const createdUsers: TestUser[] = [];

  test.beforeAll(async () => {
    // Ensure club schedule timezone is configured so custom trip creation succeeds
    await supabaseAdmin
      .from("club_configuration")
      .update({ club_timezone: "America/Los_Angeles" })
      .eq("singleton", true);

    adminUser = await createSyntheticUser({
      role: "admin",
      displayName: "QA Lead (Admin) - Meals",
      emailPrefix: "admin-meals",
    });
    createdUsers.push(adminUser);
  });

  test.afterAll(async () => {
    for (const tripId of createdTripIds) {
      try {
        await supabaseAdmin
          .from("camping_trips")
          .update({ deleted_at: new Date().toISOString() })
          .eq("id", tripId);
      } catch {
        // ignore
      }
    }
    await cleanupSyntheticUsers(createdUsers);
  });

  async function assertNoHorizontalOverflow(page: Page, contextName: string) {
    const overflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > window.innerWidth;
    });
    expect(overflow, `Page horizontally overflows viewport at ${contextName}`).toBe(false);
  }

  test("certify meal preferences, reload persistence, cook headcounts, and strict not going guardrails", async ({
    page,
  }, testInfo) => {
    test.setTimeout(180_000);
    const suffix = `${Math.random().toString(36).slice(2, 8)}-${testInfo.project.name.toLowerCase().replace(/[^a-z0-9]/g, "")}`;

    // 1. Create synthetic member
    const memberUser = await createSyntheticUser({
      role: "member",
      displayName: `Camper Jordan - ${suffix}`,
      emailPrefix: `camper-${suffix}`,
    });
    createdUsers.push(memberUser);

    // 2. Set up test trip
    const tripId = crypto.randomUUID();
    createdTripIds.push(tripId);

    const { data: campsite } = await supabaseAdmin
      .from("campsites")
      .select("id")
      .eq("active", true)
      .limit(1)
      .single();
    if (!campsite) throw new Error("No active campsite found");

    const startsOn = "2027-09-17"; // Friday
    const endsOn = "2027-09-19"; // Sunday
    const tripTitle = `Sierra Mountain Campout - ${suffix}`;

    await supabaseAdmin.from("camping_trips").insert({
      id: tripId,
      title: tripTitle,
      month_key: "2027-09-01",
      rotation_position: 1,
      suggested_campsite_id: campsite.id,
      selected_campsite_id: campsite.id,
      starts_on: startsOn,
      ends_on: endsOn,
      club_timezone_snapshot: "America/Los_Angeles",
      poll_status: "closed",
      event_status: "confirmed",
      cabin_booking_status: "booked",
      minimum_participants: 4,
      per_cabin_capacity: 6,
      cabin_count: 2,
      max_capacity: 12,
      deposit_amount_cents: 5000,
      rules_markdown: "# Camping Constitution\n1. Respect quiet hours.\n2. Help with camp duties.",
    });

    // 3. Create rule bundle for trip
    await supabaseAdmin.rpc("phase2_refresh_open_rule_bundles", {
      p_actor_id: adminUser.memberId,
      p_trip_ids: [tripId],
    });

    const { data: bundle } = await supabaseAdmin
      .from("trip_rule_bundles")
      .select("id, content_hash")
      .eq("trip_id", tripId)
      .single();
    if (!bundle) throw new Error("Rule bundle creation failed");

    // 4. Set up member as confirmed Coming attendee
    const ackId = crypto.randomUUID();
    await supabaseAdmin.from("trip_rule_acknowledgments").insert({
      id: ackId,
      trip_id: tripId,
      member_id: memberUser.memberId,
      bundle_id: bundle.id,
      content_hash: bundle.content_hash,
      statement_version: "coming-v1",
      request_id: crypto.randomUUID(),
    });

    await supabaseAdmin.from("trip_rsvps").insert({
      trip_id: tripId,
      member_id: memberUser.memberId,
      response: "coming",
      rule_acknowledgment_id: ackId,
      deposit_status: "unpaid",
    });

    // 5. Insert meal time slots for the trip
    const mealSlots = [
      {
        trip_id: tripId,
        slot_date: startsOn,
        time_block: "friday_dinner",
        slot_type: "meal",
        label: "Friday Dinner",
        sort_order: 10,
        is_enabled: true,
      },
      {
        trip_id: tripId,
        slot_date: "2027-09-18",
        time_block: "saturday_morning",
        slot_type: "meal",
        label: "Saturday Breakfast",
        sort_order: 20,
        is_enabled: true,
      },
      {
        trip_id: tripId,
        slot_date: "2027-09-18",
        time_block: "saturday_lunch",
        slot_type: "meal",
        label: "Saturday Lunch",
        sort_order: 30,
        is_enabled: true,
      },
      {
        trip_id: tripId,
        slot_date: "2027-09-18",
        time_block: "saturday_dinner",
        slot_type: "meal",
        label: "Saturday Dinner",
        sort_order: 40,
        is_enabled: true,
      },
      {
        trip_id: tripId,
        slot_date: endsOn,
        time_block: "sunday_morning",
        slot_type: "meal",
        label: "Sunday Breakfast",
        sort_order: 50,
        is_enabled: true,
      },
    ];
    await supabaseAdmin.from("trip_time_slots").insert(mealSlots);

    // 6. Insert chore time slot & duty (so Tasks tab has volunteerable duties)
    const { data: choreSlot } = await supabaseAdmin
      .from("trip_time_slots")
      .insert({
        trip_id: tripId,
        slot_date: "2027-09-18",
        time_block: "daily",
        slot_type: "chore",
        label: "Saturday Chores & Kitchen",
        sort_order: 60,
        is_enabled: true,
      })
      .select()
      .single();

    const { data: masterResp } = await supabaseAdmin
      .from("master_responsibilities")
      .select("id")
      .eq("active", true)
      .limit(1)
      .single();
    if (choreSlot && masterResp) {
      await supabaseAdmin.from("trip_slot_duties").insert({
        time_slot_id: choreSlot.id,
        master_responsibility_id: masterResp.id,
        capacity: 2,
        workload_weight: 1.0,
        is_active: true,
      });
    }

    // 7. Insert shared commitments (so To-Do & Contributions has voluntary items)
    await supabaseAdmin.from("trip_commitments").insert([
      {
        trip_id: tripId,
        category: "gear",
        item_name: "Camp Stove & Fuel",
        quantity_description: "2-burner stove",
        commitment_type: "shared_volunteer",
        is_critical: true,
        is_active: true,
      },
      {
        trip_id: tripId,
        category: "food",
        item_name: "Pancake Mix & Syrup",
        quantity_description: "2 boxes",
        commitment_type: "shared_volunteer",
        is_critical: false,
        is_active: true,
      },
    ]);

    // -------------------------------------------------------------------------
    // Flow 1: Going Member Meal Preferences & Persistence
    // -------------------------------------------------------------------------
    await authenticateSession(page, memberUser);
    await page.goto(`/trips/${tripId}`);
    await page.waitForLoadState("networkidle");
    await assertNoHorizontalOverflow(page, "overview-initial");

    // Verify hub-meals-row is visible with default summary
    const mealsRow = page.locator('[data-testid="hub-meals-row"]');
    await expect(mealsRow).toBeVisible();
    await expect(mealsRow).toContainText("Sat: Coffee, Sun: Tea · Veg (All) · No Alcohol");

    // Click "Edit Choices", opening MealPreferencesModal
    await mealsRow.getByRole("button", { name: "Edit Choices" }).click();
    const modal = page.getByRole("dialog");
    await expect(modal).toBeVisible();
    await expect(modal.getByRole("heading", { name: /Edit Meal & Beverage Preferences/i })).toBeVisible();
    await assertNoHorizontalOverflow(page, "modal-open");

    // Select Saturday Coffee, Sunday Tea
    const satCoffeeRadio = modal.locator('input[name="sat_beverage"][value="coffee"]');
    await satCoffeeRadio.check();
    await expect(satCoffeeRadio).toBeChecked();

    const sunTeaRadio = modal.locator('input[name="sun_beverage"][value="tea"]');
    await sunTeaRadio.check();
    await expect(sunTeaRadio).toBeChecked();

    // Select Alcohol: Beer and Wine (multi-select)
    const beerCheck = modal.locator('input[name="alcohol_beer"]');
    await beerCheck.check();
    await expect(beerCheck).toBeChecked();

    const wineCheck = modal.locator('input[name="alcohol_wine"]');
    await wineCheck.check();
    await expect(wineCheck).toBeChecked();

    // Click "Set All: 🍖 Non-Vegetarian"
    await modal.getByRole("button", { name: "Set All: 🍖 Non-Vegetarian" }).click();

    // Customize one meal slot to [🚫 Skip] (e.g. Friday Dinner)
    const friRow = modal.locator(".meal-slot-row", { hasText: "Friday Dinner" });
    await expect(friRow).toBeVisible();
    await friRow.getByRole("button", { name: "🚫 Skip" }).click();

    // Enter allergy notes: Peanut allergy (severe) - requires separate prep
    const notesInput = modal.getByPlaceholder(/e\.g\.\s*Peanut allergy/i);
    await notesInput.fill("Peanut allergy (severe) - requires separate prep");

    // Click "Save Preferences ✓"
    await modal.getByRole("button", { name: "Save Preferences ✓" }).click();
    await expect(modal).toBeHidden();

    // Verify modal closes and summary badge on Hub reflects updated choices
    await expect(mealsRow).toContainText("Sat: Coffee, Sun: Tea · Skipping 1 meal · Alcohol: Beer, Wine");

    // Perform full browser reload and verify saved preferences persist intact
    await page.reload();
    await page.waitForLoadState("networkidle");

    const reloadedMealsRow = page.locator('[data-testid="hub-meals-row"]');
    await expect(reloadedMealsRow).toBeVisible();
    await expect(reloadedMealsRow).toContainText("Sat: Coffee, Sun: Tea · Skipping 1 meal · Alcohol: Beer, Wine");

    // Re-open "Edit Choices" to verify allergy notes and selections persisted across reload
    await reloadedMealsRow.getByRole("button", { name: "Edit Choices" }).click();
    const reloadedModal = page.getByRole("dialog");
    await expect(reloadedModal).toBeVisible();
    await expect(reloadedModal.locator('input[name="sat_beverage"][value="coffee"]')).toBeChecked();
    await expect(reloadedModal.locator('input[name="sun_beverage"][value="tea"]')).toBeChecked();
    await expect(reloadedModal.locator('input[name="alcohol_beer"]')).toBeChecked();
    await expect(reloadedModal.locator('input[name="alcohol_wine"]')).toBeChecked();
    await expect(reloadedModal.getByPlaceholder(/e\.g\.\s*Peanut allergy/i)).toHaveValue(
      "Peanut allergy (severe) - requires separate prep"
    );

    // Close modal
    await reloadedModal.getByRole("button", { name: "Close" }).click();
    await expect(reloadedModal).toBeHidden();

    // -------------------------------------------------------------------------
    // Flow 2: Cook Headcount Table
    // -------------------------------------------------------------------------
    await page.getByRole("tab", { name: "Tasks & Meals" }).click();
    await page.waitForLoadState("networkidle");
    await assertNoHorizontalOverflow(page, "tasks-tab-cook-headcounts");

    const cookCard = page.locator('[data-testid="cook-headcounts-card"]');
    await expect(cookCard).toBeVisible();
    await expect(cookCard.getByText("☕ Morning Hot Beverages")).toBeVisible();

    // Saturday Morning: Coffee 1, Tea 0, None 0
    const satMorningSection = cookCard.locator("strong", { hasText: "Saturday Morning:" }).locator("..");
    await expect(satMorningSection.getByText(/☕ Coffee:\s*1/)).toBeVisible();
    await expect(satMorningSection.getByText(/🍵 Tea:\s*0/)).toBeVisible();
    await expect(satMorningSection.getByText(/🚫 None:\s*0/)).toBeVisible();

    // Sunday Morning: Coffee 0, Tea 1, None 0
    const sunMorningSection = cookCard.locator("strong", { hasText: "Sunday Morning:" }).locator("..");
    await expect(sunMorningSection.getByText(/☕ Coffee:\s*0/)).toBeVisible();
    await expect(sunMorningSection.getByText(/🍵 Tea:\s*1/)).toBeVisible();
    await expect(sunMorningSection.getByText(/🚫 None:\s*0/)).toBeVisible();

    // Alcohol Planning Section
    await expect(cookCard.getByText("🍷 Evening Drinks & Alcohol Planning")).toBeVisible();
    await expect(cookCard.getByText(/🍺 Beer\/Seltzers:\s*1/)).toBeVisible();
    await expect(cookCard.getByText(/🍷 Wine:\s*1/)).toBeVisible();
    await expect(cookCard.getByText(/🚫 No Alcohol:\s*0/)).toBeVisible();

    // Meal portions table
    const mealsTable = page.locator('[data-testid="cook-meals-table"]');
    await expect(mealsTable).toBeVisible();

    // Friday Dinner: Veg 0, Non-Veg 0, Skip 1, Total Eating 0
    const friDinnerRow = mealsTable.locator("tr", { hasText: "Friday Dinner" });
    await expect(friDinnerRow.locator("td").nth(2)).toHaveText("0");
    await expect(friDinnerRow.locator("td").nth(3)).toHaveText("0");
    await expect(friDinnerRow.locator("td").nth(4)).toHaveText("1");
    await expect(friDinnerRow.locator("td").nth(5)).toHaveText("0");

    // Saturday Breakfast: Veg 0, Non-Veg 1, Skip 0, Total Eating 1
    const satBreakfastRow = mealsTable.locator("tr", { hasText: "Saturday Breakfast" });
    await expect(satBreakfastRow.locator("td").nth(2)).toHaveText("0");
    await expect(satBreakfastRow.locator("td").nth(3)).toHaveText("1");
    await expect(satBreakfastRow.locator("td").nth(4)).toHaveText("0");
    await expect(satBreakfastRow.locator("td").nth(5)).toHaveText("1");

    // -------------------------------------------------------------------------
    // Flow 3: "Not Going" Strict Guardrails
    // -------------------------------------------------------------------------
    await page.getByRole("tab", { name: "Overview & attendees" }).click();
    await page.waitForLoadState("networkidle");

    // Switch RSVP to "Not Going"
    await page.getByRole("button", { name: "Not Going", exact: true }).click();
    await page.getByRole("button", { name: "Confirm Not Going" }).click();

    // Wait for the status change to settle
    await expect(page.getByText("⚡ Required From You")).toBeVisible();
    await expect(page.getByText("Not Attending", { exact: true })).toBeVisible();

    // Verify deposit row, chores row, and meal preferences row are hidden
    await expect(page.locator('[data-testid="hub-deposit-row"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="hub-chores-row"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="hub-meals-row"]')).toHaveCount(0);

    // Verify volunteer buttons in To-Do & Contributions are disabled
    await expect(page.locator('[data-testid="not-attending-todo-banner"]')).toBeVisible();
    await expect(page.locator('[data-testid="todo-shared-gear"] button')).toBeDisabled();
    await expect(page.locator('[data-testid="todo-food-groceries"] button')).toBeDisabled();

    await assertNoHorizontalOverflow(page, "overview-not-going");

    // Switch to Tasks tab
    await page.getByRole("tab", { name: "Tasks & Meals" }).click();
    await page.waitForLoadState("networkidle");

    // Verify not-attending-tasks-banner is displayed and volunteer buttons are disabled
    await expect(page.locator('[data-testid="not-attending-tasks-banner"]')).toBeVisible();
    const dutyVolunteerBtn = page.locator(".duty-item-row button", { hasText: /Volunteer/i }).first();
    await expect(dutyVolunteerBtn).toBeVisible();
    await expect(dutyVolunteerBtn).toBeDisabled();

    await assertNoHorizontalOverflow(page, "tasks-tab-not-going");
  });
});
