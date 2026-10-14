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

  test("admin configures trip dates & deadline, member confirms Going with Constitution acknowledgment, and verifies reload persistence", async ({
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
    await expect(page.getByRole("heading", { name: "Upcoming Camping Events" })).toBeVisible();

    const firstTripCard = page.locator(".event-card-container").first();
    await expect(firstTripCard).toBeVisible();

    // Configure dates and cabin status via Edit modal
    const editBtn = firstTripCard.getByRole("button", { name: "✏️ Edit" });
    await expect(editBtn).toBeVisible();
    await editBtn.click();

    const modal = page.locator(".modal-card");
    await expect(modal).toBeVisible();

    // Dates in November 2026
    const startsOn = "2026-11-20";
    const endsOn = "2026-11-22";

    await modal.getByLabel(/Trip start/i).fill(startsOn);
    await modal.getByLabel(/Trip end/i).fill(endsOn);
    await modal.getByRole("combobox", { name: "Cabin Booking Status" }).selectOption("booked");
    await modal.getByLabel(/Trip notes & information/i).fill("Annual Autumn Ridge Exploration");

    await modal.getByRole("button", { name: "Save changes" }).click();
    await expect(modal).toBeHidden();

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

    // Verify Option A celebration modal appears with duty signup prompt
    const dutyModal = memberPage.locator(".modal-overlay");
    await expect(dutyModal).toBeVisible();
    await expect(dutyModal.getByRole("heading", { name: /You're Going to.*! 🎉/i })).toBeVisible();
    await expect(dutyModal.getByText(/camping duties/i)).toBeVisible();

    // Dismiss modal to inspect Overview tab
    await dutyModal.getByRole("button", { name: "I'll choose later" }).click();
    await expect(dutyModal).toBeHidden();

    // Verify Going status and member in attendees list
    await expect(memberPage.locator(".status-badge-going")).toBeVisible();
    await expect(memberPage.getByText(memberUser.displayName).first()).toBeVisible();

    // Verify persistent duty badge (incomplete: 0 of 2)
    await expect(memberPage.getByRole("button", { name: /⚠️ Duties: 0 of 2 selected/i })).toBeVisible();

    // 4. Full page reload verification
    await memberPage.reload();
    await expect(memberPage.locator(".status-badge-going")).toBeVisible();
    await expect(memberPage.getByText(memberUser.displayName).first()).toBeVisible();
    await expect(memberPage.getByRole("button", { name: /⚠️ Duties: 0 of 2 selected/i })).toBeVisible();

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

  test("admin creates custom camping event with open form, verifies date validation, reload persistence, and deletion", async ({
    page,
  }) => {
    await authenticateSession(page, adminUser);
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Upcoming Camping Events" })).toBeVisible();

    // 1. Click "+ Add Custom Camping"
    const addBtn = page.getByRole("button", { name: "+ Add Custom Camping" });
    await expect(addBtn).toBeVisible();
    await addBtn.click();

    const modal = page.locator(".modal-card");
    await expect(modal).toBeVisible();
    await expect(modal.getByRole("heading", { name: "Add Custom Camping Event" })).toBeVisible();

    // 2. Verify start/end date logic & form validation
    const customTitle = `Big Sur Coastal Adventure (${Date.now()})`;
    const startsOnInput = modal.getByLabel(/Trip start date/i);
    const endsOnInput = modal.getByLabel(/Trip end date/i);

    await modal.getByLabel(/Event Name/i).fill(customTitle);
    await startsOnInput.fill("2027-04-16");
    // Verify min attribute on endsOn is set
    await expect(endsOnInput).toHaveAttribute("min", "2027-04-16");
    await endsOnInput.fill("2027-04-18");

    await modal.getByRole("combobox", { name: "Camping Type" }).selectOption("tent");
    await modal.getByRole("combobox", { name: "Event Status" }).selectOption("confirmed");
    await modal.getByLabel(/Camping Type Sites Count/i).fill("3");
    await modal.getByLabel(/Camping Type Site Capacity/i).fill("4");
    await modal.getByRole("combobox", { name: "Cabin Booking Status" }).selectOption("booked");
    await modal.getByLabel(/Trip notes & information/i).fill("Oceanview tent sites, bring headlamps");

    await modal.getByRole("button", { name: "Save Custom Camping" }).click();
    await expect(modal).toBeHidden();

    // 3. Verify custom event appears on calendar
    const customCard = page.locator(".event-card-container", { hasText: customTitle });
    await expect(customCard).toBeVisible();
    await expect(customCard.locator(".badge-pill", { hasText: "Tent" })).toBeVisible();
    await expect(customCard.locator(".event-status-pill")).toContainText("Confirmed");

    // 4. Verify reload persistence
    await page.reload();
    await expect(page.locator(".event-card-container", { hasText: customTitle })).toBeVisible();

    // 5. Admin edits the event title
    const editBtn = customCard.getByRole("button", { name: "✏️ Edit" });
    await editBtn.click();
    const editModal = page.locator(".modal-card");
    await expect(editModal).toBeVisible();

    const updatedTitle = `${customTitle} - Updated`;
    await editModal.getByLabel(/Event Name/i).fill(updatedTitle);
    await editModal.getByRole("button", { name: "Save changes" }).click();
    await expect(editModal).toBeHidden();

    // Verify updated title on card and after reload
    await expect(page.locator(".event-card-container", { hasText: updatedTitle })).toBeVisible();
    await page.reload();
    await expect(page.locator(".event-card-container", { hasText: updatedTitle })).toBeVisible();

    // 6. Admin deletes the custom event with confirmation
    const updatedCard = page.locator(".event-card-container", { hasText: updatedTitle });
    page.once("dialog", (dialog) => dialog.accept());
    await updatedCard.getByRole("button", { name: "🗑️ Delete" }).click();

    // Verify card is removed from calendar
    await expect(page.locator(".event-card-container", { hasText: updatedTitle })).toBeHidden();

    // Verify deletion persists across reload
    await page.reload();
    await expect(page.locator(".event-card-container", { hasText: updatedTitle })).toBeHidden();
  });
});
