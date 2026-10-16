import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { createSyntheticUser, supabaseAdmin, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, type TestUser } from "./helpers/supabase-admin";
import { authenticateWorkloadSession } from "./helpers/qa-session";

test("admin selects responsibilities for actual dates; reload and claimed-removal protection persist", async ({ page, browser }, testInfo) => {
  test.setTimeout(240_000);
  const suffix = randomUUID().slice(0, 8);
  const tripId = randomUUID(); const oneDayId = randomUUID();
  const taskIds = [randomUUID(), randomUUID()];
  const titles = [`QA Cook (Veg) - ${suffix}?prep=yes`, `QA Cleanup (Cabin) - ${suffix}?day=2`];
  const users: TestUser[] = [];
  const logs: string[] = [];
  let memberContext: BrowserContext | undefined; let memberPage: Page | undefined;
  const listen = (target: Page) => { target.on("console", message => logs.push(`${message.type()}: ${message.text()}`)); target.on("pageerror", error => logs.push(error.message)); };
  listen(page);
  async function checked(result: { error: { message: string } | null }) { if (result.error) throw new Error(result.error.message); }
  const start = new Date(); start.setUTCDate(start.getUTCDate() + 30);
  while (start.getUTCDay() !== 2) start.setUTCDate(start.getUTCDate() + 1);
  const dates = Array.from({ length: 4 }, (_, n) => { const date = new Date(start); date.setUTCDate(date.getUTCDate() + n); return date.toISOString().slice(0, 10); });
  const manager = () => page.getByRole("dialog", { name: "Manage Meal & Chore Slots", exact: true });
  const day = (date: string) => manager().getByRole("group", { name: new RegExp(date) });
  async function readDuties(id = tripId) {
    const result = await supabaseAdmin.from("trip_slot_duties").select("id,time_slot_id,master_responsibility_id,capacity,workload_weight,is_active,slot:trip_time_slots!inner(trip_id,slot_date,time_block,is_enabled)").eq("slot.trip_id", id).eq("is_active", true).eq("slot.is_enabled", true);
    await checked(result); return result.data ?? [];
  }
  async function openPlanner() { await page.getByRole("button", { name: /Manage Meals & Chores/ }).click(); await expect(manager().getByRole("button", { name: "Save daily responsibilities" })).toBeVisible(); }
  async function overflow(target: Page) {
    const layout = await target.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth,
      wide: Array.from(document.querySelectorAll("body *")).filter(el => el.getBoundingClientRect().right > innerWidth + 1 || el.scrollWidth > el.clientWidth + 1)
        .map(el => ({ tag: el.tagName, className: el.className, width: el.getBoundingClientRect().width, client: el.clientWidth, scroll: el.scrollWidth, text: el.textContent?.slice(0, 90) })).slice(0, 30) }));
    expect(layout.scroll <= layout.width, JSON.stringify(layout)).toBe(true);
  }
  try {
    if (process.env.HOSTED_QA === "1") expect(new URL(SUPABASE_URL).hostname).toBe("rwmizunhxszjvcsaqkre.supabase.co");
    const admin = await createSyntheticUser({ role: "admin", displayName: `Planner (West) - ${suffix}` }); users.push(admin);
    const member = await createSyntheticUser({ role: "member", displayName: `Volunteer (West) - ${suffix}` }); users.push(member);
    await checked(await supabaseAdmin.from("master_responsibilities").insert(taskIds.map((id, i) => ({ id, title: titles[i], description: "Plan meals (fresh) - prep?food=veg&day=1", category: i ? "cleanup" : "cooking", default_capacity: i ? 1 : 2, workload_weight: i ? 0.5 : 2, active: true }))));
    const site = await supabaseAdmin.from("campsites").select("id").eq("active", true).limit(1).single(); await checked(site);
    for (const [id, endsOn] of [[tripId, dates[3]], [oneDayId, dates[0]]]) {
      await checked(await supabaseAdmin.from("camping_trips").insert({ id, month_key: dates[0].slice(0, 7) + "-01", rotation_position: 1,
        selected_campsite_id: site.data!.id, suggested_campsite_id: site.data!.id, starts_on: dates[0], ends_on: endsOn,
        club_timezone_snapshot: "America/Los_Angeles", poll_status: "closed", event_status: "confirmed", is_auto_scheduled: false,
        title: `QA Explicit Plan (West) - ${suffix}?trip=${id === tripId ? "long" : "single"}`, max_capacity: 10, daily_workload_target: null }));
    }
    await checked(await supabaseAdmin.rpc("phase2_refresh_open_rule_bundles", { p_actor_id: admin.memberId, p_trip_ids: [tripId, oneDayId] }));
    await authenticateWorkloadSession(page, admin);
    await page.goto(`/trips/${tripId}?tab=tasks`); await openPlanner();
    await expect(manager().getByRole("group")).toHaveCount(4);
    await expect(day(dates[0])).toHaveAccessibleName(new RegExp(`Tuesday.*${dates[0]}`));
    await expect(manager().getByRole("button", { name: /Generate Candidate Slots/ })).toHaveCount(0);
    await manager().getByRole("button", { name: "Save daily responsibilities" }).click();
    await expect(manager().getByRole("alert")).toHaveText(/Choose at least one responsibility for every date/);
    expect(await readDuties()).toHaveLength(0);
    for (const [i, date] of dates.entries()) {
      await day(date).getByLabel(titles[i === 1 ? 1 : 0], { exact: false }).check();
      if (i === 2) await day(date).getByLabel(titles[1], { exact: false }).check();
    }
    await expect(day(dates[0]).getByText("Selected task weight: 2× · Volunteer capacity: 4×")).toBeVisible();
    expect((await manager().getByRole("button", { name: "Save daily responsibilities" }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await overflow(page);
    await manager().getByRole("button", { name: "Save daily responsibilities" }).click();
    await expect.poll(async () => (await readDuties()).length).toBe(5);
    const saved = await readDuties();
    expect(saved.map(row => `${row.slot.slot_date}:${row.master_responsibility_id}`).sort()).toEqual([
      `${dates[0]}:${taskIds[0]}`, `${dates[1]}:${taskIds[1]}`, `${dates[2]}:${taskIds[0]}`, `${dates[2]}:${taskIds[1]}`, `${dates[3]}:${taskIds[0]}`,
    ].sort());
    expect(saved.every(row => row.slot.time_block === "daily")).toBe(true);
    expect(saved.filter(row => row.master_responsibility_id === taskIds[0]).every(row => Number(row.workload_weight) === 2 && row.capacity === 2)).toBe(true);
    await manager().getByRole("button", { name: /Close/ }).click();
    await expect(page.locator(".time-slot-card").getByText(titles[0], { exact: true }).first()).toBeVisible();
    await page.reload(); await openPlanner();
    for (const [i, date] of dates.entries()) await expect(day(date).getByLabel(titles[i === 1 ? 1 : 0], { exact: false })).toBeChecked();
    await manager().getByRole("button", { name: /Close/ }).click();

    const { viewport, isMobile, hasTouch, deviceScaleFactor, userAgent } = testInfo.project.use;
    memberContext = await browser.newContext({ viewport, isMobile, hasTouch, deviceScaleFactor, userAgent, recordVideo: { dir: testInfo.outputPath("member-video") } });
    memberPage = await memberContext.newPage(); listen(memberPage);
    await authenticateWorkloadSession(memberPage, member);
    // Exercise direct Data API denial using a real member JWT, including a forged admin actor.
    const memberClient = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const login = await memberClient.auth.signInWithPassword({ email: member.email, password: member.password });
    if (login.error) throw new Error("Synthetic member security session failed.");
    const forged = await memberClient.rpc("phase3_save_daily_responsibilities", { p_actor_id: admin.memberId, p_trip_id: tripId,
      p_days: dates.map(date => ({ date, responsibilityIds: [taskIds[0]] })), p_expected_version: 2, p_confirm_removal: true, p_request_id: randomUUID() });
    expect(forged.error?.code).toBe("42501");
    const forgedClaim = await memberClient.rpc("phase3_claim_duty", { p_actor_id: admin.memberId, p_slot_duty_id: saved[0].id, p_acknowledge_overlap: true });
    expect(forgedClaim.error?.code).toBe("42501");
    expect(forgedClaim.error?.message).toMatch(/permission denied for function/);
    const forgedQuota = await memberClient.rpc("phase3_get_member_quota_progress", { p_trip_id: tripId, p_member_id: admin.memberId });
    expect(forgedQuota.error?.code).toBe("42501");
    const forbiddenApi = await memberClient.functions.invoke("trip-api", { body: { action: "admin_save_daily_responsibilities", input: {
      tripId, expectedVersion: 2, confirmRemoval: false, days: dates.map(date => ({ date, responsibilityIds: [taskIds[0]] })) } }, headers: { "Idempotency-Key": randomUUID() } });
    expect(forbiddenApi.response?.status).toBe(403);
    await memberPage.goto(`/trips/${tripId}`);
    await memberPage.getByRole("button", { name: "Going", exact: true }).click();
    await memberPage.getByLabel("I have read and agree to the Camping Constitution.").check();
    await memberPage.getByRole("button", { name: "Confirm Going" }).click();
    await memberPage.getByRole("button", { name: "I'll choose later" }).click();
    await memberPage.goto(`/trips/${tripId}?tab=tasks`);
    const thursday = memberPage.locator(".date-matrix-group").filter({ has: memberPage.getByRole("heading", { name: /Thursday/ }) });
    await thursday.getByRole("button", { name: "Volunteer", exact: true }).first().click();
    await expect(thursday.getByRole("button", { name: "Drop Task", exact: true })).toHaveCount(1);
    await thursday.getByRole("button", { name: "Volunteer", exact: true }).first().click();
    await expect(thursday.getByRole("button", { name: "Drop Task", exact: true })).toHaveCount(2);
    await memberPage.reload();
    await expect(thursday.getByRole("button", { name: "Drop Task", exact: true })).toHaveCount(2);
    await overflow(memberPage);
    const claims = await supabaseAdmin.from("trip_duty_assignments").select("id,slot_duty_id,status").eq("trip_id", tripId).eq("member_id", member.memberId).eq("status", "claimed"); await checked(claims);
    expect(claims.data).toHaveLength(2);

    await page.goto(`/trips/${tripId}`); await openPlanner();
    await day(dates[2]).getByLabel(titles[1], { exact: false }).uncheck();
    await manager().getByRole("button", { name: "Save daily responsibilities" }).click();
    await expect(manager().getByRole("dialog", { name: "Confirm responsibility removal" })).toBeVisible();
    expect(await readDuties()).toHaveLength(5);
    await manager().getByRole("button", { name: "Keep editing" }).click();
    await manager().getByRole("button", { name: "Save daily responsibilities" }).click();
    await manager().getByRole("button", { name: "Confirm removal and save" }).click();
    await expect.poll(async () => (await readDuties()).length).toBe(4);
    const retained = await supabaseAdmin.from("trip_duty_assignments").select("id,status").in("id", claims.data!.map(row => row.id)); await checked(retained);
    expect(retained.data).toHaveLength(2);
    await memberPage.goto(`/trips/${tripId}`);
    await expect(memberPage.getByRole("button", { name: /Duties: 1 of 2 selected/ })).toBeVisible();
    await memberPage.reload();
    await expect(memberPage.getByRole("button", { name: /Duties: 1 of 2 selected/ })).toBeVisible();
    await memberPage.goto("/");
    const card = memberPage.locator(".event-card-container").filter({ has: memberPage.locator(`a[href="/trips/${tripId}"]`) });
    await expect(card.getByRole("link", { name: /Duties: 1 of 2 selected/ })).toBeVisible();
    await page.reload(); await openPlanner();
    await expect(day(dates[2]).getByLabel(titles[1], { exact: false })).not.toBeChecked();
    await overflow(page);
    await manager().getByRole("button", { name: /Close/ }).click();
    await page.goto(`/trips/${oneDayId}`); await openPlanner();
    await expect(manager().getByRole("group")).toHaveCount(1);
    await day(dates[0]).getByLabel(titles[1], { exact: false }).check();
    await manager().getByRole("button", { name: "Save daily responsibilities" }).click();
    await expect.poll(async () => (await readDuties(oneDayId)).length).toBe(1);
    await page.reload(); await openPlanner();
    await expect(day(dates[0]).getByLabel(titles[1], { exact: false })).toBeChecked();

    const actor = { p_actor_id: admin.memberId };
    const rawAttempts: Array<[string, Record<string, unknown>]> = [
      ["phase3_admin_create_master_responsibility", { ...actor, p_title: `QA Forged ${suffix}`, p_description: null, p_category: "other", p_default_capacity: 1, p_workload_weight: 1 }],
      ["phase3_admin_update_master_responsibility", { ...actor, p_id: taskIds[0], p_title: titles[0], p_description: null, p_category: "cooking", p_default_capacity: 2, p_workload_weight: 2, p_active: true }],
      ["phase3_admin_configure_time_slot", { ...actor, p_slot_id: saved[0].time_slot_id, p_label: null, p_is_enabled: true }],
      ["phase3_admin_create_custom_time_slot", { ...actor, p_trip_id: tripId, p_slot_date: dates[0], p_time_block: "custom", p_slot_type: "chore", p_label: "QA Forged Slot" }],
      ["phase3_admin_add_slot_duty", { ...actor, p_time_slot_id: saved[0].time_slot_id, p_master_responsibility_id: taskIds[0], p_capacity: 2, p_workload_weight: 2 }],
      ["phase3_admin_update_slot_duty", { ...actor, p_slot_duty_id: saved[0].id, p_capacity: 2, p_workload_weight: 2, p_is_active: true }],
      ["phase3_drop_duty", { ...actor, p_assignment_id: claims.data![0].id, p_reason: "Forged actor" }],
      ["phase3_admin_assign_duty", { ...actor, p_slot_duty_id: saved[0].id, p_member_id: member.memberId }],
      ["phase3_admin_reassign_duty", { ...actor, p_assignment_id: claims.data![0].id, p_new_member_id: admin.memberId, p_reason: "Forged actor" }],
      ["phase3_admin_set_driver_credit", { ...actor, p_trip_id: tripId, p_member_id: member.memberId, p_workload_credit: 1, p_status: "approved", p_notes: "Forged actor" }],
    ];
    for (const [rpc, args] of rawAttempts) {
      const attempt = await memberClient.rpc(rpc, args);
      expect(attempt.error?.code, rpc).toBe("42501");
      expect(attempt.error?.message, rpc).toMatch(/permission denied for function/);
    }
    const adminClient = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const adminLogin = await adminClient.auth.signInWithPassword({ email: admin.email, password: admin.password });
    if (adminLogin.error) throw new Error("Synthetic admin security session failed.");
    async function edge(action: string, input: Record<string, unknown>) {
      const result = await adminClient.functions.invoke("trip-api", { body: { action, input }, headers: { "Idempotency-Key": randomUUID() } });
      if (result.error || result.data?.error) throw new Error(`Trusted ${action} failed (${result.response?.status}).`);
      return result.data.data;
    }
    const details = await edge("get_trip_details", { tripId });
    await edge("submit_rsvp", { tripId, response: "coming", expectedVersion: 0, bundleId: details.currentRuleBundle.id, contentHash: details.currentRuleBundle.contentHash });
    const probe = await edge("admin_create_master_responsibility", { title: `QA Probe (West) - ${suffix}?new=yes`, description: "Safe actor - create", category: "other", defaultCapacity: 2, workloadWeight: 1 });
    taskIds.push(probe.id);
    await edge("admin_update_master_responsibility", { id: probe.id, title: `QA Probe (West) - ${suffix}?edit=yes`, description: "Safe actor (edited) - ?day=1", category: "other", defaultCapacity: 2, workloadWeight: 1, active: true });
    const probeSlot = await edge("admin_create_custom_time_slot", { tripId, slotDate: dates[0], timeBlock: "custom", slotType: "chore", label: `QA Slot (West) - ${suffix}?day=1` });
    await edge("admin_configure_time_slot", { slotId: probeSlot.id, label: `QA Slot (Edited) - ${suffix}?day=1`, isEnabled: true });
    const probeDuty = await edge("admin_add_slot_duty", { timeSlotId: probeSlot.id, masterResponsibilityId: probe.id, capacity: 2, workloadWeight: 1 });
    await edge("admin_update_slot_duty", { slotDutyId: probeDuty.id, capacity: 3, workloadWeight: 1.5, isActive: true });
    const assigned = await edge("admin_assign_duty", { slotDutyId: probeDuty.id, memberId: member.memberId });
    await edge("admin_reassign_duty", { assignmentId: assigned.id, newMemberId: admin.memberId, reason: "QA reassignment (West) - confirmation" });
    const reassigned = await supabaseAdmin.from("trip_duty_assignments").select("id").eq("slot_duty_id", probeDuty.id).eq("member_id", admin.memberId).eq("status", "assigned_by_admin").single(); await checked(reassigned);
    await edge("drop_duty", { assignmentId: reassigned.data!.id, reason: "QA drop (West) - complete" });
    await edge("admin_set_driver_credit", { tripId, memberId: member.memberId, workloadCredit: 1, status: "approved", notes: "QA driver (West) - ?distance=10" });
    const actualDuty = await supabaseAdmin.from("trip_slot_duties").select("capacity,workload_weight").eq("id", probeDuty.id).single(); await checked(actualDuty);
    expect(actualDuty.data!.capacity).toBe(3); expect(Number(actualDuty.data!.workload_weight)).toBe(1.5);
    const actualDrop = await supabaseAdmin.from("trip_duty_assignments").select("status").eq("id", reassigned.data!.id).single(); await checked(actualDrop); expect(actualDrop.data!.status).toBe("dropped");
    const credit = await supabaseAdmin.from("trip_driver_credits").select("status,workload_credit").eq("trip_id", tripId).eq("member_id", member.memberId).single(); await checked(credit);
    expect(credit.data!.status).toBe("approved"); expect(Number(credit.data!.workload_credit)).toBe(1);
  } finally {
    if (memberPage && testInfo.status !== "passed") await memberPage.screenshot({ path: testInfo.outputPath("member-state.png"), fullPage: true }).catch(() => {});
    await memberContext?.close();
    await testInfo.attach("browser-console", { body: logs.join("\n"), contentType: "text/plain" });
    await supabaseAdmin.from("camping_trips").update({ deleted_at: new Date().toISOString() }).in("id", [tripId, oneDayId]);
    await supabaseAdmin.from("master_responsibilities").update({ active: false }).in("id", taskIds);
    for (const user of users) await supabaseAdmin.from("member_profiles").update({ account_status: "inactive" }).eq("member_id", user.memberId);
  }
});
