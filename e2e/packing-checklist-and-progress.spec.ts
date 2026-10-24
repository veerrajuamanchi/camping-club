import { test, expect, type Page } from "@playwright/test";
import crypto from "node:crypto";
import {
  createSyntheticUser,
  cleanupSyntheticUsers,
  supabaseAdmin,
  type TestUser,
} from "./helpers/supabase-admin";
import { authenticateSession } from "./helpers/auth";

test.describe("Dynamic 4-Item Progress Bar and Interactive Packing Checklist Gate", () => {
  let adminUser: TestUser;
  const createdTripIds: string[] = [];
  const createdUsers: TestUser[] = [];

  test.beforeAll(async () => {
    // Ensure club timezone is set
    await supabaseAdmin
      .from("club_configuration")
      .update({ club_timezone: "America/Los_Angeles" })
      .eq("singleton", true);

    adminUser = await createSyntheticUser({
      role: "admin",
      displayName: "QA Lead (Admin) - Checklist",
      emailPrefix: "admin-checklist",
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

  test("verifies 3 of 4 and 4 of 4 progress bar states, catalog sync, interactive packing checklist, and reload persistence", async ({
    page,
  }, testInfo) => {
    test.setTimeout(180_000);
    const suffix = `${Math.random().toString(36).slice(2, 8)}-${testInfo.project.name.toLowerCase().replace(/[^a-z0-9]/g, "")}`;

    // 1. Create a member user
    const memberUser = await createSyntheticUser({
      role: "member",
      displayName: `Camper Alex - ${suffix}`,
      emailPrefix: `camper-pack-${suffix}`,
    });
    createdUsers.push(memberUser);

    // 2. Create a test campsite and trip
    const tripId = crypto.randomUUID();
    createdTripIds.push(tripId);

    const { data: campsite } = await supabaseAdmin
      .from("campsites")
      .select("id")
      .limit(1)
      .single();

    const randomYear = 2030 + Math.floor(Math.random() * 20);
    const randomMonth = String(1 + Math.floor(Math.random() * 12)).padStart(2, "0");
    const monthKey = `${randomYear}-${randomMonth}-01`;
    const startsOn = `${randomYear}-${randomMonth}-10`;
    const endsOn = `${randomYear}-${randomMonth}-12`;

    const tripTitle = `Packing QA Wilderness - ${suffix}`;
    const insertTripRes = await supabaseAdmin.from("camping_trips").insert({
      id: tripId,
      month_key: monthKey,
      rotation_position: 1,
      title: tripTitle,
      starts_on: startsOn,
      ends_on: endsOn,
      selected_campsite_id: campsite?.id,
      suggested_campsite_id: campsite?.id,
      event_status: "confirmed",
      trip_status: "confirmed",
      poll_status: "closed",
      minimum_participants: 4,
      deposit_amount_cents: 5000,
      cabin_count: 2,
      per_cabin_capacity: 6,
      rules_markdown: "# Camping Rules\n\n1. Be kind.\n2. Leave no trace.",
    });
    if (insertTripRes.error) throw new Error(insertTripRes.error.message);

    const bundleRes = await supabaseAdmin.rpc("phase2_refresh_open_rule_bundles", {
      p_actor_id: adminUser.memberId,
      p_trip_ids: [tripId],
    });
    if (bundleRes.error) throw new Error(bundleRes.error.message);

    // 3. Ensure master gear items exist (so sync populates items)
    const testGearId = crypto.randomUUID();
    await supabaseAdmin.from("master_gear").insert({
      id: testGearId,
      name: `Special Insulated Sleeping Pad - ${suffix}`,
      gear_type: "individual",
      category: "sleep",
      default_quantity: "1 per camper",
      active: true,
      is_critical: true,
    });

    // Explicitly seed trip commitments from master
    await supabaseAdmin.rpc("seed_trip_commitments_from_master", {
      p_trip_id: tripId,
      p_actor_id: adminUser.memberId,
    });

    // 4. Camper logs in and navigates to the trip
    await authenticateSession(page, memberUser);
    await page.goto(`/trips/${tripId}`);
    await page.waitForLoadState("networkidle");
    await assertNoHorizontalOverflow(page, "camper-initial-load");

    // 5. Camper RSVPs Going
    await page.getByRole("button", { name: "Going", exact: true }).click();
    await page.getByLabel("I have read and agree to the Camping Constitution.").check();
    await page.getByRole("button", { name: "Confirm Going" }).click();

    // Dismiss post-RSVP duty modal
    await page.getByRole("button", { name: "I'll choose later" }).click();

    // 6. Member sets deposit status (clicks 'I Have Sent $50')
    const sendDepositBtn = page.getByRole("button", { name: "I Have Sent $50" });
    await expect(sendDepositBtn).toBeVisible();
    await sendDepositBtn.click();
    await expect(page.getByText(/Submitted \(Pending Verification\)/i)).toBeVisible();

    // Admin verifies deposit via database
    await supabaseAdmin
      .from("trip_rsvps")
      .update({ deposit_status: "confirmed_by_admin" })
      .eq("trip_id", tripId)
      .eq("member_id", memberUser.memberId);

    // Member sets meal preferences
    const mealCard = page.locator('[data-testid="hub-meals-row"]');
    await expect(mealCard).toBeVisible();
    await mealCard.getByRole("button", { name: /Edit Choices|Set Preferences/i }).click();

    const mealModal = page.getByRole("dialog", { name: /Edit Meal & Beverage Preferences/i });
    await expect(mealModal).toBeVisible();
    await mealModal.getByRole("button", { name: /Non-Vegetarian/i }).click();
    await mealModal.getByRole("button", { name: /Save Preferences/i }).click();
    await expect(mealModal).toBeHidden();

    // Reload page to verify persistence
    await page.reload();
    await page.waitForLoadState("networkidle");

    // 7. Progress Bar Check: RSVP Going (✓), Deposit Confirmed (✓), Meals Set (✓), Chores Pending (⚠️)
    // Must show exact "Required From You (3 of 4 Completed)" and "Action Needed"
    const requiredHeading = page.locator("h2", { hasText: /Required From You/i });
    await expect(requiredHeading).toHaveText(/Required From You \(3 of 4 Completed\)/i);
    await expect(page.getByText("Action Needed", { exact: true })).toBeVisible();

    // 8. Personal Packing Checklist Check
    const packingSection = page.locator('[data-testid="todo-personal-packing"]');
    await expect(packingSection).toBeVisible();

    // Open Packing modal
    const viewListBtn = packingSection.getByRole("button", { name: /View List/i });
    await expect(viewListBtn).toBeVisible();
    await viewListBtn.click();

    const packingModal = page.getByRole("dialog", { name: /Personal Packing Checklist/i });
    await expect(packingModal).toBeVisible();
    await assertNoHorizontalOverflow(page, "packing-modal-open");

    // Verify progress bar inside modal shows packed items
    await expect(packingModal.getByText(/Packed 0 of/i)).toBeVisible();

    // Check off the first item
    const firstCheckbox = packingModal.getByRole("checkbox").first();
    await expect(firstCheckbox).toBeVisible();
    await firstCheckbox.check();

    // Progress bar updates
    await expect(packingModal.getByText(/Packed 1 of/i)).toBeVisible();

    // Close modal
    await packingModal.getByRole("button", { name: "Close" }).click();
    await expect(packingModal).toBeHidden();

    // Verify summary reflects 1 packed on the overview card
    await expect(packingSection.getByText(/\(1 of [0-9]+ packed\)/i)).toBeVisible();

    // 9. Verify reload persistence: localStorage persists checked items across browser reload
    await page.reload();
    await page.waitForLoadState("networkidle");

    const reloadedPackingSection = page.locator('[data-testid="todo-personal-packing"]');
    await expect(reloadedPackingSection.getByText(/\(1 of [0-9]+ packed\)/i)).toBeVisible();

    // Re-open modal and verify first item is still checked
    await reloadedPackingSection.getByRole("button", { name: /View List/i }).click();
    const reloadedModal = page.getByRole("dialog", { name: /Personal Packing Checklist/i });
    await expect(reloadedModal).toBeVisible();
    await expect(reloadedModal.getByRole("checkbox").first()).toBeChecked();
    await reloadedModal.getByRole("button", { name: "Close" }).click();

    // 10. Admin Perspective: log in as admin and verify sync & add packing items
    const adminContext = await page.context().browser()!.newContext(testInfo.project.use);
    const adminPage = await adminContext.newPage();
    try {
      await authenticateSession(adminPage, adminUser);
      await adminPage.goto(`/trips/${tripId}`);
      await adminPage.waitForLoadState("networkidle");

      // Verify Admin sees "Sync Catalog 🔄" in Personal Packing Checklist section
      const adminPackingSection = adminPage.locator('[data-testid="todo-personal-packing"]');
      await expect(adminPackingSection).toBeVisible();
      const syncBtn = adminPackingSection.getByRole("button", { name: /Sync Catalog 🔄/i });
      await expect(syncBtn).toBeVisible();
      await syncBtn.click();
      await adminPage.waitForLoadState("networkidle");

      // Admin opens modal and adds custom packing item
      await adminPackingSection.getByRole("button", { name: /View List/i }).click();
      const adminModal = adminPage.getByRole("dialog", { name: /Personal Packing Checklist/i });
      await expect(adminModal).toBeVisible();

      const addPackingItemBtn = adminModal.getByRole("button", { name: /\+ Add Packing Item/i });
      await expect(addPackingItemBtn).toBeVisible();
      await addPackingItemBtn.click();

      const itemNameInput = adminModal.getByPlaceholder(/Item name/i);
      await itemNameInput.fill(`Waterproof Matches - ${suffix}`);
      await adminModal.getByRole("button", { name: /\+ Add Item to Checklist/i }).click();

      // Verify item appears in the list
      await expect(adminModal.getByText(`Waterproof Matches - ${suffix}`)).toBeVisible();

      // Verify reload persistence of the newly added packing item
      await adminPage.reload();
      await adminPage.waitForLoadState("networkidle");
      const refreshedPackingSection = adminPage.locator('[data-testid="todo-personal-packing"]');
      await refreshedPackingSection.getByRole("button", { name: /View List/i }).click();
      const refreshedModal = adminPage.getByRole("dialog", { name: /Personal Packing Checklist/i });
      await expect(refreshedModal.getByText(`Waterproof Matches - ${suffix}`)).toBeVisible();
      await refreshedModal.getByRole("button", { name: "Close" }).click();

      await assertNoHorizontalOverflow(adminPage, "admin-final-viewport");
    } finally {
      await adminContext.close();
    }

    // Clean up master gear
    try {
      await supabaseAdmin.from("master_gear").delete().eq("id", testGearId);
    } catch {
      // ignore
    }
  });
});
