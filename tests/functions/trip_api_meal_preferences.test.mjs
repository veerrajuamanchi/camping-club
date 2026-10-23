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
  temporaryDirectory = await mkdtemp(join(tmpdir(), "camping-club-test-api-"));
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

async function createTestTrip(cabinPayerId = null) {
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
    cabin_payer_member_id: cabinPayerId,
    rules_markdown: "# Camping Club Constitution\n\n1. Leave no trace.\n2. Respect quiet hours.",
  });
  if (tripErr) throw tripErr;

  return { tripId, campsiteId, startsOn, endsOn };
}

async function setupRsvp(tripId, memberId, response = "coming") {
  let ackId = null;
  if (response === "coming") {
    let { data: bundle } = await serviceClient.from("trip_rule_bundles").select("id, content_hash").eq("trip_id", tripId).maybeSingle();
    if (!bundle) {
      const bundleId = randomUUID();
      const contentHash = "b".repeat(64);
      const { data: insertedBundle, error: bundleErr } = await serviceClient.from("trip_rule_bundles").insert({
        id: bundleId,
        trip_id: tripId,
        version_no: 1,
        rendered_bundle: [],
        content_hash: contentHash,
        is_current: true,
      }).select("id, content_hash").single();
      if (bundleErr) throw bundleErr;
      bundle = insertedBundle;
    }

    ackId = randomUUID();
    const { error: ackErr } = await serviceClient.from("trip_rule_acknowledgments").insert({
      id: ackId,
      trip_id: tripId,
      member_id: memberId,
      bundle_id: bundle.id,
      content_hash: bundle.content_hash,
      statement_version: "coming-v1",
      request_id: randomUUID(),
    });
    if (ackErr) throw ackErr;
  }

  const { error: rsvpErr } = await serviceClient.from("trip_rsvps").insert({
    trip_id: tripId,
    member_id: memberId,
    response,
    rule_acknowledgment_id: ackId,
    deposit_status: "unpaid",
  });
  if (rsvpErr) throw rsvpErr;
}

test("trip-api meal and beverage preferences endpoints", async (t) => {
  let admin;
  let attendeeGoing1;
  let attendeeGoing2;
  let attendeeNotGoing;
  let tripId;
  let mealSlots;

  await t.test("setup actors and trip fixture", async () => {
    admin = await createTestMember("admin");
    attendeeGoing1 = await createTestMember("member");
    attendeeGoing2 = await createTestMember("member");
    attendeeNotGoing = await createTestMember("member");

    const trip = await createTestTrip(attendeeGoing1.memberId);
    tripId = trip.tripId;

    await setupRsvp(tripId, attendeeGoing1.memberId, "coming");
    await setupRsvp(tripId, attendeeGoing2.memberId, "coming");
    await setupRsvp(tripId, attendeeNotGoing.memberId, "not_coming");

    // Insert candidate meal slots directly for the trip
    const { data: slots, error: slotsErr } = await serviceClient
      .from("trip_time_slots")
      .insert([
        {
          trip_id: tripId,
          slot_date: trip.startsOn,
          time_block: "friday_dinner",
          slot_type: "meal",
          label: "Friday Dinner",
          sort_order: 10,
          is_enabled: true,
        },
        {
          trip_id: tripId,
          slot_date: trip.startsOn,
          time_block: "saturday_lunch",
          slot_type: "meal",
          label: "Saturday Lunch",
          sort_order: 20,
          is_enabled: true,
        },
        {
          trip_id: tripId,
          slot_date: trip.endsOn,
          time_block: "sunday_morning",
          slot_type: "meal",
          label: "Sunday Breakfast",
          sort_order: 30,
          is_enabled: true,
        },
      ])
      .select("id, label, slot_type, slot_date");
    assert.equal(slotsErr, null);
    assert.ok(slots.length >= 3, "Expected at least 3 meal slots");
    mealSlots = slots;
  });

  await t.test("save_meal_preferences rejects non-attendee / not-going member with 403", async () => {
    const res = await callTripApi("save_meal_preferences", attendeeNotGoing.accessToken, {
      tripId,
      saturdayBeverage: "coffee",
      sundayBeverage: "tea",
      defaultDiet: "vegetarian",
      mealChoices: {},
    });
    assert.equal(res.status, 403, `Expected 403 for not-going member, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.match(res.raw?.error?.message || res.raw?.message || res.raw?.error || "", /Only confirmed coming attendees can save meal preferences/i);
  });

  await t.test("save_meal_preferences saves preferences for confirmed attendee", async () => {
    const slot1 = mealSlots[0].id;
    const slot2 = mealSlots[1].id;
    const slot3 = mealSlots[2].id;

    const res = await callTripApi("save_meal_preferences", attendeeGoing1.accessToken, {
      tripId,
      saturdayBeverage: "coffee",
      sundayBeverage: "none",
      defaultDiet: "non_vegetarian",
      mealChoices: {
        [slot1]: "veg",
        [slot2]: "non_veg",
        [slot3]: "skip",
      },
      allergiesNotes: "Mild peanut allergy",
    });

    assert.equal(res.status, 200, `save_meal_preferences failed: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.success, true);
    assert.equal(res.body.preferences.saturdayBeverage, "coffee");
    assert.equal(res.body.preferences.sundayBeverage, "none");
    assert.equal(res.body.preferences.defaultDiet, "non_vegetarian");
    assert.equal(res.body.preferences.allergiesNotes, "Mild peanut allergy");
    assert.equal(res.body.preferences.mealChoices[slot1], "veg");
    assert.equal(res.body.preferences.mealChoices[slot2], "non_veg");
    assert.equal(res.body.preferences.mealChoices[slot3], "skip");
  });

  await t.test("get_trip_details returns myMealPreferences and computed mealHeadcounts", async () => {
    const res = await callTripApi("get_trip_details", attendeeGoing1.accessToken, { tripId });
    assert.equal(res.status, 200, `get_trip_details failed: ${JSON.stringify(res.body)}`);

    // Verify myMealPreferences
    const myPrefs = res.body.myMealPreferences;
    assert.ok(myPrefs, "Expected myMealPreferences in get_trip_details");
    assert.equal(myPrefs.saturdayBeverage, "coffee");
    assert.equal(myPrefs.sundayBeverage, "none");
    assert.equal(myPrefs.defaultDiet, "non_vegetarian");
    assert.equal(myPrefs.allergiesNotes, "Mild peanut allergy");

    // Verify mealHeadcounts
    const headcounts = res.body.mealHeadcounts;
    assert.ok(headcounts, "Expected mealHeadcounts in get_trip_details");
    assert.ok(headcounts.beverages, "Expected beverages in mealHeadcounts");
    assert.ok(headcounts.meals, "Expected meals array in mealHeadcounts");

    // attendeeGoing1: sat = coffee, sun = none
    // attendeeGoing2 (no pref row): defaults to sat = coffee, sun = tea
    // Total Saturday: coffee = 2, tea = 0, none = 0
    // Total Sunday: coffee = 0, tea = 1, none = 1
    assert.equal(headcounts.beverages.saturday.coffee, 2);
    assert.equal(headcounts.beverages.saturday.tea, 0);
    assert.equal(headcounts.beverages.saturday.none, 0);

    assert.equal(headcounts.beverages.sunday.coffee, 0);
    assert.equal(headcounts.beverages.sunday.tea, 1);
    assert.equal(headcounts.beverages.sunday.none, 1);

    // Meals verification:
    // slot1: attendeeGoing1='veg', attendeeGoing2=default 'veg' -> veg: 2, nonVeg: 0, skip: 0, total: 2
    // slot2: attendeeGoing1='non_veg', attendeeGoing2=default 'veg' -> veg: 1, nonVeg: 1, skip: 0, total: 2
    // slot3: attendeeGoing1='skip', attendeeGoing2=default 'veg' -> veg: 1, nonVeg: 0, skip: 1, total: 1
    const slot1Headcount = headcounts.meals.find((m) => m.slotId === mealSlots[0].id);
    assert.ok(slot1Headcount, "Expected slot1 in meals headcount");
    assert.equal(slot1Headcount.vegCount, 2);
    assert.equal(slot1Headcount.nonVegCount, 0);
    assert.equal(slot1Headcount.skipCount, 0);
    assert.equal(slot1Headcount.totalEating, 2);

    const slot2Headcount = headcounts.meals.find((m) => m.slotId === mealSlots[1].id);
    assert.ok(slot2Headcount, "Expected slot2 in meals headcount");
    assert.equal(slot2Headcount.vegCount, 1);
    assert.equal(slot2Headcount.nonVegCount, 1);
    assert.equal(slot2Headcount.skipCount, 0);
    assert.equal(slot2Headcount.totalEating, 2);

    const slot3Headcount = headcounts.meals.find((m) => m.slotId === mealSlots[2].id);
    assert.ok(slot3Headcount, "Expected slot3 in meals headcount");
    assert.equal(slot3Headcount.vegCount, 1);
    assert.equal(slot3Headcount.nonVegCount, 0);
    assert.equal(slot3Headcount.skipCount, 1);
    assert.equal(slot3Headcount.totalEating, 1);
  });

  await t.test("get_trip_task_matrix returns myMealPreferences and mealHeadcounts", async () => {
    const res = await callTripApi("get_trip_task_matrix", attendeeGoing1.accessToken, { tripId });
    assert.equal(res.status, 200, `get_trip_task_matrix failed: ${JSON.stringify(res.body)}`);

    const myPrefs = res.body.myMealPreferences;
    assert.ok(myPrefs, "Expected myMealPreferences in get_trip_task_matrix");
    assert.equal(myPrefs.saturdayBeverage, "coffee");

    const headcounts = res.body.mealHeadcounts;
    assert.ok(headcounts, "Expected mealHeadcounts in get_trip_task_matrix");
    assert.equal(headcounts.beverages.saturday.coffee, 2);
    assert.equal(headcounts.beverages.sunday.none, 1);
  });

  await t.test("save_meal_preferences updates existing record on conflict", async () => {
    const res = await callTripApi("save_meal_preferences", attendeeGoing1.accessToken, {
      tripId,
      saturdayBeverage: "tea",
      sundayBeverage: "coffee",
      defaultDiet: "vegetarian",
      mealChoices: {},
      allergiesNotes: "Updated notes",
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.preferences.saturdayBeverage, "tea");
    assert.equal(res.body.preferences.sundayBeverage, "coffee");
    assert.equal(res.body.preferences.defaultDiet, "vegetarian");
    assert.equal(res.body.preferences.allergiesNotes, "Updated notes");

    // Recheck get_trip_details
    const details = await callTripApi("get_trip_details", attendeeGoing1.accessToken, { tripId });
    assert.equal(details.status, 200);
    assert.equal(details.body.myMealPreferences.saturdayBeverage, "tea");
    // Saturday: attendeeGoing1=tea, attendeeGoing2(default)=coffee -> coffee: 1, tea: 1, none: 0
    assert.equal(details.body.mealHeadcounts.beverages.saturday.coffee, 1);
    assert.equal(details.body.mealHeadcounts.beverages.saturday.tea, 1);
  });
});
