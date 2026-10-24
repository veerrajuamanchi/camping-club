import { test, expect, type Page } from "@playwright/test";
import {
  createSyntheticUser,
  cleanupSyntheticUsers,
  supabaseAdmin,
  type TestUser,
} from "./helpers/supabase-admin";
import { authenticateSession } from "./helpers/auth";

test.describe("Trip Hub, Master Catalogs, Deposit Submission, and Expense Split Verification Gate", () => {
  let adminUser: TestUser;
  let memberUser: TestUser;
  const suffix = Math.random().toString(36).slice(2, 8);
  const createdCatalogItemIds: string[] = [];
  let createdTripId: string | null = null;

  test.beforeAll(async () => {
    // Ensure club schedule timezone is configured so custom trip creation succeeds
    await supabaseAdmin
      .from("club_configuration")
      .update({ club_timezone: "America/Los_Angeles" })
      .eq("singleton", true);

    adminUser = await createSyntheticUser({
      role: "admin",
      displayName: `QA Lead (Admin) - ${suffix}`,
      emailPrefix: `admin-${suffix}`,
    });
    memberUser = await createSyntheticUser({
      role: "member",
      displayName: `Camper Jordan (Member) - ${suffix}`,
      emailPrefix: `member-${suffix}`,
    });
  });

  test.afterAll(async () => {
    if (createdTripId) {
      try {
        await supabaseAdmin.from("camping_trips").update({ deleted_at: new Date().toISOString() }).eq("id", createdTripId);
      } catch {
        // ignore
      }
    }
    for (const itemId of createdCatalogItemIds) {
      try {
        await supabaseAdmin.from("master_gear_catalog").delete().eq("id", itemId);
      } catch {
        // ignore
      }
    }
    await cleanupSyntheticUsers([adminUser, memberUser]);
  });

  async function assertNoHorizontalOverflow(page: Page, contextName: string) {
    const overflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > window.innerWidth;
    });
    expect(overflow, `Page horizontally overflows viewport at ${contextName}`).toBe(false);
  }

  test("admin manages master catalog: adds individual gear item, filters by individual, verifies reload persistence, and deletes disposable item safely", async ({
    page,
  }, testInfo) => {
    await authenticateSession(page, adminUser);
    await page.goto("/admin/catalogs");
    await page.waitForLoadState("networkidle");

    await expect(page.getByRole("heading", { name: "📦 Master Catalogs Directory" })).toBeVisible();
    await assertNoHorizontalOverflow(page, "admin-catalogs-initial");

    // 1. Add new Individual gear item with realistic formatting
    const soloTentName = `Ultralight Solo Tent (1P-Backpack) - ${suffix}`;
    const soloTentDesc = "Ripstop nylon, 3-season ultralight shelter (single camper setup).";

    await page.getByRole("button", { name: "+ Add Gear" }).click();
    const addModal = page.locator(".modal-card");
    await expect(addModal).toBeVisible();
    await assertNoHorizontalOverflow(page, "admin-catalogs-add-modal");

    await addModal.getByLabel("Item Name *").fill(soloTentName);
    await addModal.getByLabel("Gear Type *").selectOption("individual");
    await addModal.getByLabel("Category *").selectOption("shelter");
    await addModal.getByLabel("Default Quantity").fill("1");
    await addModal.getByLabel("Description").fill(soloTentDesc);

    await addModal.getByRole("button", { name: "Save Item" }).click();
    await expect(addModal).toBeHidden();

    // Track ID for cleanup
    const soloTentRow = await supabaseAdmin
      .from("master_gear_catalog")
      .select("id")
      .eq("name", soloTentName)
      .maybeSingle();
    if (soloTentRow.data?.id) {
      createdCatalogItemIds.push(soloTentRow.data.id);
    }

    // 2. Filter by [🎒 Individual] filter pill
    const individualFilterBtn = page.getByRole("button", { name: /🎒 Individual/i });
    await expect(individualFilterBtn).toBeVisible();
    await individualFilterBtn.click();

    // Verify item is visible in filtered view
    await expect(page.getByText(soloTentName)).toBeVisible();

    // 3. Mandatory reload persistence verification
    await page.reload();
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: /🎒 Individual/i }).click();
    await expect(page.getByText(soloTentName)).toBeVisible();

    // 4. Add a disposable item to verify safe deletion flow without error
    const disposableItemName = `Disposable Test Stove (Camp-Pack) - ${suffix}`;
    await page.getByRole("button", { name: "+ Add Gear" }).click();
    const deleteTestModal = page.locator(".modal-card");
    await expect(deleteTestModal).toBeVisible();

    await deleteTestModal.getByLabel("Item Name *").fill(disposableItemName);
    await deleteTestModal.getByLabel("Gear Type *").selectOption("shared");
    await deleteTestModal.getByLabel("Category *").selectOption("kitchen");
    await deleteTestModal.getByRole("button", { name: "Save Item" }).click();
    await expect(deleteTestModal).toBeHidden();

    // Verify item appeared
    await page.getByRole("button", { name: /^All \(/i }).click();
    await expect(page.getByText(disposableItemName)).toBeVisible();

    // Find card with disposable item and click 🗑️ Delete
    const disposableCard = page.locator(".event-card", { hasText: disposableItemName });
    await expect(disposableCard).toBeVisible();
    await disposableCard.getByRole("button", { name: "🗑️ Delete" }).click();

    // Verify confirmation modal with safe unlinking guarantee
    const deleteConfirmModal = page.locator(".modal-card", { hasText: "Delete Master Template" });
    await expect(deleteConfirmModal).toBeVisible();
    await expect(deleteConfirmModal.getByText("🛡️ Safe Unlinking Guarantee:")).toBeVisible();
    await assertNoHorizontalOverflow(page, "admin-catalogs-delete-modal");

    await deleteConfirmModal.getByRole("button", { name: "Confirm Delete" }).click();
    await expect(deleteConfirmModal).toBeHidden();

    // Verify item is safely removed
    await expect(page.getByText(disposableItemName)).toBeHidden();

    // Verify deletion persists after page reload
    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(disposableItemName)).toBeHidden();

    await assertNoHorizontalOverflow(page, "admin-catalogs-final");
  });

  test("trip lifecycle: admin creates trip with auto-seeded catalogs, member RSVPs Going, submits $50 deposit with reload persistence, completes 2.0x chores workload, and records shared expense with full attendee split", async ({
    page,
    browser,
  }, testInfo) => {
    test.setTimeout(180_000);

    // -------------------------------------------------------------------------
    // Phase A: Admin creates custom trip and configures 2.0x workload duties
    // -------------------------------------------------------------------------
    await authenticateSession(page, adminUser);
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const tripTitle = `High Sierra Alpine Camp (Cabin #3) - ${suffix}`;
    const tripStartDate = "2027-08-13"; // Friday
    const tripEndDate = "2027-08-15"; // Sunday

    await page.getByRole("button", { name: "+ Add Custom Camping" }).click();
    const createTripModal = page.locator(".modal-card");
    await expect(createTripModal).toBeVisible();

    await createTripModal.getByLabel("Event Name *").fill(tripTitle);
    await createTripModal.getByLabel(/Trip start date/i).fill(tripStartDate);
    await createTripModal.getByLabel(/Trip end date/i).fill(tripEndDate);
    await createTripModal.getByRole("combobox", { name: "Camping Type" }).selectOption("cabin");
    await createTripModal.getByRole("combobox", { name: "Event Status" }).selectOption("confirmed");
    await createTripModal.getByRole("combobox", { name: "Cabin Booking Status" }).selectOption("booked");
    await createTripModal.getByLabel("Camping Type Sites Count").fill("2");
    await createTripModal.getByLabel("Camping Type Site Capacity").fill("6");
    await createTripModal.getByLabel("Minimum participants").fill("4");

    await createTripModal.getByRole("button", { name: "Save Custom Camping" }).click();
    await expect(createTripModal).toBeHidden();

    // Find card and capture trip URL
    const tripCard = page.locator(".event-card-container", { hasText: tripTitle });
    await expect(tripCard).toBeVisible();
    const tripHref = await tripCard.locator("a.view-details-link").getAttribute("href");
    expect(tripHref).toBeTruthy();

    const tripIdMatch = tripHref!.match(/\/trips\/([0-9a-fA-F-]+)/);
    if (tripIdMatch) {
      createdTripId = tripIdMatch[1];
    }

    // Navigate to Trip Details
    await page.goto(tripHref!);
    await page.waitForLoadState("networkidle");
    await expect(page.locator("h1.hero-title")).toHaveText(tripTitle);

    // Verify catalog items were auto-included in Logistics & Packing
    await page.getByRole("tab", { name: "Logistics & Packing" }).click();
    await expect(page.getByRole("heading", { name: /Trip Commitments/i })).toBeVisible();
    // Verify auto-seeded commitments container has items
    const commitmentsCount = await page.locator(".card", { hasText: "Trip Commitments" }).locator(".rsvp-pill-btn").first().innerText();
    expect(commitmentsCount).toMatch(/All Items \([1-9][0-9]*\)/);

    // Admin RSVPs Going to establish attendees list for the expense split
    await page.getByRole("tab", { name: "Overview & attendees" }).click();
    await page.getByRole("button", { name: "Going", exact: true }).click();
    await page.getByLabel("I have read and agree to the Camping Constitution.").check();
    await page.getByRole("button", { name: "Confirm Going" }).click();
    const adminPromptModal = page.locator(".modal-overlay");
    await expect(adminPromptModal).toBeVisible();
    await adminPromptModal.getByRole("button", { name: "I'll choose later" }).click();
    await expect(adminPromptModal).toBeHidden();
    await expect(page.locator(".status-badge-going").first()).toBeVisible();

    // Admin sets up Tasks & Meals: 2.0x daily workload target and chore slots
    await page.getByRole("tab", { name: "Tasks & Meals" }).click();
    await page.waitForLoadState("networkidle");

    // Enable daily workload target = 2.0x
    const summary = page.locator("summary", { hasText: "Configure Daily Workload Target" });
    await expect(summary).toBeVisible();
    const workloadDetails = page.locator("details", { has: summary });
    const isOpen = await workloadDetails.evaluate((el: HTMLDetailsElement) => el.open);
    if (!isOpen) {
      await summary.click();
    }
    const targetCheckbox = page.getByLabel("Use a daily workload target for this trip");
    await expect(targetCheckbox).toBeVisible();
    if (!(await targetCheckbox.isChecked())) {
      await targetCheckbox.check();
    }
    await page.getByLabel("Daily workload target (×)", { exact: true }).fill("2");
    await page.getByRole("button", { name: "Save daily target" }).click();

    // Open Daily Responsibility Planner
    await page.getByRole("button", { name: /Manage Meals & Chores/ }).click();
    const plannerModal = page.getByRole("dialog", { name: "Manage Meal & Chore Slots" });
    await expect(plannerModal).toBeVisible();
    await expect(plannerModal.getByRole("button", { name: "Save daily responsibilities" })).toBeVisible();

    // Check responsibilities on dates: select Vegetable Prep, Dishes, and Campfire on day 1
    const day1Fieldset = plannerModal.getByRole("group", { name: new RegExp(tripStartDate) });
    await day1Fieldset.getByLabel(/Vegetable Prep/i).check();
    await day1Fieldset.getByLabel(/Dishes & Kitchen Cleanup/i).check();
    await day1Fieldset.getByLabel(/Campfire & Firewood Setup/i).check();

    // Day 2 (Saturday)
    const day2Fieldset = plannerModal.getByRole("group", { name: /2027-08-14/ });
    await day2Fieldset.getByLabel(/Dishes & Kitchen Cleanup/i).check();

    // Day 3 (Sunday)
    const day3Fieldset = plannerModal.getByRole("group", { name: /2027-08-15/ });
    await day3Fieldset.getByLabel(/Dishes & Kitchen Cleanup/i).check();

    await plannerModal.getByRole("button", { name: "Save daily responsibilities" }).click();
    await plannerModal.getByRole("button", { name: "Done" }).click();
    await expect(plannerModal).toBeHidden();

    // Verify duties appear on the Tasks & Meals tab
    await expect(page.getByText("Vegetable Prep").first()).toBeVisible();
    await expect(page.getByText("Dishes & Kitchen Cleanup").first()).toBeVisible();
    await expect(page.getByText("Campfire & Firewood Setup").first()).toBeVisible();

    // -------------------------------------------------------------------------
    // Phase B: Member logs in, RSVPs Going, and verifies Trip Hub
    // -------------------------------------------------------------------------
    const memberContext = await browser.newContext(testInfo.project.use);
    const memberPage = await memberContext.newPage();

    try {
      await authenticateSession(memberPage, memberUser);
      await memberPage.goto(tripHref!);
      await memberPage.waitForLoadState("networkidle");
      await assertNoHorizontalOverflow(memberPage, "member-trip-initial");

      // Submit RSVP "Going"
      await memberPage.getByRole("button", { name: "Going", exact: true }).click();
      await memberPage.getByLabel("I have read and agree to the Camping Constitution.").check();
      await memberPage.getByRole("button", { name: "Confirm Going" }).click();

      // Dismiss post-RSVP celebration modal
      const dutyModal = memberPage.locator(".modal-overlay");
      await expect(dutyModal).toBeVisible();
      await dutyModal.getByRole("button", { name: "I'll choose later" }).click();
      await expect(dutyModal).toBeHidden();

      // Verify Going status badge
      await expect(memberPage.locator(".status-badge-going").first()).toBeVisible();

      // -----------------------------------------------------------------------
      // Phase C: $50 Cabin Deposit: Click "I Have Sent $50" & Verify Reload Persistence
      // -----------------------------------------------------------------------
      const depositRow = memberPage.locator('[data-testid="hub-deposit-row"]');
      await expect(depositRow).toBeVisible();
      await expect(depositRow.getByText("Pending")).toBeVisible();

      const sendDepositBtn = depositRow.getByRole("button", { name: "I Have Sent $50" });
      await expect(sendDepositBtn).toBeVisible();
      await sendDepositBtn.click();

      // Verify status updates to Submitted
      await expect(depositRow.getByText(/Submitted \(Pending Verification\)/)).toBeVisible();
      await expect(depositRow.getByText(/Submitted ⏳/)).toBeVisible();

      // Verify reload persistence
      await memberPage.reload();
      await memberPage.waitForLoadState("networkidle");
      const reloadedDepositRow = memberPage.locator('[data-testid="hub-deposit-row"]');
      await expect(reloadedDepositRow.getByText(/Submitted \(Pending Verification\)/)).toBeVisible();
      await expect(reloadedDepositRow.getByText(/Submitted ⏳/)).toBeVisible();
      await expect(reloadedDepositRow.getByRole("button", { name: "I Have Sent $50" })).toHaveCount(0);

      // -----------------------------------------------------------------------
      // Phase D: Select daily chores reaching 2.0x target -> grey out remaining chores
      // -----------------------------------------------------------------------
      await memberPage.getByRole("tab", { name: "Tasks & Meals" }).click();
      await memberPage.waitForLoadState("networkidle");
      await assertNoHorizontalOverflow(memberPage, "member-tasks-tab");

      // Locate duties on Day 1
      const vegRow = memberPage.locator(".duty-item-row", { hasText: "Vegetable Prep" });
      await expect(vegRow).toBeVisible();
      await vegRow.getByRole("button", { name: "Volunteer" }).click();
      await expect(vegRow.getByRole("button", { name: "Drop Task" })).toBeVisible();

      const dishesRow = memberPage.locator(".duty-item-row", { hasText: "Dishes & Kitchen Cleanup" }).first();
      await expect(dishesRow).toBeVisible();
      await dishesRow.getByRole("button", { name: "Volunteer" }).click();
      await expect(dishesRow.getByRole("button", { name: "Drop Task" })).toBeVisible();

      // Target (2.0x) is now reached on Day 1. Verify remaining chore is disabled/greyed out
      const campfireRow = memberPage.locator(".duty-item-row", { hasText: "Campfire & Firewood Setup" });
      await expect(campfireRow).toBeVisible();
      const doneBtn = campfireRow.getByRole("button", { name: "Done for Day" });
      await expect(doneBtn).toBeVisible();
      await expect(doneBtn).toBeDisabled();

      // Verify reload persistence of 2.0x target and greyed out remaining chore
      await memberPage.reload();
      await memberPage.waitForLoadState("networkidle");
      await memberPage.getByRole("tab", { name: "Tasks & Meals" }).click();

      const reloadedCampfireRow = memberPage.locator(".duty-item-row", { hasText: "Campfire & Firewood Setup" });
      const reloadedDoneBtn = reloadedCampfireRow.getByRole("button", { name: "Done for Day" });
      await expect(reloadedDoneBtn).toBeVisible();
      await expect(reloadedDoneBtn).toBeDisabled();

      // Verify day target indicator reflects completed chores
      await expect(memberPage.getByText(/Daily chores selected|Target Met/i).first()).toBeVisible();

      // -----------------------------------------------------------------------
      // Phase E: Financials: Add Shared Expense with full attendee names split
      // -----------------------------------------------------------------------
      await memberPage.getByRole("tab", { name: "Financials" }).click();
      await memberPage.waitForLoadState("networkidle");
      await assertNoHorizontalOverflow(memberPage, "member-financials-tab");

      const addExpenseBtn = memberPage.getByRole("button", { name: "+ Add Shared Expense" });
      await expect(addExpenseBtn).toBeVisible();
      await addExpenseBtn.click();

      // Verify modal opened
      await expect(memberPage.getByRole("heading", { name: "+ Record Shared Expense" })).toBeVisible();
      await assertNoHorizontalOverflow(memberPage, "member-expense-modal");

      // Switch to Custom Subset so participant list and checkboxes are visible
      await memberPage.getByLabel(/Custom Subset/i).click();

      // Verify full attendee names are visible next to checkboxes
      const splitList = memberPage.getByTestId("expense-split-list");
      await expect(splitList).toBeVisible();
      await expect(splitList.getByText(memberUser.displayName)).toBeVisible();
      await expect(splitList.getByText(adminUser.displayName)).toBeVisible();

      // Fill expense details with realistic formatted data
      const expenseDesc = `Campfire S'mores & Roasting Supplies (Family Pack) - ${suffix}`;
      await memberPage.getByPlaceholder(/e.g. S'mores/i).fill(expenseDesc);
      await memberPage.getByPlaceholder("25.00").fill("34.50");

      // Select split using Select All
      await memberPage.getByRole("button", { name: "Select All" }).click();

      // Submit and save expense
      await memberPage.getByRole("button", { name: "Save Expense" }).click();
      await expect(memberPage.getByRole("heading", { name: "+ Record Shared Expense" })).toBeHidden();

      // Verify expense appears in shared expenses list
      await expect(memberPage.getByText(expenseDesc)).toBeVisible();
      await expect(memberPage.getByText("$34.50").first()).toBeVisible();

      // Verify reload persistence of saved expense
      await memberPage.reload();
      await memberPage.waitForLoadState("networkidle");
      await memberPage.getByRole("tab", { name: "Financials" }).click();
      await expect(memberPage.getByText(expenseDesc)).toBeVisible();
      await expect(memberPage.getByText("$34.50").first()).toBeVisible();

      // Final viewport verification
      await assertNoHorizontalOverflow(memberPage, "member-final-viewport");
    } finally {
      await memberContext.close();
    }
  });
});
