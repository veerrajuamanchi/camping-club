import { test, expect } from "@playwright/test";
import {
  createSyntheticUser,
  cleanupSyntheticUsers,
  supabaseAdmin,
  type TestUser,
} from "./helpers/supabase-admin";
import { authenticateSession } from "./helpers/auth";

test.describe("Camping Club 2.0 Iteration 2 Acceptance Suite", () => {
  let adminUser: TestUser;
  let memberUser: TestUser;
  let tripId: string;

  test.beforeAll(async () => {
    adminUser = await createSyntheticUser({
      role: "admin",
      displayName: "Iteration2 Admin",
      emailPrefix: "v2-i2-admin",
    });
    memberUser = await createSyntheticUser({
      role: "member",
      displayName: "Iteration2 Member",
      emailPrefix: "v2-i2-member",
    });

    // Locate or create a trip for event details testing
    const tripRes = await supabaseAdmin
      .from("camping_trips")
      .select("id")
      .order("starts_on", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (tripRes.data?.id) {
      tripId = tripRes.data.id;
    } else {
      const siteRes = await supabaseAdmin.from("campsites").select("id").limit(1).single();
      const siteId = siteRes.data!.id;
      const start = new Date();
      start.setDate(start.getDate() + 30);
      const end = new Date(start);
      end.setDate(end.getDate() + 2);
      const startDate = start.toISOString().slice(0, 10);
      const endDate = end.toISOString().slice(0, 10);
      const newTrip = await supabaseAdmin
        .from("camping_trips")
        .insert({
          month_key: startDate.slice(0, 7) + "-01",
          rotation_position: 1,
          selected_campsite_id: siteId,
          suggested_campsite_id: siteId,
          starts_on: startDate,
          ends_on: endDate,
          event_status: "rsvp_open",
          trip_status: "rsvp_open",
          minimum_participants: 4,
          deposit_amount_cents: 5000,
          additional_information: "Iteration 2 Test Cabin Trip",
        })
        .select("id")
        .single();
      tripId = newTrip.data!.id;
    }
  });

  test.afterAll(async () => {
    await cleanupSyntheticUsers([adminUser, memberUser]);
  });

  test("end-to-end iteration 2 lifecycle: 4 destinations, mobile 2x2 grid, constitution accordion, prepare 3 sections, driver duty model, admin configuration hub, and deep link resolution", async ({
    page,
    browser,
  }, testInfo) => {
    test.setTimeout(180_000);
    const projectName = testInfo.project.name.replace(/[^a-zA-Z0-9_-]/g, "_");

    // =========================================================================
    // Part 1: Admin Configuration Hub (/admin/configuration)
    // =========================================================================
    await authenticateSession(page, adminUser);
    await page.goto("/admin/configuration");
    await page.waitForLoadState("networkidle");

    // 1.1 Verify header and description
    await expect(
      page.getByRole("heading", { name: /⚙️ Club Master Configuration/i })
    ).toBeVisible();
    await expect(
      page.getByText(/Unified administrative center/i)
    ).toBeVisible();

    // 1.2 Verify 6 configuration hub cards
    await expect(page.getByRole("heading", { name: /Camping Constitution/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Campsite Directory/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Master Responsibilities/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Master Catalogs & Activities/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Club Schedule Defaults/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Members & Access/i })).toBeVisible();

    // 1.3 Verify action button touch targets (min-height >= 44px)
    const configActionLinks = page.locator(".hub-card-action-link");
    const linkCount = await configActionLinks.count();
    expect(linkCount).toBe(6);
    for (let i = 0; i < linkCount; i++) {
      const box = await configActionLinks.nth(i).boundingBox();
      expect(box).not.toBeNull();
      if (box) {
        expect(box.height).toBeGreaterThanOrEqual(44);
      }
    }

    // 1.4 Verify absence of horizontal scroll overflow
    const configOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > window.innerWidth;
    });
    expect(
      configOverflow,
      `Admin Configuration has horizontal overflow on ${testInfo.project.name}`
    ).toBe(false);

    // 1.5 Reload check on Admin Configuration
    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(
      page.getByRole("heading", { name: /⚙️ Club Master Configuration/i })
    ).toBeVisible();

    // Capture screenshot: Admin Configuration
    await page.screenshot({
      path: `test-results/screenshots/${projectName}-v2-admin-configuration.png`,
      fullPage: false,
    });

    // =========================================================================
    // Part 2: Four Event Details Destinations & Responsive Navigation
    // =========================================================================
    await page.goto(`/trips/${tripId}`);
    await page.waitForLoadState("networkidle");

    // 2.1 Verify absence of horizontal scroll overflow on initial load
    const eventDetailsOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > window.innerWidth;
    });
    expect(
      eventDetailsOverflow,
      `Event details has horizontal overflow on ${testInfo.project.name}`
    ).toBe(false);

    // 2.2 Verify destination navigation elements
    const overviewTab = page.getByRole("tab", { name: /Overview/i });
    const prepareTab = page.getByRole("tab", { name: /Prepare/i });
    const activitiesTab = page.getByRole("tab", { name: /Activities/i });
    const financialsTab = page.getByRole("tab", { name: /Financials|Payments/i });

    await expect(overviewTab).toBeVisible();
    await expect(prepareTab).toBeVisible();
    await expect(activitiesTab).toBeVisible();
    await expect(financialsTab).toBeVisible();

    // 2.3 Verify touch target height (>= 44px) for destination navigation buttons
    const navButtons = [overviewTab, prepareTab, activitiesTab, financialsTab];
    for (const btn of navButtons) {
      const box = await btn.boundingBox();
      expect(box).not.toBeNull();
      if (box) {
        expect(box.height).toBeGreaterThanOrEqual(44);
      }
    }

    // Capture screenshot: Event Overview
    await page.screenshot({
      path: `test-results/screenshots/${projectName}-v2-event-overview.png`,
      fullPage: false,
    });

    // =========================================================================
    // Part 3: Camping Constitution Expandable Section inside Overview
    // =========================================================================
    const constitutionAccordion = page.locator("details#constitution");
    await expect(constitutionAccordion).toBeVisible();
    await expect(
      constitutionAccordion.locator("> summary", { hasText: /Camping Constitution/i })
    ).toBeVisible();

    // Verify toggling / expanding the constitution accordion
    const isInitiallyOpen = await constitutionAccordion.evaluate(
      (el: HTMLDetailsElement) => el.open
    );
    if (!isInitiallyOpen) {
      await constitutionAccordion.locator("> summary").click();
      await expect(constitutionAccordion).toHaveAttribute("open", "");
    }
    await expect(constitutionAccordion.getByRole("heading", { name: /Camping Constitution/i })).toBeVisible();

    // =========================================================================
    // Part 4: Prepare Destination with 3 Expandable Sections
    // =========================================================================
    await prepareTab.click();
    await page.waitForLoadState("networkidle");

    // 4.1 Verify Prepare destination container is active
    const prepareDestination = page.locator('[data-testid="prepare-destination"]');
    await expect(prepareDestination).toBeVisible();

    // 4.2 Verify Section 1: Responsibilities & Meals
    const section1 = page.locator("details#prepare-responsibilities");
    await expect(section1).toBeVisible();
    await expect(
      section1.locator("summary", { hasText: /Responsibilities & Meals/i })
    ).toBeVisible();

    // 4.3 Verify Section 2: Transportation & Carpools
    const section2 = page.locator("details#prepare-transportation");
    await expect(section2).toBeVisible();
    await expect(
      section2.locator("summary", { hasText: /Transportation & Carpools/i })
    ).toBeVisible();

    // 4.4 Verify Section 3: Gear, Groceries & Packing
    const section3 = page.locator("details#prepare-gear");
    await expect(section3).toBeVisible();
    await expect(
      section3.locator("summary", { hasText: /Gear, Groceries & Packing/i })
    ).toBeVisible();

    // 4.5 Verify Driver Duty Model & Credits Cleanup:
    // Redundant "Approved Driver Credits" section MUST NOT be present!
    const redundantCreditsHeading = page.getByText("🚗 Approved Driver Credits");
    await expect(redundantCreditsHeading).toHaveCount(0);

    // 4.6 Verify absence of horizontal scroll overflow in Prepare
    const prepareOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > window.innerWidth;
    });
    expect(
      prepareOverflow,
      `Prepare destination has horizontal overflow on ${testInfo.project.name}`
    ).toBe(false);

    // 4.7 Reload persistence check in Prepare
    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(prepareDestination).toBeVisible();
    await expect(section1).toBeVisible();
    await expect(section2).toBeVisible();
    await expect(section3).toBeVisible();

    // Capture screenshot: Event Prepare
    await page.screenshot({
      path: `test-results/screenshots/${projectName}-v2-event-prepare.png`,
      fullPage: false,
    });

    // =========================================================================
    // Part 5: Deep-Link Compatibility
    // =========================================================================
    // 5.1 ?tab=tasks resolves to Prepare with Section 1 open
    await page.goto(`/trips/${tripId}?tab=tasks`);
    await page.waitForLoadState("networkidle");
    await expect(page.locator('[data-testid="prepare-destination"]')).toBeVisible();
    await expect(page.locator("details#prepare-responsibilities")).toHaveAttribute("open", "");

    // 5.2 ?tab=logistics resolves to Prepare with Section 2 open
    await page.goto(`/trips/${tripId}?tab=logistics`);
    await page.waitForLoadState("networkidle");
    await expect(page.locator('[data-testid="prepare-destination"]')).toBeVisible();
    await expect(page.locator("details#prepare-transportation")).toHaveAttribute("open", "");

    // 5.3 ?tab=packing resolves to Prepare with Section 3 open
    await page.goto(`/trips/${tripId}?tab=packing`);
    await page.waitForLoadState("networkidle");
    await expect(page.locator('[data-testid="prepare-destination"]')).toBeVisible();
    await expect(page.locator("details#prepare-gear")).toHaveAttribute("open", "");

    // 5.4 ?tab=constitution resolves to Overview with Constitution accordion open
    await page.goto(`/trips/${tripId}?tab=constitution`);
    await page.waitForLoadState("networkidle");
    const openConstitution = page.locator("details#constitution");
    await expect(openConstitution).toBeVisible();
    await expect(openConstitution).toHaveAttribute("open", "");
    await expect(openConstitution.getByRole("heading", { name: /Camping Constitution/i })).toBeVisible();

    // 5.5 ?tab=financials resolves to Financials destination
    await page.goto(`/trips/${tripId}?tab=financials`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { name: /Settlement & Expenses/i })).toBeVisible();

    // =========================================================================
    // Part 6: Member Access Guardrails on Configuration Hub
    // =========================================================================
    const memberContext = await browser.newContext();
    const memberPage = await memberContext.newPage();
    try {
      await authenticateSession(memberPage, memberUser);
      await memberPage.goto("/admin/configuration");
      await memberPage.waitForLoadState("networkidle");

      // Verify non-admin is blocked by AccessBoundary
      await expect(
        memberPage.getByText(/Administrator access is required/i)
      ).toBeVisible();
    } finally {
      await memberContext.close();
    }
  });
});
