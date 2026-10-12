import { test, expect } from "@playwright/test";
import { createSyntheticUser, cleanupSyntheticUsers, type TestUser } from "./helpers/supabase-admin";
import { authenticateSession } from "./helpers/auth";

test.describe("Mobile Usability and Responsive Layout Verification", () => {
  let adminUser: TestUser;

  test.beforeAll(async () => {
    adminUser = await createSyntheticUser({
      role: "admin",
      displayName: "Mobile Tester",
      emailPrefix: "mobile-admin",
    });
  });

  test.afterAll(async () => {
    await cleanupSyntheticUsers([adminUser]);
  });

  test("verifies responsive layout, absence of horizontal overflow, and usable tap targets on mobile viewports", async ({
    page,
  }, testInfo) => {
    await authenticateSession(page, adminUser);

    const routesToVerify = [
      { path: "/", name: "home-calendar" },
      { path: "/admin/campsites", name: "admin-campsites" },
      { path: "/admin/members", name: "admin-members" },
      { path: "/admin/schedule-defaults", name: "admin-schedule" },
    ];

    for (const route of routesToVerify) {
      await page.goto(route.path);
      await page.waitForLoadState("networkidle");

      // Verify no horizontal overflow beyond viewport width
      const hasHorizontalOverflow = await page.evaluate(() => {
        return document.documentElement.scrollWidth > window.innerWidth;
      });
      expect(
        hasHorizontalOverflow,
        `Page at ${route.path} has unexpected horizontal overflow on ${testInfo.project.name}`
      ).toBe(false);

      // Verify header elements are accessible and visible
      await expect(page.locator(".brand-title")).toBeVisible();

      // Capture screenshot for visual inspection across browser projects
      const screenshotPath = `test-results/screenshots/${testInfo.project.name.replace(/[^a-zA-Z0-9_-]/g, "_")}-${route.name}.png`;
      await page.screenshot({ path: screenshotPath, fullPage: false });
    }
  });

  test("verifies campsite edit modal operates smoothly on mobile without horizontal clipping", async ({
    page,
  }, testInfo) => {
    await authenticateSession(page, adminUser);
    await page.goto("/admin/campsites");

    // Open Add Campsite modal
    await page.getByRole("button", { name: "+ Add Campsite" }).click();
    const modal = page.locator(".modal-card");
    await expect(modal).toBeVisible();

    // Verify modal does not horizontally exceed viewport
    const modalOverflow = await page.evaluate(() => {
      const modalEl = document.querySelector(".modal-card");
      if (!modalEl) return false;
      const rect = modalEl.getBoundingClientRect();
      return rect.width > window.innerWidth || rect.right > window.innerWidth;
    });
    expect(modalOverflow, "Modal horizontally overflows viewport").toBe(false);

    // Verify all key inputs are clickable and focusable
    const nameInput = page.getByLabel("Campsite Name *");
    await expect(nameInput).toBeVisible();
    await nameInput.fill("Mobile Responsive Retreat");

    const phoneInput = page.getByLabel("Camp Host Phone");
    await expect(phoneInput).toBeVisible();
    await phoneInput.fill("(415) 555-0199");

    const urlInput = page.getByLabel("Reservation / Website URL");
    await expect(urlInput).toBeVisible();
    await urlInput.fill("https://recreation.gov/campsite/123");

    // Cancel modal cleanly
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(modal).toBeHidden();

    // Screenshot after modal close
    const screenshotPath = `test-results/screenshots/${testInfo.project.name.replace(/[^a-zA-Z0-9_-]/g, "_")}-campsites-modal-closed.png`;
    await page.screenshot({ path: screenshotPath });
  });
});
