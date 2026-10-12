import { test, expect } from "@playwright/test";
import {
  createSyntheticUser,
  cleanupSyntheticUsers,
  type TestUser,
} from "./helpers/supabase-admin";
import { authenticateSession } from "./helpers/auth";

test.describe("Trip Management, Constitution Acknowledgment, and RSVP Persistence", () => {
  let adminUser: TestUser;
  let memberUser: TestUser;

  test.beforeAll(async () => {
    adminUser = await createSyntheticUser({
      role: "admin",
      displayName: "Trip Coordinator",
      emailPrefix: "trip-admin",
    });
    memberUser = await createSyntheticUser({
      role: "member",
      displayName: "Camper Alex",
      emailPrefix: "alex-member",
    });
  });

  test.afterAll(async () => {
    await cleanupSyntheticUsers([adminUser, memberUser]);
  });

  test("admin opens poll, member confirms Going with Constitution acknowledgment, and verifies reload persistence", async ({
    page,
    browser,
  }) => {
    // 1. Admin configures club schedule defaults (Timezone) first
    await authenticateSession(page, adminUser);
    await page.goto("/admin/schedule-defaults");
    await expect(page.getByRole("heading", { name: "Club Schedule Defaults" })).toBeVisible();

    await page.getByLabel("Club timezone").fill("America/Los_Angeles");
    await page.getByRole("button", { name: "Save schedule defaults" }).click();
    await expect(page.getByText("Club schedule defaults saved successfully.")).toBeVisible();

    // 2. Admin navigates to Upcoming Camping calendar
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Upcoming Camping" })).toBeVisible();

    const firstTripCard = page.locator(".event-card-container").first();
    await expect(firstTripCard).toBeVisible();

    // Configure dates and cabin status via Edit modal
    const editBtn = firstTripCard.getByRole("button", { name: "✏️ Edit" });
    await expect(editBtn).toBeVisible();
    await editBtn.click();

    const modal = page.locator(".modal-card");
    await expect(modal).toBeVisible();

    // Month is November 2026
    const startsOn = "2026-11-20";
    const endsOn = "2026-11-22";

    await modal.getByLabel("Trip start").fill(startsOn);
    await modal.getByLabel("Trip end").fill(endsOn);
    await modal.getByLabel("Cabin booking status").selectOption("booked");
    await modal.getByLabel("Trip notes & information").fill("Annual Autumn Ridge Exploration");

    await modal.getByRole("button", { name: "Save changes" }).click();
    await expect(modal).toBeHidden();

    // Open Admin controls and click "Open poll"
    const adminControlsSummary = firstTripCard.locator("summary", { hasText: "Admin controls" });
    await adminControlsSummary.click();

    const openPollBtn = firstTripCard.getByRole("button", { name: "Open poll" });
    if (await openPollBtn.isVisible()) {
      await openPollBtn.click();
      await expect(firstTripCard.getByRole("button", { name: "Close poll" })).toBeVisible();
    }

    // Capture the trip link
    const detailsLink = firstTripCard.locator("a.view-details-link");
    const tripHref = await detailsLink.getAttribute("href");
    expect(tripHref).toBeTruthy();

    // 3. Member logs in and navigates to the trip details page
    const memberContext = await browser.newContext();
    const memberPage = await memberContext.newPage();
    await authenticateSession(memberPage, memberUser);

    await memberPage.goto(tripHref!);
    await expect(memberPage.getByRole("heading", { name: /Camping|Exploration/i })).toBeVisible();

    // Member selects Going
    const goingBtn = memberPage.getByRole("button", { name: "Going", exact: true });
    await expect(goingBtn).toBeVisible();
    await goingBtn.click();

    // Acknowledge Constitution
    const ackCheckbox = memberPage.getByLabel("I have read and agree to the Camping Constitution.");
    await expect(ackCheckbox).toBeVisible();
    await ackCheckbox.check();

    // Submit Going RSVP
    await memberPage.getByRole("button", { name: "Confirm Going" }).click();

    // Verify Going status and member in attendees list
    await expect(memberPage.locator(".status-badge-going")).toBeVisible();
    await expect(memberPage.getByText(memberUser.displayName)).toBeVisible();

    // 4. Full page reload verification
    await memberPage.reload();
    await expect(memberPage.locator(".status-badge-going")).toBeVisible();
    await expect(memberPage.getByText(memberUser.displayName)).toBeVisible();

    // 5. Change RSVP to "Not Going"
    const notGoingBtn = memberPage.getByRole("button", { name: "Not Going" });
    await notGoingBtn.click();
    await memberPage.getByRole("button", { name: "Confirm Not Going" }).click();

    // Verify Not Going status persists across reload
    await expect(memberPage.locator(".status-badge-not-going")).toBeVisible();
    await memberPage.reload();
    await expect(memberPage.locator(".status-badge-not-going")).toBeVisible();

    await memberContext.close();
  });
});
