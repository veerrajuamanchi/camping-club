import { test, expect } from "@playwright/test";
import {
  createSyntheticUser,
  cleanupSyntheticUsers,
  type TestUser,
} from "./helpers/supabase-admin";
import { authenticateSession } from "./helpers/auth";

test.describe("Member Profile and Payment Handle Persistence", () => {
  let memberUser: TestUser;

  test.beforeAll(async () => {
    memberUser = await createSyntheticUser({
      role: "member",
      displayName: "Pat Camper",
      emailPrefix: "pat-camper",
    });
  });

  test.afterAll(async () => {
    await cleanupSyntheticUsers([memberUser]);
  });

  test("member enters payment handle, saves profile, and verifies it persists across page reload", async ({
    page,
  }) => {
    await authenticateSession(page, memberUser);
    await page.goto("/profile");

    await expect(page.getByRole("heading", { name: "Member profile" })).toBeVisible();

    // 1. Fill profile fields including payment handle
    await page.getByLabel("Display name").fill("Pat Camper Updated");
    await page.getByLabel("Phone number").fill("+14155550177");
    await page.getByLabel("Preferred payment method").selectOption("venmo");
    await page.getByLabel("Payment handle or account email").fill("@pat-camper-venmo");

    // 2. Click save profile
    await page.getByRole("button", { name: "Save profile" }).click();

    // 3. Confirm success message and that handle remains visible
    await expect(page.getByText("Profile updated successfully!")).toBeVisible();
    await expect(page.getByLabel("Payment handle or account email")).toHaveValue("@pat-camper-venmo");

    // 4. Verify durable persistence after full page reload (PostgreSQL reload test)
    await page.reload();
    await expect(page.getByRole("heading", { name: "Member profile" })).toBeVisible();
    await expect(page.getByLabel("Display name")).toHaveValue("Pat Camper Updated");
    await expect(page.getByLabel("Phone number")).toHaveValue("+14155550177");
    await expect(page.getByLabel("Preferred payment method")).toHaveValue("venmo");
    await expect(page.getByLabel("Payment handle or account email")).toHaveValue("@pat-camper-venmo");

    // 5. Update payment handle to a different method (Zelle)
    await page.getByLabel("Preferred payment method").selectOption("zelle");
    await page.getByLabel("Payment handle or account email").fill("pat.camper@zelle.test");
    await page.getByRole("button", { name: "Save profile" }).click();

    await expect(page.getByText("Profile updated successfully!")).toBeVisible();
    await expect(page.getByLabel("Payment handle or account email")).toHaveValue("pat.camper@zelle.test");

    // 6. Reload again and confirm updated handle persists
    await page.reload();
    await expect(page.getByLabel("Preferred payment method")).toHaveValue("zelle");
    await expect(page.getByLabel("Payment handle or account email")).toHaveValue("pat.camper@zelle.test");
  });
});
