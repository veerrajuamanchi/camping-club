import { test, expect } from "@playwright/test";
import { createSyntheticUser, cleanupSyntheticUsers, type TestUser } from "./helpers/supabase-admin";
import { authenticateSession } from "./helpers/auth";

test.describe("Campsite Management and Field Persistence", () => {
  let adminUser: TestUser;

  test.beforeAll(async () => {
    adminUser = await createSyntheticUser({
      role: "admin",
      displayName: "Campsite Admin",
      emailPrefix: "site-admin",
    });
  });

  test.afterAll(async () => {
    await cleanupSyntheticUsers([adminUser]);
  });

  test("creates a new campsite with all fields and verifies persistence across full page reload", async ({
    page,
  }) => {
    await authenticateSession(page, adminUser);

    await page.goto("/admin/campsites");
    await expect(page.getByRole("heading", { name: "Campsite Directory" })).toBeVisible();

    // Click "+ Add Campsite"
    await page.getByRole("button", { name: "+ Add Campsite" }).click();
    await expect(page.getByRole("heading", { name: "Add New Campsite" })).toBeVisible();

    const timestamp = Date.now();
    const siteName = `Pinnacles High Peaks Retreat (${timestamp})`;
    const address = "5000 Hwy 146, Paicines, CA 95043";
    const imageUrl = "https://images.unsplash.com/photo-1504280390367-361c6d9f38f4";
    const hostName = "Ranger Sarah Jenkins";
    const hostPhone = "(831) 389-4485 ext. 12";
    const featuresInput = "Community propane grill, charcoal not provided\nWi-Fi (limited)\nLaundry room\nHorseshoe pit";
    const cabinInfo = "Three rustic cabins, each sleeping up to 6 with bunk beds and heating";
    const directions = "Take US-101 South to CA-25 South, turn right on CA-146 West";
    const websiteUrl = "https://www.recreation.gov/camping/campgrounds/234059?tab=campsite&view=map";

    // Fill the campsite form
    await page.getByLabel("Campsite Name *").fill(siteName);
    await page.getByLabel("Campsite Address *").fill(address);
    await page.getByLabel("Image URL").fill(imageUrl);
    await page.getByLabel("Camp Host Name").fill(hostName);
    await page.getByLabel("Camp Host Phone").fill(hostPhone);
    await page.getByLabel(/Camp Features/).fill(featuresInput);
    await page.getByLabel("Cabin Information").fill(cabinInfo);
    await page.getByLabel("Directions").fill(directions);
    await page.getByLabel("Reservation / Website URL").fill(websiteUrl);

    // Save
    await page.getByRole("button", { name: "Create Campsite" }).click();

    // Verify success notice appears
    await expect(page.getByText("Campsite created successfully!")).toBeVisible();

    // Helper to verify card contents on the page
    const verifyCardContent = async () => {
      const card = page.locator(".card", { hasText: siteName });
      await expect(card).toBeVisible();
      await expect(card.getByRole("heading", { name: siteName })).toBeVisible();
      await expect(card).toContainText(address);
      await expect(card).toContainText(hostName);
      await expect(card).toContainText(hostPhone);
      await expect(card).toContainText(cabinInfo);
      await expect(card).toContainText(directions);

      // Verify features
      await expect(card).toContainText("Community propane grill");
      await expect(card).toContainText("charcoal not provided");
      await expect(card).toContainText("Wi-Fi (limited)");
      await expect(card).toContainText("Laundry room");
      await expect(card).toContainText("Horseshoe pit");

      // Verify website link
      const link = card.locator('a[target="_blank"]');
      await expect(link).toBeVisible();
      await expect(link).toHaveAttribute("href", websiteUrl);
    };

    // 1. Initial UI check after create
    await verifyCardContent();

    // 2. Critical User Test: Perform full page reload and re-verify everything persists
    await page.reload();
    await expect(page.getByRole("heading", { name: "Campsite Directory" })).toBeVisible();
    await verifyCardContent();
  });

  test("edits an existing campsite and verifies updated fields persist across full page reload", async ({
    page,
  }) => {
    await authenticateSession(page, adminUser);
    await page.goto("/admin/campsites");

    // Find the first campsite card and click Edit
    const firstCard = page.locator(".card").first();
    await expect(firstCard).toBeVisible();
    await firstCard.getByRole("button", { name: "✏️ Edit" }).click();

    // Edit modal should open
    await expect(page.getByRole("heading", { name: /^Edit / })).toBeVisible();

    const updatedAddress = "100 Del Monte Blvd, Monterey, CA 93940";
    const updatedHostName = "Bob Kerlin";
    const updatedHostPhone = "(831) 373-7007";
    const updatedImageUrl = "https://www.psea.info/wp-content/uploads/2021/06/Del-Monte-cabins570x380.jpg";
    const updatedFeatures = "Community propane grill\nCommunity charcoal barbecue Charcoal is not provided.\nLaundry room\nWi-fi (limited)\nPlayground\nHorseshoe pit\nLibrary of books and DVDs";
    const updatedCabinInfo = "Updated: 4 units with electric heating and kitchenettes";
    const updatedDirections = "Updated driving directions: Gate code #4821";
    const updatedWebsite = "https://parks.ca.gov/campsite?id=992&season=fall";

    await page.getByLabel("Campsite Address *").fill(updatedAddress);
    await page.getByLabel("Image URL").fill(updatedImageUrl);
    await page.getByLabel("Camp Host Name").fill(updatedHostName);
    await page.getByLabel("Camp Host Phone").fill(updatedHostPhone);
    await page.getByLabel(/Camp Features/).fill(updatedFeatures);
    await page.getByLabel("Cabin Information").fill(updatedCabinInfo);
    await page.getByLabel("Directions").fill(updatedDirections);
    await page.getByLabel("Reservation / Website URL").fill(updatedWebsite);

    await page.getByRole("button", { name: "Save Changes" }).click();
    await expect(page.getByText("Campsite updated successfully!")).toBeVisible();

    // Helper to verify updated card
    const verifyUpdatedCard = async () => {
      const card = page.locator(".card", { hasText: updatedHostName });
      await expect(card).toBeVisible();
      await expect(card).toContainText(updatedAddress);
      await expect(card).toContainText(updatedHostName);
      await expect(card).toContainText(updatedHostPhone);
      await expect(card).toContainText(updatedCabinInfo);
      await expect(card).toContainText(updatedDirections);
      await expect(card).toContainText("Community propane grill");
      await expect(card).toContainText("Community charcoal barbecue Charcoal is not provided.");
      await expect(card).toContainText("Laundry room");
      await expect(card).toContainText("Wi-fi (limited)");
      await expect(card).toContainText("Playground");
      await expect(card).toContainText("Horseshoe pit");
      await expect(card).toContainText("Library of books and DVDs");

      const link = card.locator('a[target="_blank"]');
      await expect(link).toBeVisible();
      await expect(link).toHaveAttribute("href", updatedWebsite);
    };

    await verifyUpdatedCard();

    // Full page reload verification
    await page.reload();
    await expect(page.getByRole("heading", { name: "Campsite Directory" })).toBeVisible();
    await verifyUpdatedCard();
  });
});
