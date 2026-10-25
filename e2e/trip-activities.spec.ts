import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import {
  createSyntheticUser,
  cleanupSyntheticUsers,
  supabaseAdmin,
  type TestUser,
} from "./helpers/supabase-admin";
import { authenticateSession } from "./helpers/auth";

test.describe("Trip Activities, Master Catalog, Pairings, Voucher Posting, and Call Sheet Acceptance Gate", () => {
  let adminUser: TestUser;
  let memberUser: TestUser;
  const suffix = Math.random().toString(36).slice(2, 8);
  let createdTripId: string | null = null;
  const createdMasterActivityIds: string[] = [];
  let memberContext: BrowserContext | null = null;

  test.beforeAll(async () => {
    // Ensure club timezone is set for custom trip creation
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
    if (memberContext) {
      try {
        await memberContext.close();
      } catch {
        // ignore
      }
    }
    if (createdTripId) {
      try {
        await supabaseAdmin
          .from("camping_trips")
          .update({ deleted_at: new Date().toISOString() })
          .eq("id", createdTripId);
      } catch {
        // ignore
      }
    }
    for (const masterId of createdMasterActivityIds) {
      try {
        await supabaseAdmin.from("master_activities").delete().eq("id", masterId);
      } catch {
        // ignore
      }
    }
    try {
      await supabaseAdmin.from("master_activities").delete().ilike("title", `%${suffix}%`);
    } catch {
      // ignore
    }
    if (adminUser || memberUser) {
      await cleanupSyntheticUsers([adminUser, memberUser].filter(Boolean));
    }
  });

  async function assertNoHorizontalOverflow(page: Page, contextName: string) {
    const overflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > window.innerWidth;
    });
    expect(overflow, `Page horizontally overflows viewport at ${contextName}`).toBe(false);
  }

  async function setupClipboardStub(page: Page) {
    await page.addInitScript(() => {
      let clipText = "";
      Object.defineProperty(navigator, "clipboard", {
        value: {
          writeText: async (t: string) => {
            clipText = t;
            return Promise.resolve();
          },
          readText: async () => Promise.resolve(clipText),
        },
        configurable: true,
      });
    });
  }

  test("end-to-end activities lifecycle: master catalog template, trip cloning, 5-item scorecard, pairings, voucher reload persistence, dynamic ledger posting, and call sheet", async ({
    page,
    browser,
  }, testInfo) => {
    test.setTimeout(180_000);
    await setupClipboardStub(page);

    // =========================================================================
    // Journey 1: Admin manages Master Activity Catalog
    // =========================================================================
    await authenticateSession(page, adminUser);
    await page.goto("/admin/catalogs");
    await page.waitForLoadState("networkidle");

    await expect(page.getByRole("heading", { name: "📦 Master Catalogs Directory" })).toBeVisible();
    await assertNoHorizontalOverflow(page, "admin-catalogs-initial");

    // Open 🎯 Activities tab
    await page.getByRole("tab", { name: /Activities/i }).click();
    await expect(page.getByRole("heading", { name: "🎯 Activity Templates" })).toBeVisible();
    await assertNoHorizontalOverflow(page, "admin-catalogs-activities-tab");

    // Add new Master Activity Template
    const masterActivityTitle = `Monterey GoCar 2-Hour Scenic Tour - ${suffix}`;
    const masterImageUrl =
      "https://gocartours.com/wp-content/uploads/2022/11/gocar-experience-monterey-e1669051849670.jpeg";
    const masterAddress = "700 Cannery Row, Monterey, CA 93940";
    const masterNotes = "Use Groupon promo code Halloween for $174.60 per car";
    const masterBookingUrl = "https://www.groupon.com/deals/gocar-experience-monterey";
    const masterWaiverUrl = "https://fareharbor.com/waivers?shortname=seacartours&test=1";

    await page.getByRole("button", { name: "+ Add Activity Template" }).click();
    const addActivityModal = page.locator(".modal-card", { hasText: "Add Activity Template" });
    await expect(addActivityModal).toBeVisible();
    await assertNoHorizontalOverflow(page, "admin-catalogs-add-modal");

    await addActivityModal.getByLabel("Activity Title *").fill(masterActivityTitle);
    await addActivityModal.getByLabel("Category *").selectOption("tour");
    await addActivityModal.getByLabel("Unit Label *").fill("GoCar");
    await addActivityModal.getByLabel("Unit Capacity *").fill("2");
    await addActivityModal.getByLabel("Image URL").fill(masterImageUrl);
    await addActivityModal.getByLabel("Physical Address").fill(masterAddress);
    await addActivityModal.getByLabel("Booking / Signup URL (e.g. Groupon)").fill(masterBookingUrl);
    await addActivityModal.getByLabel("Activity Waiver URL (Optional)").fill(masterWaiverUrl);
    await addActivityModal.getByLabel("Booking Notes").fill(masterNotes);

    await addActivityModal.getByRole("button", { name: "Save Template" }).click();
    await expect(addActivityModal).toBeHidden();

    // Verify card renders with capacity badge 👥 2 per GoCar, booking link, and waiver link
    const activityCard = page.locator(".event-card", { hasText: masterActivityTitle });
    await expect(activityCard).toBeVisible();
    await expect(activityCard.getByText("👥 2 per GoCar")).toBeVisible();
    const bookingLink = activityCard.getByRole("link", { name: "🎟️ Booking / Deal Link" });
    await expect(bookingLink).toBeVisible();
    await expect(bookingLink).toHaveAttribute("href", masterBookingUrl);
    const waiverLink = activityCard.getByRole("link", { name: "📝 Waiver Form" });
    await expect(waiverLink).toBeVisible();
    await expect(waiverLink).toHaveAttribute("href", masterWaiverUrl);

    // Track ID for cleanup
    const masterRow = await supabaseAdmin
      .from("master_activities")
      .select("id")
      .eq("title", masterActivityTitle)
      .maybeSingle();
    if (masterRow.data?.id) {
      createdMasterActivityIds.push(masterRow.data.id);
    }

    // Verify reload persistence from Supabase PostgreSQL
    await page.reload();
    await page.waitForLoadState("networkidle");
    await page.getByRole("tab", { name: /Activities/i }).click();
    const reloadedCard = page.locator(".event-card", { hasText: masterActivityTitle });
    await expect(reloadedCard).toBeVisible();
    await expect(reloadedCard.getByText("👥 2 per GoCar")).toBeVisible();
    const reloadedBookingLink = reloadedCard.getByRole("link", { name: "🎟️ Booking / Deal Link" });
    await expect(reloadedBookingLink).toBeVisible();
    await expect(reloadedBookingLink).toHaveAttribute("href", masterBookingUrl);
    const reloadedWaiverLink = reloadedCard.getByRole("link", { name: "📝 Waiver Form" });
    await expect(reloadedWaiverLink).toBeVisible();
    await expect(reloadedWaiverLink).toHaveAttribute("href", masterWaiverUrl);
    await assertNoHorizontalOverflow(page, "admin-catalogs-activities-reloaded");

    // =========================================================================
    // Journey 2: Trip Activities, Pairings, and Upfront Choice
    // =========================================================================
    // Admin creates custom trip and navigates to trip details
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const tripTitle = `Monterey Coastal Excursion (GoCars & Slough) - ${suffix}`;
    const tripStartDate = "2027-09-10"; // Friday
    const tripEndDate = "2027-09-12"; // Sunday

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

    // Locate trip card and navigate
    const tripCard = page.locator(".event-card-container", { hasText: tripTitle });
    await expect(tripCard).toBeVisible();
    const tripHref = await tripCard.locator("a.view-details-link").getAttribute("href");
    expect(tripHref).toBeTruthy();

    const tripIdMatch = tripHref!.match(/\/trips\/([0-9a-fA-F-]+)/);
    if (tripIdMatch) {
      createdTripId = tripIdMatch[1];
    }

    await page.goto(tripHref!);
    await page.waitForLoadState("networkidle");
    await expect(page.locator("h1.hero-title")).toHaveText(tripTitle);
    await assertNoHorizontalOverflow(page, "admin-trip-overview");

    // Admin clones master activity into Saturday of trip
    await page.getByRole("tab", { name: "🎯 Activities" }).click();
    await page.waitForLoadState("networkidle");
    await assertNoHorizontalOverflow(page, "admin-trip-activities-empty");

    await page.getByRole("button", { name: "+ Add Activity", exact: true }).click();
    const addTripActModal = page.locator(".modal-card", { hasText: "Add Activity to Trip" });
    await expect(addTripActModal).toBeVisible();

    await addTripActModal
      .getByLabel("Select Activity Template *")
      .selectOption(createdMasterActivityIds[0]);
    await addTripActModal.getByLabel("Activity Date *").fill("2027-09-11"); // Saturday
    await addTripActModal.getByRole("button", { name: "Add to Trip" }).click();
    await expect(addTripActModal).toBeHidden();

    // Verify activity card is visible on trip Activities tab
    await expect(page.getByRole("heading", { name: masterActivityTitle })).toBeVisible();

    // Admin RSVPs Going to establish confirmed attendees roster
    await page.getByRole("tab", { name: "Overview & attendees" }).click();
    await page.getByRole("button", { name: "Going", exact: true }).click();
    await page.getByLabel("I have read and agree to the Camping Constitution.").check();
    await page.getByRole("button", { name: "Confirm Going" }).click();
    const adminPromptModal = page.locator(".modal-overlay");
    await expect(adminPromptModal).toBeVisible();
    await adminPromptModal.getByRole("button", { name: "I'll choose later" }).click();
    await expect(adminPromptModal).toBeHidden();

    // Admin opts into activity upfront
    const adminActivityRow = page.locator('[data-testid="hub-activity-row"]');
    await expect(adminActivityRow).toBeVisible();
    await adminActivityRow.getByRole("button", { name: "✓ Count Me In! 🚗" }).click();
    await expect(adminActivityRow.getByText("Waiver Pending ⚠️")).toBeVisible();

    // Configure trip task quota to 0 so member's duty progress is satisfied
    await supabaseAdmin
      .from("camping_trips")
      .update({ task_quota_target: 0 })
      .eq("id", createdTripId!);

    // Member joins trip
    memberContext = await browser.newContext(testInfo.project.use);
    const memberPage = await memberContext.newPage();
    await setupClipboardStub(memberPage);

    await authenticateSession(memberPage, memberUser);
    await memberPage.goto(tripHref!);
    await memberPage.waitForLoadState("networkidle");
    await assertNoHorizontalOverflow(memberPage, "member-trip-initial");

    // Member submits RSVP Going
    await memberPage.getByRole("button", { name: "Going", exact: true }).click();
    await memberPage.getByLabel("I have read and agree to the Camping Constitution.").check();
    await memberPage.getByRole("button", { name: "Confirm Going" }).click();
    const memberPromptModal = memberPage.locator(".modal-overlay");
    await expect(memberPromptModal).toBeVisible();
    await memberPromptModal.getByRole("button", { name: "I'll choose later" }).click();
    await expect(memberPromptModal).toBeHidden();

    // Member submits $50 cabin deposit
    const memberDepositRow = memberPage.locator('[data-testid="hub-deposit-row"]');
    await expect(memberDepositRow).toBeVisible();
    await memberDepositRow.getByRole("button", { name: "I Have Sent $50" }).click();
    await expect(memberDepositRow.getByText(/Submitted \(Pending Verification\)/i)).toBeVisible();

    // Member verifies 5-item readiness scorecard displays "4 of 5 Completed" (Action Needed)
    await expect(
      memberPage.getByText(/⚡ Required From You \(4 of 5 Completed\)/i)
    ).toBeVisible();
    await expect(memberPage.getByText("Action Needed").first()).toBeVisible();

    const memberActivityRow = memberPage.locator('[data-testid="hub-activity-row"]');
    await expect(memberActivityRow).toBeVisible();
    await expect(memberActivityRow.getByText("Signature Activity")).toBeVisible();
    await assertNoHorizontalOverflow(memberPage, "member-scorecard-4-of-5");

    // Member clicks "Count Me In! 🚗"
    await memberActivityRow.getByRole("button", { name: "✓ Count Me In! 🚗" }).click();

    // Since activity requires waiver, scorecard displays waiver required pending state
    await expect(memberActivityRow.getByText(/📝 Waiver Required/i)).toBeVisible();
    await expect(memberActivityRow.getByText("Waiver Pending ⚠️")).toBeVisible();
    const signWaiverBtn = memberActivityRow.getByRole("button", { name: "Sign Waiver →" });
    await expect(signWaiverBtn).toBeVisible();

    // Member clicks "Sign Waiver →" to navigate to Activities tab
    await signWaiverBtn.click();
    await expect(memberPage.getByRole("tab", { name: "🎯 Activities" })).toHaveAttribute("aria-selected", "true");

    // Member sees Operator Liability Waiver banner
    const waiverBanner = memberPage.locator('[data-testid="waiver-status-card"]');
    await expect(waiverBanner).toBeVisible();
    await expect(waiverBanner.getByText("Activity Liability Waiver Required")).toBeVisible();

    // "I Have Signed the Waiver" button must be disabled until user clicks Open Waiver Form
    const confirmSignedBtn = waiverBanner.getByRole("button", { name: /I Have Signed the Waiver/i });
    await expect(confirmSignedBtn).toBeDisabled();

    // Member clicks "Open Waiver Form ↗" (triggers onClick to record click)
    const openWaiverLink = waiverBanner.getByRole("link", { name: /Open Waiver Form/i });
    await expect(openWaiverLink).toHaveAttribute("href", masterWaiverUrl);
    await openWaiverLink.dispatchEvent("click");

    // Button should now be unlocked/enabled
    await expect(confirmSignedBtn).toBeEnabled();

    // Member clicks "I Have Signed the Waiver ✓"
    await confirmSignedBtn.click();
    await expect(waiverBanner.getByText("Activity Liability Waiver Completed & Signed")).toBeVisible();

    // Return to Overview tab and verify 5-item scorecard shows all completed with waiver signed
    await memberPage.getByRole("tab", { name: "Overview & attendees" }).click();
    await memberPage.waitForLoadState("networkidle");

    await expect(
      memberPage.getByText(/⚡ Required From You \(5 of 5 Completed\)/i)
    ).toBeVisible();
    await expect(memberPage.getByText("All Done ✓").first()).toBeVisible();
    await expect(memberActivityRow.getByText(/✓ Waiver Signed/i)).toBeVisible();
    await expect(memberActivityRow.getByText("Attending ✓")).toBeVisible();
    await assertNoHorizontalOverflow(memberPage, "member-scorecard-5-of-5");

    // Member verifies Compact Activity Card renders after the scorecard on Overview tab
    const overviewCard = memberPage.getByTestId("hub-activity-overview-card");
    await expect(overviewCard).toBeVisible();
    await expect(overviewCard.locator(`img[alt="${masterActivityTitle}"]`)).toBeVisible();
    await expect(overviewCard.getByRole("button", { name: masterActivityTitle })).toBeVisible();
    await expect(overviewCard.getByText(/Saturday, Sep 11/i)).toBeVisible();
    await expect(overviewCard.getByText(masterAddress)).toBeVisible();

    const overviewDealLink = overviewCard.getByRole("link", {
      name: "🎟️ Buy on Groupon / Booking Link →",
    });
    await expect(overviewDealLink).toBeVisible();
    await expect(overviewDealLink).toHaveAttribute("href", masterBookingUrl);
    await assertNoHorizontalOverflow(memberPage, "member-overview-compact-card");

    // Verify clicking "View Activity & Pairings →" navigates to 🎯 Activities tab
    await overviewCard.getByRole("button", { name: "View Activity & Pairings →" }).click();
    await expect(memberPage.getByRole("tab", { name: "🎯 Activities" })).toHaveAttribute("aria-selected", "true");
    await expect(memberPage.getByRole("heading", { name: masterActivityTitle })).toBeVisible();

    // Verify scorecard Item #5 link also navigates to 🎯 Activities tab
    await memberPage.getByRole("tab", { name: "Overview & attendees" }).click();
    await memberPage.waitForLoadState("networkidle");
    await memberPage.locator(".hub-activity-row-btn").click();
    await expect(memberPage.getByRole("tab", { name: "🎯 Activities" })).toHaveAttribute("aria-selected", "true");

    // =========================================================================
    // Journey 3: Admin Multi-Vehicle & Manual Assignment
    // =========================================================================
    // In Admin's view on Activities tab:
    await page.getByRole("tab", { name: "🎯 Activities" }).click();
    await page.waitForLoadState("networkidle");

    // Admin clicks "+ Add Vehicle" to create GoCar #1
    await page.getByRole("button", { name: "+ Add Vehicle" }).click();
    await expect(page.getByRole("heading", { name: "GoCar #1" })).toBeVisible();

    // Admin clicks "+ Add Vehicle" and verifies a second vehicle group (GoCar #2) is created directly without auto-shuffle!
    await page.getByRole("button", { name: "+ Add Vehicle" }).click();
    await expect(page.getByRole("heading", { name: "GoCar #2" })).toBeVisible();
    await assertNoHorizontalOverflow(page, "admin-activities-multi-vehicle");

    // Admin clicks "Assign Campers" on GoCar #1, selects Member and Admin in the dropdown slots, and saves
    await page.getByRole("button", { name: "Assign Campers" }).first().click();

    const assignModal = page.locator(".modal-card", { hasText: "Assign Campers - GoCar #1" });
    await expect(assignModal).toBeVisible();
    await assertNoHorizontalOverflow(page, "admin-assign-campers-modal");

    await assignModal.getByLabel("Slot 1").selectOption(memberUser.memberId);
    await assignModal.getByLabel("Slot 2").selectOption(adminUser.memberId);
    await assignModal.getByRole("button", { name: "Save Assignments" }).click();
    await expect(assignModal).toBeHidden();

    // Verify pairings completed on admin's page
    await expect(
      page.getByText(`✓ You are Riding with ${memberUser.displayName} (GoCar #1)`)
    ).toBeVisible();

    // =========================================================================
    // Journey 4: Participant Focused Vehicle View & Voucher Submission
    // =========================================================================
    // Member reloads to fetch updated assignments and navigates to Activities tab
    await memberPage.reload();
    await memberPage.waitForLoadState("networkidle");
    await memberPage.getByRole("tab", { name: "🎯 Activities" }).click();
    await memberPage.waitForLoadState("networkidle");
    await assertNoHorizontalOverflow(memberPage, "member-activities-tab");

    // Member sees ONLY their assigned vehicle (GoCar #1) under "🏎️ Your Assigned Vehicle"
    await expect(memberPage.getByText("🏎️ Your Assigned Vehicle")).toBeVisible();
    await expect(memberPage.getByRole("heading", { name: "GoCar #1" })).toBeVisible();
    await expect(
      memberPage.getByText(`✓ You are Riding with ${adminUser.displayName} (GoCar #1)`)
    ).toBeVisible();

    // Member does NOT see GoCar #2
    await expect(memberPage.getByText("GoCar #2")).not.toBeVisible();

    // Member verifies initial status shows "⚠️ VOUCHER NEEDED" on GoCar #1 card
    await expect(memberPage.getByText("⚠️ VOUCHER NEEDED").first()).toBeVisible();

    // Member opens "Enter Voucher Details" modal
    await memberPage.getByRole("button", { name: "+ Enter Voucher Details" }).first().click();
    const voucherModal = memberPage.locator(".modal-card", { hasText: "Enter Voucher Details" });
    await expect(voucherModal).toBeVisible();
    await assertNoHorizontalOverflow(memberPage, "member-voucher-modal");

    const orderRef = `GP-99214-${suffix}`;
    await voucherModal.getByLabel("Purchase Date").fill("2026-10-20");
    await voucherModal.getByLabel("Groupon Order / Ref #").fill(orderRef);
    await voucherModal.getByLabel("Redemption / Voucher Code").fill("GP-99214-X");
    await voucherModal.getByLabel("Security Code / PIN").fill("7821");
    await voucherModal.getByLabel("Amount in Dollars").fill("174.60");

    await voucherModal.getByRole("button", { name: /(Save|Submit) Voucher/i }).click();
    await expect(voucherModal).toBeHidden();

    // Verifies voucher status badge updates to "✓ READY"
    await expect(memberPage.getByText("✓ READY").first()).toBeVisible();

    // Verifies reload persistence from Supabase PostgreSQL
    await memberPage.reload();
    await memberPage.waitForLoadState("networkidle");
    await memberPage.getByRole("tab", { name: "🎯 Activities" }).click();
    await memberPage.waitForLoadState("networkidle");
    await expect(memberPage.getByText("✓ READY").first()).toBeVisible();
    await expect(memberPage.getByText("🏎️ Your Assigned Vehicle")).toBeVisible();
    await expect(memberPage.getByRole("heading", { name: "GoCar #1" })).toBeVisible();
    await expect(memberPage.getByText("GoCar #2")).not.toBeVisible();
    await assertNoHorizontalOverflow(memberPage, "member-voucher-persisted-reload");

    // =========================================================================
    // Journey 5: Shared Expense Dynamic Posting & Tour Operator Call Sheet
    // =========================================================================
    // Member navigates to Financials tab and verifies shared expense was automatically posted
    await memberPage.getByRole("tab", { name: "Financials" }).click();
    await memberPage.waitForLoadState("networkidle");
    await assertNoHorizontalOverflow(memberPage, "member-financials-tab");

    // Verifies expense details: $174.60, title containing Voucher, All Attendees (Dynamic)
    await expect(memberPage.getByText("$174.60").first()).toBeVisible();
    await expect(memberPage.getByText(/Voucher/i).first()).toBeVisible();
    await expect(memberPage.getByText(/All Attendees \(Dynamic\)/i).first()).toBeVisible();

    // Admin reloads page to fetch updated PostgreSQL state and navigates to Activities tab
    await page.reload();
    await page.waitForLoadState("networkidle");
    await page.getByRole("tab", { name: "🎯 Activities" }).click();
    await page.waitForLoadState("networkidle");

    // Admin opens "📞 Tour Operator Call Sheet"
    await page.getByRole("button", { name: "📞 Tour Operator Call Sheet" }).click();
    const callSheetModal = page.locator(".modal-card", { hasText: "Tour Operator Call Sheet" });
    await expect(callSheetModal).toBeVisible();
    await assertNoHorizontalOverflow(page, "admin-call-sheet-modal");

    // Verifies formatted manifest table showing vehicles, riders, order #, voucher code, PIN, status
    await expect(callSheetModal.getByText("GoCar #1")).toBeVisible();
    await expect(callSheetModal.getByText(orderRef)).toBeVisible();
    await expect(callSheetModal.getByText("7821")).toBeVisible();
    await expect(callSheetModal.getByText("purchased").first()).toBeVisible();

    // Verifies rider waiver badge and Participant Waiver Completion Roster table
    await expect(callSheetModal.getByTestId(`rider-waiver-status-${memberUser.memberId}`)).toHaveText("✓ Signed");
    const waiverRoster = callSheetModal.getByTestId("call-sheet-waiver-roster");
    await expect(waiverRoster).toBeVisible();
    await expect(waiverRoster.getByText(memberUser.displayName)).toBeVisible();

    // Admin clicks "📋 Copy All to Clipboard" and verifies feedback
    await callSheetModal.getByRole("button", { name: "📋 Copy All to Clipboard" }).click();
    await expect(callSheetModal.getByText("✓ Copied to Clipboard!")).toBeVisible();

    await callSheetModal.getByRole("button", { name: /Close/i }).first().click();
    await expect(callSheetModal).toBeHidden();
  });
});
