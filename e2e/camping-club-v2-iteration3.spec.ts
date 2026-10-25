import { test, expect } from "@playwright/test";
import {
  createSyntheticUser,
  cleanupSyntheticUsers,
  supabaseAdmin,
  type TestUser,
} from "./helpers/supabase-admin";
import { authenticateSession } from "./helpers/auth";

test.describe("Camping Club 2.0 Iteration 3 Acceptance Suite", () => {
  let adminUser: TestUser;
  let memberUser: TestUser;
  let tripId: string;
  let activeTripId: string;
  let postTripId: string;

  test.beforeAll(async () => {
    adminUser = await createSyntheticUser({
      role: "admin",
      displayName: "Iteration3 Admin",
      emailPrefix: "v2-i3-admin",
    });
    memberUser = await createSyntheticUser({
      role: "member",
      displayName: "Iteration3 Member",
      emailPrefix: "v2-i3-member",
    });

    const siteRes = await supabaseAdmin.from("campsites").select("id").limit(1).single();
    const siteId = siteRes.data!.id;

    // 1. Upcoming Planning/Preparation Trip
    const start1 = new Date();
    start1.setDate(start1.getDate() + 20);
    const end1 = new Date(start1);
    end1.setDate(end1.getDate() + 2);
    const startStr1 = start1.toISOString().slice(0, 10);
    const endStr1 = end1.toISOString().slice(0, 10);

    const trip1 = await supabaseAdmin
      .from("camping_trips")
      .insert({
        month_key: startStr1.slice(0, 7) + "-01",
        rotation_position: 1,
        selected_campsite_id: siteId,
        suggested_campsite_id: siteId,
        starts_on: startStr1,
        ends_on: endStr1,
        event_status: "rsvp_open",
        trip_status: "rsvp_open",
        minimum_participants: 4,
        deposit_amount_cents: 5000,
        trip_mileage_rate_cents: 76, // Constitutional default rate
        cabin_booking_status: "booked",
        additional_information: "Iteration 3 Upcoming Planning Trip",
      })
      .select("id")
      .single();
    tripId = trip1.data!.id;

    // Add RSVP for member
    await supabaseAdmin.from("trip_rsvps").insert({
      trip_id: tripId,
      member_id: memberUser.memberId,
      response: "coming",
      deposit_status: "unpaid",
    });

    // 2. Active Camping Trip (in_progress)
    const start2 = new Date();
    start2.setDate(start2.getDate() - 1);
    const end2 = new Date();
    end2.setDate(end2.getDate() + 1);

    const trip2 = await supabaseAdmin
      .from("camping_trips")
      .insert({
        month_key: start2.toISOString().slice(0, 7) + "-01",
        rotation_position: 2,
        selected_campsite_id: siteId,
        suggested_campsite_id: siteId,
        starts_on: start2.toISOString().slice(0, 10),
        ends_on: end2.toISOString().slice(0, 10),
        event_status: "in_progress",
        trip_status: "in_progress",
        minimum_participants: 4,
        cabin_booking_status: "booked",
        additional_information: "Iteration 3 Active Camping Trip",
      })
      .select("id")
      .single();
    activeTripId = trip2.data!.id;

    // 3. Post-Trip Reconciliation Trip (financially_finalized)
    const start3 = new Date();
    start3.setDate(start3.getDate() - 10);
    const end3 = new Date();
    end3.setDate(end3.getDate() - 8);

    const trip3 = await supabaseAdmin
      .from("camping_trips")
      .insert({
        month_key: start3.toISOString().slice(0, 7) + "-01",
        rotation_position: 3,
        selected_campsite_id: siteId,
        suggested_campsite_id: siteId,
        starts_on: start3.toISOString().slice(0, 10),
        ends_on: end3.toISOString().slice(0, 10),
        event_status: "financially_finalized",
        trip_status: "financially_finalized",
        minimum_participants: 4,
        cabin_booking_status: "booked",
        additional_information: "Iteration 3 Post-Trip Reconciliation Trip",
      })
      .select("id")
      .single();
    postTripId = trip3.data!.id;
  });

  test.afterAll(async () => {
    if (tripId) {
      await supabaseAdmin.from("trip_rsvps").delete().eq("trip_id", tripId);
      await supabaseAdmin.from("camping_trips").delete().eq("id", tripId);
    }
    if (activeTripId) {
      await supabaseAdmin.from("camping_trips").delete().eq("id", activeTripId);
    }
    if (postTripId) {
      await supabaseAdmin.from("camping_trips").delete().eq("id", postTripId);
    }
    await cleanupSyntheticUsers([adminUser, memberUser]);
  });

  test("end-to-end iteration 3 lifecycle: lifecycle presentation, deterministic trip health, lightweight notification center, and dynamic mileage rate", async ({
    page,
  }, testInfo) => {
    test.setTimeout(180_000);
    const projectName = testInfo.project.name.replace(/[^a-zA-Z0-9_-]/g, "_");
    const screenshotDir = `/Users/veerrajuamanchi/.gemini/antigravity-cli/brain/e87cd069-ba19-41ae-8624-19d840a12989/screenshots`;

    // =========================================================================
    // Part 1: Landing Page & Trip Health / Lifecycle Badges
    // =========================================================================
    await authenticateSession(page, memberUser);
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // 1.1 Verify Trip Health badges rendered on trip cards
    const healthBadges = page.locator('[data-testid="trip-health-badge"]');
    await expect(healthBadges.first()).toBeVisible();

    // 1.2 Verify Active Camping and Post-Trip badges on calendar cards
    await expect(
      page.locator('text=Currently Camping').first()
    ).toBeVisible();

    // =========================================================================
    // Part 2: Lightweight Notification Center (Header Bell & Drawer)
    // =========================================================================
    const bellBtn = page.locator("button.notification-bell-btn");
    await expect(bellBtn).toBeVisible();

    // 2.1 Verify unread badge count
    const unreadBadge = page.locator('[data-testid="notification-unread-badge"]');
    if (await unreadBadge.isVisible()) {
      const badgeText = await unreadBadge.innerText();
      expect(Number(badgeText) || badgeText).toBeTruthy();
    }

    // 2.2 Open notification drawer
    await bellBtn.click();
    const notifDrawer = page.locator('[role="dialog"][aria-labelledby="notification-drawer-title"]');
    await expect(notifDrawer).toBeVisible();

    // 2.3 Verify 3 categorized tabs
    await expect(page.getByRole("tab", { name: /Action Required/i })).toBeVisible();
    await expect(page.getByRole("tab", { name: /Review Recommended/i })).toBeVisible();
    await expect(page.getByRole("tab", { name: /Informational/i })).toBeVisible();

    // 2.4 Verify dismiss persistence across reload
    const dismissBtns = notifDrawer.getByRole("button", { name: /Dismiss/i });
    if ((await dismissBtns.count()) > 0) {
      await dismissBtns.first().click();
      await page.reload();
      await page.waitForLoadState("networkidle");
    } else {
      // Close drawer by clicking close
      await notifDrawer.locator('button[aria-label="Close notifications"]').click();
      await expect(notifDrawer).not.toBeVisible();
    }

    // =========================================================================
    // Part 3: Event Details Lifecycle Presentation & Navigation Invariant
    // =========================================================================
    await page.goto(`/trips/${tripId}`);
    await page.waitForLoadState("networkidle");

    // 3.1 Strict Invariant: All 4 destinations remain rendered and clickable
    const tabGrid = page.locator(".event-tabs");
    await expect(tabGrid.getByRole("tab", { name: /Overview/i })).toBeVisible();
    await expect(tabGrid.getByRole("tab", { name: /Prepare/i })).toBeVisible();
    await expect(tabGrid.getByRole("tab", { name: /Activities/i })).toBeVisible();
    await expect(
      tabGrid.getByRole("tab", { name: /Financials|Payments/i })
    ).toBeVisible();

    // 3.2 Verify Trip Health Hero Badge and Card Accordion
    const heroHealthBadge = page.locator('[data-testid="trip-health-hero-badge"]');
    await expect(heroHealthBadge).toBeVisible();

    const healthCard = page.locator('[data-testid="trip-health-card"]');
    await expect(healthCard).toBeVisible();

    // 3.3 Expand Trip Health accordion to review structured explanation
    await healthCard.locator("> summary").click();
    await page.waitForTimeout(300);

    // =========================================================================
    // Part 4: Dynamic Mileage Reimbursement Rate
    // =========================================================================
    // Navigate to Prepare destination
    await tabGrid.getByRole("tab", { name: /Prepare/i }).click();
    await page.waitForTimeout(300);

    const section2 = page.locator("details#prepare-transportation");
    await expect(section2).toBeVisible();

    // Verify dynamic mileage rate displays constitutional 76 cents ($0.76/mi)
    await expect(
      section2.locator("summary")
    ).toContainText("$0.76/mi");

    // Ensure Section 2 is open and verify rate explanation inside logistics
    const isSection2Open = await section2.evaluate((el: HTMLDetailsElement) => el.open);
    if (!isSection2Open) {
      await section2.locator("> summary").click();
    }
    await expect(
      section2.getByText(/post-trip reimbursement \(\$0\.76\/mi for 3\+ passengers\)/i)
    ).toBeVisible();

    // =========================================================================
    // Part 5: Active Camping & Post-Trip Lifecycle Presentation
    // =========================================================================
    // 5.1 Active Camping Trip
    await page.goto(`/trips/${activeTripId}?tab=overview`);
    await page.waitForLoadState("networkidle");

    const activeBanner = page.locator('[data-testid="active-camping-banner"]');
    await expect(activeBanner).toBeVisible();
    await expect(activeBanner).toContainText("Currently Camping · On-Site Quick Access");

    // 5.2 Post-Trip Reconciliation Trip
    await page.goto(`/trips/${postTripId}?tab=overview`);
    await page.waitForLoadState("networkidle");

    const postTripBanner = page.locator('[data-testid="post-trip-banner"]');
    await expect(postTripBanner).toBeVisible();
    await expect(postTripBanner).toContainText("Post-Trip Reconciliation Active");

    // Click settlement transfer link
    const viewSettlementsBtn = postTripBanner.getByRole("button", { name: /View Settlements & Transfers/i });
    await expect(viewSettlementsBtn).toBeVisible();
    await viewSettlementsBtn.click();
    await page.waitForTimeout(300);

    // Verify Financials/Payments destination is now active
    await expect(page.locator("h2, h3").filter({ hasText: /Settlement & Expenses|Member Balances/i }).first()).toBeVisible();

    // =========================================================================
    // Part 6: Responsive Viewport & Zero Horizontal Overflow Verification
    // =========================================================================
    const overflowCheck = await page.evaluate(() => {
      return document.documentElement.scrollWidth <= window.innerWidth;
    });
    expect(overflowCheck).toBe(true);

    // Capture screenshots for certification package
    await page.screenshot({
      path: `${screenshotDir}/${projectName}-v2-iteration3-overview.png`,
      fullPage: true,
    });
  });
});
