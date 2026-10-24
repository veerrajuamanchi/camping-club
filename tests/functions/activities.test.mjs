import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { terminateProcessTree } from "../../scripts/terminate-process.mjs";

function getSupabaseStatus() {
  const statusRun = spawnSync("npx", ["supabase", "status", "-o", "json"], { encoding: "utf8" });
  if (statusRun.status !== 0) throw new Error("Local Supabase is not running.");
  const jsonAt = statusRun.stdout.indexOf("{");
  return JSON.parse(statusRun.stdout.slice(jsonAt));
}

const status = getSupabaseStatus();
const api = status.API_URL;
const serviceKey = status.SERVICE_ROLE_KEY;
const publishableKey = status.PUBLISHABLE_KEY || status.ANON_KEY;

const serviceClient = createClient(api, serviceKey, { auth: { persistSession: false } });

let server;
let temporaryDirectory;

before(async () => {
  temporaryDirectory = await mkdtemp(join(tmpdir(), "camping-club-test-activities-"));
  const envPath = join(temporaryDirectory, "functions.env");
  const secret = () => randomBytes(32).toString("base64");

  await writeFile(
    envPath,
    [
      `SUPABASE_URL=${api}`,
      `SUPABASE_SECRET_KEYS={"default":"${serviceKey}"}`,
      `INVITATION_HMAC_KEY=${secret()}`,
      `IDEMPOTENCY_HMAC_KEY=${secret()}`,
      "IDEMPOTENCY_HMAC_KEY_VERSION=v1",
      "EMAIL_HMAC_KEY_VERSION=v1",
      `PAYMENT_ENCRYPTION_KEY=${secret()}`,
      "PAYMENT_ENCRYPTION_KEY_VERSION=local-test-v1",
      `PAYMENT_FINGERPRINT_KEY=${secret()}`,
      `BOOTSTRAP_ADMIN_TOKEN=${secret()}`,
      "WEB_APP_URL=http://localhost:5173",
      "ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173",
    ].join("\n"),
    { mode: 0o600 }
  );

  server = spawn("npx", ["supabase", "functions", "serve", "--env-file", envPath], {
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });

  const expiresAt = Date.now() + 20000;
  let ready = false;
  while (Date.now() < expiresAt) {
    if (server.exitCode !== null) {
      throw new Error("Local Edge Functions server exited unexpectedly during startup.");
    }
    try {
      const res = await fetch(`${api}/functions/v1/trip-api`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "get_calendar" }),
      });
      if (res.status === 401 || res.status === 405 || res.status === 200 || res.status === 400) {
        ready = true;
        break;
      }
    } catch {
      // Waiting for server
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  if (!ready) throw new Error("Timed out waiting for edge functions server to start.");
});

after(async () => {
  if (server) {
    await terminateProcessTree(server).catch(() => {});
  }
  if (temporaryDirectory) {
    await rm(temporaryDirectory, { recursive: true, force: true }).catch(() => {});
  }
});

async function createTestMember(role = "member") {
  const email = `test-${role}-${randomBytes(8).toString("hex")}@example.test`;
  const password = `Pass-${randomBytes(12).toString("hex")}!`;

  const { data: authData, error: authErr } = await serviceClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (authErr) throw authErr;

  const memberId = randomUUID();
  const { error: profileErr } = await serviceClient.from("member_profiles").insert({
    member_id: memberId,
    auth_user_id: authData.user.id,
    display_name: `Test ${role} ${memberId.slice(0, 6)}`,
    member_role: role,
    account_status: "active",
  });
  if (profileErr) throw profileErr;

  const client = createClient(api, publishableKey, { auth: { persistSession: false } });
  const { data: sessionData, error: loginErr } = await client.auth.signInWithPassword({
    email,
    password,
  });
  if (loginErr) throw loginErr;

  return {
    memberId,
    authUserId: authData.user.id,
    email,
    accessToken: sessionData.session.access_token,
  };
}

async function callTripApi(action, token, input = {}, requestKey = randomUUID()) {
  const headers = {
    apikey: publishableKey,
    Authorization: `Bearer ${token}`,
    Origin: "http://localhost:5173",
    "Content-Type": "application/json",
  };
  if (requestKey) headers["Idempotency-Key"] = requestKey;

  const response = await fetch(`${api}/functions/v1/trip-api`, {
    method: "POST",
    headers,
    body: JSON.stringify({ action, input }),
  });
  const jsonBody = await response.json().catch(() => null);
  const body = jsonBody?.data !== undefined ? jsonBody.data : jsonBody;
  return { status: response.status, body, raw: jsonBody };
}

async function createTestTrip() {
  const tripId = randomUUID();
  const { data: campsite } = await serviceClient.from("campsites").select("id").limit(1).single();
  const campsiteId = campsite.id;

  const startsOn = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const endsOn = new Date(Date.now() + 33 * 86400000).toISOString().slice(0, 10);

  const { error: tripErr } = await serviceClient.from("camping_trips").insert({
    id: tripId,
    month_key: `${startsOn.slice(0, 7)}-01`,
    rotation_position: 1,
    suggested_campsite_id: campsiteId,
    selected_campsite_id: campsiteId,
    starts_on: startsOn,
    ends_on: endsOn,
    poll_status: "closed",
    event_status: "confirmed",
  });
  if (tripErr) throw tripErr;

  return { tripId, campsiteId, startsOn, endsOn };
}

test("trip activities API endpoints and voucher credential masking", async (t) => {
  const admin = await createTestMember("admin");
  const memberA = await createTestMember("member");
  const memberB = await createTestMember("member");
  const memberC = await createTestMember("member");
  const { tripId } = await createTestTrip();

  let masterActivityId;
  let tripActivityId;
  let group1Id;
  let group2Id;

  await t.test("admin_manage_master_activity creates activity template, rejects non-admin", async () => {
    // Non-admin rejected
    const nonAdminRes = await callTripApi("admin_manage_master_activity", memberA.accessToken, {
      action: "create",
      title: "Hacker Monterey GoCar Tour",
      unitCapacity: 2,
    });
    assert.equal(nonAdminRes.status, 403);

    // Admin allowed
    const adminRes = await callTripApi("admin_manage_master_activity", admin.accessToken, {
      action: "create",
      title: "Monterey GoCar Full-Day Tour",
      category: "tour",
      imageUrl: "https://example.test/gocar.jpg",
      locationName: "Cannery Row Rentals",
      address: "100 Ocean View Blvd, Pacific Grove, CA",
      directionsUrl: "https://maps.google.com/?q=Cannery+Row+Rentals",
      unitLabel: "GoCar",
      unitCapacity: 2,
      bookingNotes: "Groupon voucher covers 2 riders per car.",
      isActive: true,
    });
    assert.equal(adminRes.status, 200, JSON.stringify(adminRes.body));
    masterActivityId = adminRes.body?.id || adminRes.raw?.id;
    assert.ok(masterActivityId, "master activity ID created");
  });

  await t.test("get_master_catalogs includes master activities", async () => {
    const res = await callTripApi("get_master_catalogs", memberA.accessToken, {});
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body?.activities), "catalog should have activities array");
    const found = res.body.activities.find((a) => a.id === masterActivityId);
    assert.ok(found, "created master activity should be returned in activities");
    assert.equal(found.title, "Monterey GoCar Full-Day Tour");
  });

  await t.test("admin_manage_trip_activity clones template into trip activity with groups", async () => {
    const res = await callTripApi("admin_manage_trip_activity", admin.accessToken, {
      action: "clone_from_master",
      tripId,
      masterActivityId,
      groupCount: 2,
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    tripActivityId = res.body?.activity_id || res.raw?.activity_id;
    assert.ok(tripActivityId, "trip activity ID created");
  });

  await t.test("set_activity_participation registers member attendance and opt-out", async () => {
    // Member A attends
    const resA = await callTripApi("set_activity_participation", memberA.accessToken, {
      tripId,
      activityId: tripActivityId,
      status: "attending",
    });
    assert.equal(resA.status, 200, JSON.stringify(resA.body));

    // Member B attends
    const resB = await callTripApi("set_activity_participation", memberB.accessToken, {
      tripId,
      activityId: tripActivityId,
      status: "attending",
    });
    assert.equal(resB.status, 200, JSON.stringify(resB.body));

    // Member C opts out
    const resC = await callTripApi("set_activity_participation", memberC.accessToken, {
      tripId,
      activityId: tripActivityId,
      status: "opted_out",
      notes: "Relaxing at camp",
    });
    assert.equal(resC.status, 200, JSON.stringify(resC.body));
  });

  await t.test("admin_manage_activity_pairings assigns members to groups", async () => {
    // First, inspect groups via get_trip_activities
    const getRes = await callTripApi("get_trip_activities", admin.accessToken, { tripId });
    assert.equal(getRes.status, 200);
    const act = getRes.body.activities.find((a) => a.id === tripActivityId);
    assert.ok(act, "activity found");
    assert.equal(act.groups.length, 2, "2 groups initialized");
    group1Id = act.groups[0].id;
    group2Id = act.groups[1].id;

    // Assign Member A to Group 1, Member B to Group 2
    const assignRes = await callTripApi("admin_manage_activity_pairings", admin.accessToken, {
      tripId,
      activityId: tripActivityId,
      groups: [
        { id: group1Id, memberIds: [memberA.memberId] },
        { id: group2Id, memberIds: [memberB.memberId] },
      ],
    });
    assert.equal(assignRes.status, 200, JSON.stringify(assignRes.body));
  });

  await t.test("submit_activity_voucher submits voucher and updates status", async () => {
    // Unassigned member trying to submit Group 1 voucher fails
    const failRes = await callTripApi("submit_activity_voucher", memberB.accessToken, {
      tripId,
      groupId: group1Id,
      purchaseDate: "2026-10-24",
      orderNumber: "ORD-999",
      voucherCode: "GP-102948-A",
      securityPin: "4819",
      voucherCostCents: 17460,
    });
    assert.ok(failRes.status === 400 || failRes.status === 403, "unassigned member cannot submit voucher");

    // Assigned member A submits Group 1 voucher
    const successRes = await callTripApi("submit_activity_voucher", memberA.accessToken, {
      tripId,
      groupId: group1Id,
      purchaseDate: "2026-10-24",
      orderNumber: "ORD-999",
      voucherCode: "GP-102948-A",
      securityPin: "4819",
      voucherCostCents: 17460,
    });
    assert.equal(successRes.status, 200, JSON.stringify(successRes.body));
    assert.equal(successRes.body?.voucher_status, "purchased");
  });

  await t.test("get_trip_activities enforces voucher credential masking", async () => {
    // Member A (assigned to Group 1): sees unmasked voucherCode and securityPin on Group 1
    const resA = await callTripApi("get_trip_activities", memberA.accessToken, { tripId });
    assert.equal(resA.status, 200);
    const actA = resA.body.activities.find((a) => a.id === tripActivityId);
    const g1A = actA.groups.find((g) => g.id === group1Id);
    const g2A = actA.groups.find((g) => g.id === group2Id);
    assert.equal(g1A.voucher_code, "GP-102948-A", "assigned rider A sees voucher_code");
    assert.equal(g1A.security_pin, "4819", "assigned rider A sees security_pin");

    // Member B (assigned to Group 2, NOT Group 1): sees MASKED (null) voucherCode and securityPin on Group 1!
    const resB = await callTripApi("get_trip_activities", memberB.accessToken, { tripId });
    assert.equal(resB.status, 200);
    const actB = resB.body.activities.find((a) => a.id === tripActivityId);
    const g1B = actB.groups.find((g) => g.id === group1Id);
    assert.equal(g1B.voucher_code, null, "unassigned member B has voucher_code masked to null");
    assert.equal(g1B.security_pin, null, "unassigned member B has security_pin masked to null");
    // But other non-sensitive fields are visible
    assert.equal(g1B.voucher_status, "purchased");
    assert.equal(g1B.amount_cents, 17460);

    // Admin: sees unmasked credentials on all groups
    const resAdmin = await callTripApi("get_trip_activities", admin.accessToken, { tripId });
    assert.equal(resAdmin.status, 200);
    const actAdmin = resAdmin.body.activities.find((a) => a.id === tripActivityId);
    const g1Admin = actAdmin.groups.find((g) => g.id === group1Id);
    assert.equal(g1Admin.voucher_code, "GP-102948-A", "admin sees unmasked voucher_code");
    assert.equal(g1Admin.security_pin, "4819", "admin sees unmasked security_pin");
  });

  await t.test("partner swap requests allow assigned members to swap vehicles", async () => {
    // Create activity 2 without vouchers
    const act2Res = await callTripApi("admin_manage_trip_activity", admin.accessToken, {
      action: "create",
      tripId,
      title: "Kayaking Tour",
      unitCapacity: 2,
      groupCount: 2,
    });
    assert.equal(act2Res.status, 200);
    const act2Id = act2Res.body?.activity_id;

    // Get groups for act2
    const getRes = await callTripApi("get_trip_activities", admin.accessToken, { tripId });
    const act2 = getRes.body.activities.find((a) => a.id === act2Id);
    const gA = act2.groups[0].id;
    const gB = act2.groups[1].id;

    // Assign Member A to gA, Member B to gB
    await callTripApi("admin_manage_activity_pairings", admin.accessToken, {
      tripId,
      activityId: act2Id,
      groups: [
        { id: gA, memberIds: [memberA.memberId] },
        { id: gB, memberIds: [memberB.memberId] },
      ],
    });

    // Member A requests partner swap with Member B
    const swapReq = await callTripApi("request_partner_swap", memberA.accessToken, {
      tripId,
      activityId: act2Id,
      targetGroupId: gB,
    });
    assert.equal(swapReq.status, 200, JSON.stringify(swapReq.body));
    const swapRequestId = swapReq.body?.swap_request_id || swapReq.body?.request_id || swapReq.raw?.request_id;
    assert.ok(swapRequestId, "swap request created");

    // Member B accepts partner swap
    const respondRes = await callTripApi("respond_partner_swap", memberB.accessToken, {
      swapRequestId,
      status: "accepted",
    });
    assert.equal(respondRes.status, 200, JSON.stringify(respondRes.body));

    // Verify swap completed: Member A is now in gB, Member B is now in gA
    const finalRes = await callTripApi("get_trip_activities", admin.accessToken, { tripId });
    const finalAct = finalRes.body.activities.find((a) => a.id === act2Id);
    const finalGA = finalAct.groups.find((g) => g.id === gA);
    const finalGB = finalAct.groups.find((g) => g.id === gB);

    assert.ok(finalGA.members.some((m) => m.member_id === memberB.memberId), "Member B moved to Group A");
    assert.ok(finalGB.members.some((m) => m.member_id === memberA.memberId), "Member A moved to Group B");
  });
});
