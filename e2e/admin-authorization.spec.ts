import { test, expect } from "@playwright/test";
import { createSyntheticUser, cleanupSyntheticUsers, type TestUser } from "./helpers/supabase-admin";
import { authenticateSession } from "./helpers/auth";

test.describe("Role-Based Access Control and Administrator Boundaries", () => {
  let memberUser: TestUser;
  let adminUser: TestUser;

  test.beforeAll(async () => {
    memberUser = await createSyntheticUser({
      role: "member",
      displayName: "Regular Camper",
      emailPrefix: "regular-camper",
    });
    adminUser = await createSyntheticUser({
      role: "admin",
      displayName: "Club Admin",
      emailPrefix: "club-admin",
    });
  });

  test.afterAll(async () => {
    await cleanupSyntheticUsers([memberUser, adminUser]);
  });

  test("regular member cannot see admin navigation links", async ({ page }) => {
    await authenticateSession(page, memberUser);
    await page.goto("/");

    // Open user menu
    const userMenuBtn = page.getByRole("button", { name: "User menu" });
    await expect(userMenuBtn).toBeVisible();
    await userMenuBtn.click();

    // Verify member links exist, but admin links do NOT
    await expect(page.getByRole("link", { name: /My Profile/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /Campsite Directory/i })).toBeHidden();
    await expect(page.getByRole("link", { name: /Members & Access/i })).toBeHidden();
    await expect(page.getByRole("link", { name: /Club Schedule Defaults/i })).toBeHidden();
    await expect(page.getByRole("link", { name: /Camping Constitution/i })).toBeHidden();
  });

  test("regular member navigating directly to admin routes is blocked by AccessBoundary", async ({
    page,
  }) => {
    await authenticateSession(page, memberUser);

    const adminRoutes = [
      "/admin/campsites",
      "/admin/members",
      "/admin/schedule-defaults",
      "/admin/constitution",
    ];

    for (const route of adminRoutes) {
      await page.goto(route);
      await expect(page.getByText("Administrator access is required.")).toBeVisible();
      // Ensure admin controls are NOT visible
      await expect(page.getByRole("button", { name: "+ Add Campsite" })).toBeHidden();
      await expect(page.getByRole("button", { name: "Send invitation" })).toBeHidden();
      await expect(page.getByRole("button", { name: "Save schedule defaults" })).toBeHidden();
    }
  });

  test("administrator has full access to all admin portals and controls", async ({ page }) => {
    await authenticateSession(page, adminUser);

    // Campsites
    await page.goto("/admin/campsites");
    await expect(page.getByRole("heading", { name: "Campsite Directory" })).toBeVisible();
    await expect(page.getByRole("button", { name: "+ Add Campsite" })).toBeVisible();

    // Members
    await page.goto("/admin/members");
    await expect(page.getByRole("heading", { name: "Administrator · Members" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Send invitation" })).toBeVisible();

    // Schedule Defaults
    await page.goto("/admin/schedule-defaults");
    await expect(page.getByRole("heading", { name: "Club Schedule Defaults" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Save schedule defaults" })).toBeVisible();

    // Constitution
    await page.goto("/admin/constitution");
    await expect(page.getByRole("heading", { name: "Camping Constitution" })).toBeVisible();
  });
});
