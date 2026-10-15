import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { createSyntheticUser, supabaseAdmin, SUPABASE_URL, type TestUser } from "./helpers/supabase-admin";
import { authenticateWorkloadSession } from "./helpers/qa-session";

test("active totals and daily targets persist; full tasks excuse remaining campers", async ({ page, browser }, testInfo) => {
  test.setTimeout(180_000);
  const users: TestUser[] = [];
  const contexts: BrowserContext[] = [];
  const memberPages: Page[] = [];
  let completed = false;
  const suffix = randomUUID().slice(0, 8);
  const tripId = randomUUID();
  const responsibilityTitle = `QA Dinner (Veg) - ${suffix}?prep=yes`;
  const description = "Wash vegetables (fresh) - chop & clean?day=1";
  const consoleLog: string[] = [];
  page.on("console", message => consoleLog.push(`${message.type()}: ${message.text()}`));
  page.on("pageerror", error => consoleLog.push(error.message));
  async function check(result: { error: { message: string } | null }) { if (result.error) throw new Error(result.error.message); }
  async function claimRows(memberId: string) {
    const result = await supabaseAdmin.from("trip_duty_assignments").select("id").eq("trip_id", tripId).eq("member_id", memberId).in("status", ["claimed", "assigned_by_admin"]);
    await check(result); return result.data?.length ?? 0;
  }
  const start = new Date(); start.setDate(start.getDate() + 15);
  const end = new Date(start); end.setDate(end.getDate() + 1);
  const startDate = start.toISOString().slice(0, 10);
  let createdResponsibilityId: string | undefined;
  try {
    if (process.env.HOSTED_QA === "1") expect(new URL(SUPABASE_URL).hostname).toBe("rwmizunhxszjvcsaqkre.supabase.co");
    const admin = await createSyntheticUser({ role: "admin", displayName: `QA Admin (West) - ${suffix}` }); users.push(admin);
    const first = await createSyntheticUser({ role: "member", displayName: `QA Cook (West) - ${suffix}` }); users.push(first);
    const second = await createSyntheticUser({ role: "member", displayName: `QA Camper (West) - ${suffix}` }); users.push(second);
    await authenticateWorkloadSession(page, admin);
    await page.goto("/admin/responsibilities");
    const total = page.getByLabel("Total active template weight");
    await expect(total).toBeVisible();
    const beforeWeight = Number((await total.innerText()).replace("×", ""));
    await page.getByRole("button", { name: "+ Add Responsibility" }).click();
    const modal = page.locator(".modal-card");
    await modal.getByLabel("Title *", { exact: true }).fill(responsibilityTitle);
    await modal.getByLabel("Description", { exact: true }).fill(description);
    await modal.getByLabel("Default Capacity *", { exact: true }).fill("1");
    await modal.getByLabel("Workload Weight *", { exact: true }).fill("2");
    await modal.getByRole("button", { name: "Save Responsibility" }).click();
    await expect(modal).toBeHidden();
    await expect(total).toHaveText(`${(beforeWeight + 2).toFixed(1)}×`);
    const saved = await supabaseAdmin.from("master_responsibilities").select("id,title,description,default_capacity,workload_weight").eq("title", responsibilityTitle).single();
    await check(saved); createdResponsibilityId = saved.data!.id;
    expect(saved.data).toMatchObject({ title: responsibilityTitle, description, default_capacity: 1 });
    expect(Number(saved.data!.workload_weight)).toBe(2);
    await page.reload();
    await expect(page.getByText(responsibilityTitle, { exact: true })).toBeVisible();
    await expect(total).toHaveText(`${(beforeWeight + 2).toFixed(1)}×`);
    const layout = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth,
      wide: Array.from(document.querySelectorAll("body *")).filter(el => el.getBoundingClientRect().right > innerWidth + 1 || el.scrollWidth > el.clientWidth + 1)
        .map(el => ({ tag: el.tagName, className: el.className, width: el.getBoundingClientRect().width, client: el.clientWidth, scroll: el.scrollWidth, text: el.textContent?.slice(0, 100) })).slice(0, 30) }));
    expect(layout.scroll <= layout.width, JSON.stringify(layout)).toBe(true);
    const site = await supabaseAdmin.from("campsites").select("id").eq("active", true).limit(1).single(); await check(site);
    await check(await supabaseAdmin.from("camping_trips").insert({ id: tripId, month_key: startDate.slice(0, 7) + "-01", rotation_position: 1,
      selected_campsite_id: site.data!.id, suggested_campsite_id: site.data!.id, starts_on: startDate, ends_on: end.toISOString().slice(0, 10),
      club_timezone_snapshot: "America/Los_Angeles", poll_status: "closed", event_status: "confirmed", is_auto_scheduled: false,
      title: `QA Workload (West) - ${suffix}?food=veg`, max_capacity: 10 }));
    await check(await supabaseAdmin.rpc("phase2_refresh_open_rule_bundles", { p_actor_id: admin.memberId, p_trip_ids: [tripId] }));
    for (const [index, block] of ["friday_dinner", "friday_evening"].entries()) {
      const slotId = randomUUID();
      await check(await supabaseAdmin.from("trip_time_slots").insert({ id: slotId, trip_id: tripId, slot_date: startDate, time_block: block, slot_type: "meal", label: `QA Dinner (${index + 1}) - prep` }));
      await check(await supabaseAdmin.from("trip_slot_duties").insert({ time_slot_id: slotId, master_responsibility_id: createdResponsibilityId, capacity: 1, workload_weight: 2 }));
    }
    await page.goto(`/trips/${tripId}?tab=tasks`);
    await page.getByLabel("Use a daily workload target for this trip").check();
    await page.getByLabel("Daily workload target (×)", { exact: true }).fill("4");
    const saveButton = page.getByRole("button", { name: "Save daily target" });
    expect((await saveButton.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await saveButton.click();
    await expect.poll(async () => {
      const result = await supabaseAdmin.from("camping_trips").select("daily_workload_target").eq("id", tripId).single(); await check(result);
      return Number(result.data?.daily_workload_target);
    }).toBe(4);
    await page.reload();
    await expect(page.getByLabel("Daily workload target (×)", { exact: true })).toHaveValue("4");
    for (const member of [first, second]) {
      const { viewport, isMobile, hasTouch, deviceScaleFactor, userAgent } = testInfo.project.use;
      const context = await browser.newContext({ viewport, isMobile, hasTouch, deviceScaleFactor, userAgent, recordVideo: { dir: testInfo.outputPath("member-videos") } }); contexts.push(context);
      const memberPage = await context.newPage(); memberPages.push(memberPage);
      memberPage.on("console", message => consoleLog.push(`${message.type()}: ${message.text()}`));
      memberPage.on("pageerror", error => consoleLog.push(error.message));
      await authenticateWorkloadSession(memberPage, member);
      await memberPage.goto(`/trips/${tripId}`);
      await memberPage.getByRole("button", { name: "Going", exact: true }).click();
      await memberPage.getByLabel("I have read and agree to the Camping Constitution.").check();
      await memberPage.getByRole("button", { name: "Confirm Going" }).click();
      if (member === first) await memberPage.getByRole("button", { name: "I'll choose later" }).click();
      else {
        await expect(memberPage.getByText(/No additional task selections are needed/)).toBeVisible();
        await expect(memberPage.getByRole("button", { name: /Choose My Duties/ })).toHaveCount(0);
        await memberPage.getByRole("button", { name: "Done", exact: true }).click();
      }
      await memberPage.goto(`/trips/${tripId}?tab=tasks`);
      await expect(memberPage.getByText("QA Dinner (1) - prep")).toBeVisible();
      if (member === first) {
        const volunteer = memberPage.getByRole("button", { name: "Volunteer", exact: true });
        await volunteer.first().click();
        await expect.poll(() => claimRows(member.memberId)).toBe(1);
        await memberPage.reload();
        await expect(memberPage.getByText("2× / 4×")).toBeVisible();
        await memberPage.getByRole("button", { name: "Volunteer", exact: true }).first().click();
        await expect.poll(() => claimRows(member.memberId)).toBe(2);
        await memberPage.reload();
        await expect(memberPage.getByText("Daily target reached (tasks selected).")).toBeVisible();
      } else {
        await expect(memberPage.getByText("No tasks available. No additional selection required.")).toBeVisible();
        await expect(memberPage.getByRole("button", { name: "Volunteer", exact: true })).toHaveCount(0);
        await memberPage.reload();
        await expect(memberPage.getByText("No tasks available. No additional selection required.")).toBeVisible();
        expect(await claimRows(member.memberId)).toBe(0);
        await memberPage.goto(`/trips/${tripId}`);
        await expect(memberPage.getByText(/Action Needed:/)).toHaveCount(0);
        await expect(memberPage.getByRole("button", { name: "Daily workload: no additional selections needed" })).toBeVisible();
        await memberPage.goto("/");
        const calendarCard = memberPage.locator(".event-card-container").filter({ has: memberPage.locator(`a[href="/trips/${tripId}"]`) });
        await expect(calendarCard.getByRole("link", { name: "Daily workload: no additional selections needed" })).toBeVisible();
      }
      expect(await memberPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    completed = true;
  } finally {
    for (const [index, context] of contexts.entries()) {
      if (!completed) await memberPages[index]?.screenshot({ path: testInfo.outputPath(`member-${index}-failure.png`), fullPage: true }).catch(() => {});
      await context.close();
    }
    await testInfo.attach("browser-console", { body: consoleLog.join("\n"), contentType: "text/plain" });
    await supabaseAdmin.from("camping_trips").update({ deleted_at: new Date().toISOString() }).eq("id", tripId);
    if (createdResponsibilityId) await supabaseAdmin.from("master_responsibilities").update({ active: false }).eq("id", createdResponsibilityId);
    for (const user of users) await supabaseAdmin.from("member_profiles").update({ account_status: "inactive" }).eq("member_id", user.memberId);
  }
});
