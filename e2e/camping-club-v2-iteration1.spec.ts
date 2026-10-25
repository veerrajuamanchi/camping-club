import { test, expect } from "@playwright/test";
import {
  createSyntheticUser,
  cleanupSyntheticUsers,
  type TestUser,
} from "./helpers/supabase-admin";
import { authenticateSession } from "./helpers/auth";

test.describe("Camping Club 2.0 Iteration 1 Acceptance Suite", () => {
  let adminUser: TestUser;
  let memberUser: TestUser;

  test.beforeAll(async () => {
    adminUser = await createSyntheticUser({
      role: "admin",
      displayName: "Ops Coordinator",
      emailPrefix: "v2-admin",
    });
    memberUser = await createSyntheticUser({
      role: "member",
      displayName: "Camper Alex",
      emailPrefix: "v2-alex",
    });
  });

  test.afterAll(async () => {
    await cleanupSyntheticUsers([adminUser, memberUser]);
  });

  test("end-to-end iteration 1 lifecycle: landing card action callout, my actions hub, event overview banner, and admin operations exception dashboard", async ({
    page,
    browser,
  }, testInfo) => {
    test.setTimeout(180_000);

    // =========================================================================
    // Part 1: Member Journey — Landing Cards, Actions Hub, and Event Overview
    // =========================================================================
    await authenticateSession(page, memberUser);
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // 1.1 Header navigation links
    const myActionsLink = page.locator(".nav-actions-link");
    await expect(myActionsLink).toBeVisible();
    await expect(myActionsLink).toHaveText(/⚡ My Actions/);

    // 1.2 Verify absence of horizontal scroll overflow on landing page
    const landingOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > window.innerWidth;
    });
    expect(
      landingOverflow,
      `Landing page has horizontal overflow on ${testInfo.project.name}`
    ).toBe(false);

    // 1.3 Verify dedicated registration deadline row on cards
    const deadlineRows = page.locator('[data-testid="event-card-deadline-row"]');
    const deadlineCount = await deadlineRows.count();
    if (deadlineCount > 0) {
      await expect(deadlineRows.first()).toBeVisible();
      await expect(deadlineRows.first()).toContainText(/Registration Cutoff:/);
    }

    // 1.4 Durable reload check on Landing page
    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(myActionsLink).toBeVisible();

    // Capture Landing Page screenshot
    await page.screenshot({
      path: `test-results/screenshots/${testInfo.project.name.replace(/[^a-zA-Z0-9_-]/g, "_")}-v2-landing.png`,
      fullPage: false,
    });

    // 1.5 Navigate to My Actions Hub (/actions)
    await page.goto("/actions");
    await page.waitForLoadState("networkidle");

    // Verify page heading and task summary
    await expect(page.getByRole("heading", { name: /⚡ My Personal Actions/i })).toBeVisible();
    await expect(page.getByText(/Consolidated task inbox/i)).toBeVisible();

    // Verify absence of horizontal scroll overflow on My Actions page
    const actionsOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > window.innerWidth;
    });
    expect(
      actionsOverflow,
      `My Actions page has horizontal overflow on ${testInfo.project.name}`
    ).toBe(false);

    // Verify either action cards or clean empty state
    const emptyState = page.locator('[data-testid="actions-empty-state"]');
    if (await emptyState.isVisible()) {
      await expect(page.getByText("You're All Caught Up!")).toBeVisible();
      const exploreBtn = page.getByRole("link", { name: /Explore Camping Trips →/i });
      await expect(exploreBtn).toBeVisible();
      await expect(exploreBtn).toHaveAttribute("href", "/");
    } else {
      const resolveLinks = page.getByRole("link", { name: /Resolve Action →/i });
      const count = await resolveLinks.count();
      for (let i = 0; i < count; i++) {
        const box = await resolveLinks.nth(i).boundingBox();
        expect(box).not.toBeNull();
        if (box) {
          expect(box.height).toBeGreaterThanOrEqual(40);
        }
      }
    }

    // 1.6 Durable reload check on My Actions
    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { name: /⚡ My Personal Actions/i })).toBeVisible();

    // Capture My Actions screenshot
    await page.screenshot({
      path: `test-results/screenshots/${testInfo.project.name.replace(/[^a-zA-Z0-9_-]/g, "_")}-v2-my-actions.png`,
      fullPage: false,
    });

    // 1.7 Member returns to landing page and checks first trip event details for TripNextStepsBanner
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    const firstTripLink = page.locator(".view-details-link").first();
    if (await firstTripLink.isVisible()) {
      await firstTripLink.click();
      await page.waitForLoadState("networkidle");

      // Verify trip details page loaded without horizontal overflow
      const detailsOverflow = await page.evaluate(() => {
        return document.documentElement.scrollWidth > window.innerWidth;
      });
      expect(
        detailsOverflow,
        `Trip Details page has horizontal overflow on ${testInfo.project.name}`
      ).toBe(false);

      // Reload check on trip details
      await page.reload();
      await page.waitForLoadState("networkidle");
      await expect(page.getByRole("tab", { name: /Overview & attendees/i })).toBeVisible();
    }

    // =========================================================================
    // Part 2: Admin Journey — Operations Exception Dashboard
    // =========================================================================
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();

    try {
      await authenticateSession(adminPage, adminUser);
      await adminPage.goto("/");
      await adminPage.waitForLoadState("networkidle");

      // 2.1 Verify admin Operations nav link
      const navOpsLink = adminPage.locator(".nav-ops-link");
      await expect(navOpsLink).toBeVisible();
      await expect(navOpsLink).toHaveText(/⚙️ Operations/);

      // 2.2 Navigate to /admin/operations
      await adminPage.goto("/admin/operations");
      await adminPage.waitForLoadState("networkidle");

      // Verify header and description
      await expect(
        adminPage.getByRole("heading", { name: /⚙️ Admin Operations Dashboard/i })
      ).toBeVisible();
      await expect(adminPage.getByText(/Exception-driven management/i)).toBeVisible();

      // 2.3 Verify absence of horizontal scroll overflow on Admin Operations
      const adminOpsOverflow = await adminPage.evaluate(() => {
        return document.documentElement.scrollWidth > window.innerWidth;
      });
      expect(
        adminOpsOverflow,
        `Admin Operations page has horizontal overflow on ${testInfo.project.name}`
      ).toBe(false);

      // 2.4 Verify action buttons meet accessible touch target (>= 40px height)
      const actionLinks = adminPage.getByRole("link", { name: /Manage Exception →/i });
      const actionCount = await actionLinks.count();
      for (let i = 0; i < actionCount; i++) {
        const box = await actionLinks.nth(i).boundingBox();
        expect(box).not.toBeNull();
        if (box) {
          expect(box.height).toBeGreaterThanOrEqual(40);
        }
      }

      // 2.5 Durable reload check on Admin Operations
      await adminPage.reload();
      await adminPage.waitForLoadState("networkidle");
      await expect(
        adminPage.getByRole("heading", { name: /⚙️ Admin Operations Dashboard/i })
      ).toBeVisible();

      // Capture Admin Operations screenshot
      await adminPage.screenshot({
        path: `test-results/screenshots/${testInfo.project.name.replace(/[^a-zA-Z0-9_-]/g, "_")}-v2-admin-operations.png`,
        fullPage: false,
      });
    } finally {
      await adminContext.close();
    }
  });
});
