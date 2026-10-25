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

  return { tripId, campsiteId };
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

test("trip-api master catalogs, deposit tracking, and commitments extensions", async (t) => {
  let admin;
  let attendee;
  let cabinPayer;
  let tripId;

  await t.test("setup actors and trip fixture", async () => {
    admin = await createTestMember("admin");
    attendee = await createTestMember("member");
    cabinPayer = await createTestMember("member");

    const trip = await createTestTrip(cabinPayer.memberId);
    tripId = trip.tripId;

    await setupRsvp(tripId, attendee.memberId, "coming");
    await setupRsvp(tripId, cabinPayer.memberId, "coming");

    // Seed master commitments for the trip using DB RPC
    const { error: seedErr } = await serviceClient.rpc("seed_trip_commitments_from_master", {
      p_trip_id: tripId,
      p_actor_id: admin.memberId,
    });
    assert.equal(seedErr, null);
  });

  await t.test("get_master_catalogs returns categorized gear, food, and responsibilities", async () => {
    const res = await callTripApi("get_master_catalogs", attendee.accessToken, {});
    assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.ok(Array.isArray(res.body.gear), "Expected gear array");
    assert.ok(Array.isArray(res.body.food), "Expected food array");
    assert.ok(Array.isArray(res.body.responsibilities), "Expected responsibilities array");
    assert.ok(res.body.gear.length > 0, "Expected seeded gear items");
    assert.ok(res.body.food.length > 0, "Expected seeded food items");
  });

  await t.test("admin_manage_master_gear creates, updates, and deletes gear item", async () => {
    const gearName = `API Test Tent ${randomBytes(4).toString("hex")}`;
    const createRes = await callTripApi("admin_manage_master_gear", admin.accessToken, {
      action: "create",
      name: gearName,
      description: "4-person waterproof tent",
      gearType: "shared",
      category: "kitchen",
      defaultQuantity: "3",
      isCritical: true,
      active: true,
    });
    assert.equal(createRes.status, 200, `Create failed: ${JSON.stringify(createRes.body)}`);
    const createdId = createRes.body.id || createRes.body.item?.id;
    assert.ok(createdId, "Expected created gear item ID");

    // Non-admin cannot create
    const unauthorizedRes = await callTripApi("admin_manage_master_gear", attendee.accessToken, {
      action: "create",
      name: `Hacker Stove ${randomBytes(4).toString("hex")}`,
    });
    assert.equal(unauthorizedRes.status, 403, "Non-admin should receive 403");

    // Admin updates ONLY name — omitted fields (gearType, category, defaultQuantity, isCritical) must remain intact
    const updateRes = await callTripApi("admin_manage_master_gear", admin.accessToken, {
      action: "update",
      id: createdId,
      name: `${gearName} Updated`,
    });
    assert.equal(updateRes.status, 200);
    assert.equal(updateRes.body.name || updateRes.body.item?.name, `${gearName} Updated`);
    assert.equal(updateRes.body.gear_type, "shared", "Omitted gearType must remain unchanged on update");
    assert.equal(updateRes.body.category, "kitchen", "Omitted category must remain unchanged on update");
    assert.equal(updateRes.body.default_quantity, "3", "Omitted defaultQuantity must remain unchanged on update");
    assert.equal(updateRes.body.is_critical, true, "Omitted isCritical must remain unchanged on update");

    // Admin deletes
    const deleteRes = await callTripApi("admin_manage_master_gear", admin.accessToken, {
      action: "delete",
      id: createdId,
    });
    assert.equal(deleteRes.status, 200);
  });

  await t.test("admin_manage_master_food creates, updates, and deletes food item", async () => {
    const foodName = `API Test Pancake Mix ${randomBytes(4).toString("hex")}`;
    const createRes = await callTripApi("admin_manage_master_food", admin.accessToken, {
      action: "create",
      name: foodName,
      description: "Buttermilk mix",
      category: "produce",
      defaultQuantity: "5 bags",
      isCritical: true,
      active: true,
    });
    assert.equal(createRes.status, 200, `Food create failed: ${JSON.stringify(createRes.body)}`);
    const foodId = createRes.body.id || createRes.body.item?.id;
    assert.ok(foodId);

    // Update only name — category, quantity, isCritical must remain intact
    const updateRes = await callTripApi("admin_manage_master_food", admin.accessToken, {
      action: "update",
      id: foodId,
      name: `${foodName} Updated`,
    });
    assert.equal(updateRes.status, 200);
    assert.equal(updateRes.body.name, `${foodName} Updated`);
    assert.equal(updateRes.body.category, "produce", "Omitted category must remain unchanged on food update");
    assert.equal(updateRes.body.default_quantity, "5 bags", "Omitted defaultQuantity must remain unchanged on food update");
    assert.equal(updateRes.body.is_critical, true, "Omitted isCritical must remain unchanged on food update");

    const deleteRes = await callTripApi("admin_manage_master_food", admin.accessToken, {
      action: "delete",
      id: foodId,
    });
    assert.equal(deleteRes.status, 200);
  });

  await t.test("admin_delete_master_responsibility safely deletes responsibility", async () => {
    // Create master responsibility first
    const createRes = await callTripApi("admin_create_master_responsibility", admin.accessToken, {
      title: `API Temporary Duty ${randomBytes(4).toString("hex")}`,
      description: "Will be deleted",
      category: "other",
      defaultCapacity: 2,
      workloadWeight: 1.0,
    });
    assert.equal(createRes.status, 200);
    const respId = createRes.body.id || createRes.body.responsibilityId;
    assert.ok(respId);

    const delRes = await callTripApi("admin_delete_master_responsibility", admin.accessToken, {
      id: respId,
    });
    assert.equal(delRes.status, 200);
  });

  await t.test("get_trip_details returns depositStatus, cabinPayerMemberId, rulesMarkdown, and commitmentsList", async () => {
    // Normal attendee: depositStatus should be unpaid initially
    const attendeeRes = await callTripApi("get_trip_details", attendee.accessToken, { tripId });
    assert.equal(attendeeRes.status, 200, `Failed get_trip_details: ${JSON.stringify(attendeeRes.body)}`);
    assert.equal(attendeeRes.body.depositStatus, "unpaid");
    assert.equal(attendeeRes.body.cabinPayerMemberId, cabinPayer.memberId);
    assert.ok(attendeeRes.body.rulesMarkdown?.includes("Camping Club Constitution"));
    assert.ok(Array.isArray(attendeeRes.body.commitmentsList), "Expected commitmentsList array");
    assert.ok(attendeeRes.body.commitmentsList.length > 0, "Expected commitments to be populated");

    // Check categorized commitments
    assert.ok(attendeeRes.body.commitments, "Expected commitments object");
    assert.ok(Array.isArray(attendeeRes.body.commitments.individualPack), "Expected individualPack array");
    assert.ok(Array.isArray(attendeeRes.body.commitments.sharedVolunteer), "Expected sharedVolunteer array");

    // Cabin payer attendee: depositStatus should automatically resolve to exempt
    const cabinPayerRes = await callTripApi("get_trip_details", cabinPayer.accessToken, { tripId });
    assert.equal(cabinPayerRes.status, 200);
    assert.equal(cabinPayerRes.body.depositStatus, "exempt");
  });

  await t.test("submit_deposit marks attendee deposit submitted_by_member", async () => {
    const submitRes = await callTripApi("submit_deposit", attendee.accessToken, { tripId });
    assert.equal(submitRes.status, 200, `submit_deposit failed: ${JSON.stringify(submitRes.body)}`);
    assert.equal(submitRes.body.deposit_status, "submitted_by_member");

    // Re-query get_trip_details: depositStatus should now be submitted_by_member
    const detailsRes = await callTripApi("get_trip_details", attendee.accessToken, { tripId });
    assert.equal(detailsRes.status, 200);
    assert.equal(detailsRes.body.depositStatus, "submitted_by_member");
  });

  await t.test("verify_deposit confirms deposit by admin", async () => {
    // Attendee cannot verify
    const unauthVerify = await callTripApi("verify_deposit", attendee.accessToken, {
      tripId,
      memberId: attendee.memberId,
      status: "confirmed_by_admin",
    });
    assert.equal(unauthVerify.status, 403, "Non-admin cannot verify deposit");

    // Admin verifies
    const adminVerify = await callTripApi("verify_deposit", admin.accessToken, {
      tripId,
      memberId: attendee.memberId,
      status: "confirmed_by_admin",
    });
    assert.equal(adminVerify.status, 200, `verify_deposit failed: ${JSON.stringify(adminVerify.body)}`);
    assert.equal(adminVerify.body.deposit_status, "confirmed_by_admin");

    // Re-query get_trip_details
    const detailsRes = await callTripApi("get_trip_details", attendee.accessToken, { tripId });
    assert.equal(detailsRes.status, 200);
    assert.equal(detailsRes.body.depositStatus, "confirmed_by_admin");
  });

  await t.test("manage_trip_commitments toggles is_active for a commitment", async () => {
    const detailsRes = await callTripApi("get_trip_details", attendee.accessToken, { tripId });
    const commitment = detailsRes.body.commitmentsList[0];
    assert.ok(commitment, "Expected a commitment");
    assert.equal(commitment.isActive, true);

    // Toggle active to false
    const toggleRes = await callTripApi("manage_trip_commitments", admin.accessToken, {
      tripId,
      action: "toggle_active",
      commitmentId: commitment.id,
      isActive: false,
    });
    assert.equal(toggleRes.status, 200, `toggle_active failed: ${JSON.stringify(toggleRes.body)}`);

    // Verify in details
    const updatedDetails = await callTripApi("get_trip_details", attendee.accessToken, { tripId });
    const updatedCommitment = updatedDetails.body.commitmentsList.find((c) => c.id === commitment.id);
    assert.equal(updatedCommitment.isActive, false);
  });

  await t.test("manage_trip_commitments admin_create preserves commitmentType individual_pack", async () => {
    const createRes = await callTripApi("manage_trip_commitments", admin.accessToken, {
      tripId,
      action: "admin_create",
      itemName: "Bring Personal Headlamp",
      commitmentType: "individual_pack",
      category: "gear",
      quantityDescription: "1 per person",
      isCritical: false,
    });
    assert.equal(createRes.status, 200, `admin_create failed: ${JSON.stringify(createRes.body)}`);
    assert.equal(createRes.body.commitment_type, "individual_pack", "Must preserve commitment_type individual_pack");

    // Verify in get_trip_details
    const detailsRes = await callTripApi("get_trip_details", attendee.accessToken, { tripId });
    const created = detailsRes.body.commitmentsList.find((c) => c.itemName === "Bring Personal Headlamp");
    assert.ok(created, "Expected created commitment to appear in trip details");
    assert.equal(created.commitmentType, "individual_pack");
    assert.ok(detailsRes.body.commitments.individualPack.some((c) => c.id === created.id));
  });

  await t.test("manage_trip_commitment rejects claiming individual_pack items as shared commitments", async () => {
    // 1. Create a critical individual packing item
    const createRes = await callTripApi("manage_trip_commitments", admin.accessToken, {
      tripId,
      action: "admin_create",
      itemName: "Personal Rain Poncho",
      commitmentType: "individual_pack",
      category: "clothing",
      quantityDescription: "1 poncho",
      isCritical: true,
    });
    assert.equal(createRes.status, 200);
    const ponchoId = createRes.body.commitment_id || createRes.body.id;
    assert.ok(ponchoId, "Expected commitment id for rain poncho");

    // 2. Attendee attempts to claim it as a shared commitment
    const claimRes = await callTripApi("manage_trip_commitment", attendee.accessToken, {
      tripId,
      action: "claim",
      commitmentId: ponchoId,
    });
    assert.equal(claimRes.status, 400, "Must reject claiming individual packing items");
    assert.equal(claimRes.body.error.code, "cannot_claim_individual_item");

    // 3. Verify get_trip_logistics memberReadiness excludes this critical individual item from criticalMissingCount
    const logisticsRes = await callTripApi("get_trip_logistics", attendee.accessToken, { tripId });
    assert.equal(logisticsRes.status, 200);
    // criticalMissingCount must not include the individual poncho
    const ponchoInLogistics = logisticsRes.body.commitments.find((c) => c.id === ponchoId);
    assert.ok(ponchoInLogistics, "Commitment is returned in commitments list");
    assert.equal(ponchoInLogistics.commitmentType, "individual_pack");

    // Count how many critical shared items exist
    const criticalSharedItems = logisticsRes.body.commitments.filter(
      (c) => c.isCritical && !c.assignedMemberId && c.commitmentType === "shared_volunteer"
    );
    assert.equal(
      logisticsRes.body.memberReadiness.criticalMissingCount,
      criticalSharedItems.length,
      "memberReadiness.criticalMissingCount must strictly match unassigned critical shared items"
    );
  });
});
