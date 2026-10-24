import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { createSyntheticUser, cleanupSyntheticUsers, supabaseAdmin, type TestUser } from "./helpers/supabase-admin";
import { authenticateSession } from "./helpers/auth";

test("confirmed RSVP changes, tasks, deactivation and logout persist", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const logs: string[] = [];
  page.on("console", message => logs.push(`${message.type()}: ${message.text()}`));
  page.on("pageerror", error => logs.push(error.message));
  const users: TestUser[] = [];
  const suffix = randomUUID().slice(0, 8);
  const tripId = randomUUID();
  const slotId = randomUUID();
  const dutyId = randomUUID();
  const assignmentId = randomUUID();
  async function checked(result: { error: { message: string } | null }) {
    if (result.error) throw new Error(result.error.message);
  }
  async function response() {
    const result = await supabaseAdmin.from("trip_rsvps").select("response").eq("trip_id", tripId).eq("member_id", users[1].memberId).single();
    await checked(result);
    return result.data?.response;
  }
  try {
    const admin = await createSyntheticUser({ role: "admin", displayName: `Coordinator (West) - QA ${suffix}` }); users.push(admin);
    const member = await createSyntheticUser({ role: "member", displayName: `Camper (West) - QA ${suffix}` }); users.push(member);
    const site = await supabaseAdmin.from("campsites").select("id").limit(1).single(); await checked(site);
    const start = new Date(); start.setDate(start.getDate() + 15);
    const date = start.toISOString().slice(0, 10);
    await checked(await supabaseAdmin.from("camping_trips").insert({ id: tripId, month_key: "2038-01-01", rotation_position: 1,
      selected_campsite_id: site.data!.id, suggested_campsite_id: site.data!.id, starts_on: date, ends_on: date,
      club_timezone_snapshot: "America/Los_Angeles", poll_status: "closed", event_status: "confirmed",
      title: "Forest Camp (West) - QA ?food=veg&day=1", max_capacity: 10 }));
    await checked(await supabaseAdmin.rpc("phase2_refresh_open_rule_bundles", { p_actor_id: admin.memberId, p_trip_ids: [tripId] }));
    // Late additions see the current immutable rule bundle.
    await checked(await supabaseAdmin.from("trip_time_slots").insert({ id: slotId, trip_id: tripId, slot_date: date,
      time_block: "friday_dinner", slot_type: "meal", label: "Dinner (vegetarian) - prep" }));
    const responsibility = await supabaseAdmin.from("master_responsibilities").select("id").eq("active", true).limit(1).single(); await checked(responsibility);
    await checked(await supabaseAdmin.from("trip_slot_duties").insert({ id: dutyId, time_slot_id: slotId, master_responsibility_id: responsibility.data!.id }));
    await authenticateSession(page, member);
    await page.goto(`/trips/${tripId}`);
    await expect(page.getByRole("heading", { name: "Forest Camp (West) - QA ?food=veg&day=1" })).toBeVisible();
    await expect(page.getByText(/Minimum participants required/)).toHaveCount(0);
    await page.getByRole("button", { name: "Going", exact: true }).click();
    await page.getByLabel("I have read and agree to the Camping Constitution.").check();
    await page.getByRole("button", { name: "Confirm Going" }).click();
    await page.getByRole("button", { name: "I'll choose later" }).click();
    await expect.poll(response).toBe("coming");
    await page.reload();
    await expect(page.locator(".status-badge-going")).toBeVisible();
    await checked(await supabaseAdmin.from("trip_duty_assignments").insert({ id: assignmentId, trip_id: tripId, slot_duty_id: dutyId, member_id: member.memberId }));
    await page.goto(`/trips/${tripId}?tab=tasks`);
    await expect(page.getByRole("heading", { name: "Your Trip Responsibility Progress" })).toBeVisible();
    await page.getByRole("tab", { name: "Tasks & Meals", exact: true }).click();
    await page.getByText("Dinner (vegetarian) - prep").first().scrollIntoViewIfNeeded({ timeout: 20_000 });
    await expect(page.getByText("Dinner (vegetarian) - prep").first()).toBeVisible();
    await expect(page.getByText("Failed to load meal and chore tasks.")).toHaveCount(0);
    await page.goto(`/trips/${tripId}`);
    await page.getByRole("button", { name: "Not Going", exact: true }).click();
    await expect(page.getByText(/Your \$50 deposit is non-refundable/)).toBeVisible();
    await page.getByRole("button", { name: "Confirm Not Going" }).click();
    await expect.poll(response).toBe("not_coming");
    await page.reload();
    await expect(page.locator(".status-badge-not-going")).toBeVisible();
    const released = await supabaseAdmin.from("trip_duty_assignments").select("status").eq("id", assignmentId).single();
    await checked(released); expect(released.data!.status).toBe("dropped");
    await page.getByRole("button", { name: "Going", exact: true }).click();
    await page.getByLabel("I have read and agree to the Camping Constitution.").check();
    await page.getByRole("button", { name: "Confirm Going" }).click();
    await page.getByRole("button", { name: "I'll choose later" }).click();
    await expect.poll(response).toBe("coming");
    await page.getByRole("button", { name: "User menu" }).click();
    await page.getByRole("button", { name: /Sign out/ }).click();
    await expect(page).toHaveURL(/\/signin$/);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Sign in to the Camping Club" })).toBeVisible();
    await authenticateSession(page, admin);
    await page.goto("/");
    await expect(page.locator(`a.view-details-link[href="/trips/${tripId}"]`)).toBeVisible({ timeout: 20_000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.goto(`/trips/${tripId}?tab=tasks`);
    await page.getByRole("tab", { name: "Tasks & Meals", exact: true }).click();
    await page.getByText("Dinner (vegetarian) - prep").first().scrollIntoViewIfNeeded({ timeout: 20_000 });
    await expect(page.getByText("Dinner (vegetarian) - prep").first()).toBeVisible();
    await page.goto("/admin/members");
    await page.locator("article.member-row", { hasText: member.displayName }).getByLabel("Access").selectOption("inactive");
    await expect.poll(response).toBe("not_coming");
    await page.reload();
    await expect(page.locator("article.member-row", { hasText: member.displayName }).getByLabel("Access")).toHaveValue("inactive");
    await page.goto(`/trips/${tripId}`);
    await expect(page.locator(".attendee-chip", { hasText: member.displayName })).toHaveCount(0);
    await page.reload();
    await expect(page.locator(".attendee-chip", { hasText: member.displayName })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  } finally {
    await testInfo.attach("browser-console", { body: logs.join("\n"), contentType: "text/plain" });
    // Preserve immutable fixture facts; the local verification reset removes them afterward.
    await supabaseAdmin.from("camping_trips").update({ deleted_at: new Date().toISOString() }).eq("id", tripId);
    await cleanupSyntheticUsers(users);
  }
});
