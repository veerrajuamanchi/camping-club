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

async function callMemberApi(action, token, input = {}, requestKey = randomUUID()) {
  const headers = {
    apikey: publishableKey,
    Authorization: `Bearer ${token}`,
    Origin: "http://localhost:5173",
    "Content-Type": "application/json",
  };
  if (requestKey) headers["Idempotency-Key"] = requestKey;

  const response = await fetch(`${api}/functions/v1/member-api`, {
    method: "POST",
    headers,
    body: JSON.stringify({ action, input }),
  });
  const jsonBody = await response.json().catch(() => null);
  const body = jsonBody?.data !== undefined ? jsonBody.data : jsonBody;
  return { status: response.status, body, raw: jsonBody };
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

test("accountant role and dynamic expense splits endpoints", async (t) => {
  let admin;
  let memberTarget;
  let attendee1;
  let attendee2;
  let attendee3;
  let tripId;

  await t.test("setup fixtures", async () => {
    admin = await createTestMember("admin");
    memberTarget = await createTestMember("member");
    attendee1 = await createTestMember("member");
    attendee2 = await createTestMember("member");
    attendee3 = await createTestMember("member");

    const trip = await createTestTrip(attendee1.memberId);
    tripId = trip.tripId;
  });

  await t.test("member-api allows updating a member's role to accountant", async () => {
    const res = await callMemberApi("update_membership", admin.accessToken, {
      memberId: memberTarget.memberId,
      memberRole: "accountant",
      accountStatus: "active",
      reason: "Appointed club accountant",
    });

    assert.equal(res.status, 200, `Expected 200 OK but got ${res.status}: ${JSON.stringify(res.raw)}`);
    assert.equal(res.body.updated, true);

    const { data: updatedProfile } = await serviceClient
      .from("member_profiles")
      .select("member_role")
      .eq("member_id", memberTarget.memberId)
      .single();
    assert.equal(updatedProfile.member_role, "accountant");
  });

  await t.test("trip-api permits verify_deposit for user with member_role === accountant", async () => {
    await setupRsvp(tripId, attendee1.memberId, "coming");

    const res = await callTripApi("verify_deposit", memberTarget.accessToken, {
      tripId,
      memberId: attendee1.memberId,
      status: "confirmed_by_admin",
    });

    assert.equal(res.status, 200, `Expected 200 OK for accountant verify_deposit but got ${res.status}: ${JSON.stringify(res.raw)}`);

    const { data: rsvp } = await serviceClient
      .from("trip_rsvps")
      .select("deposit_status, deposit_confirmed_by")
      .eq("trip_id", tripId)
      .eq("member_id", attendee1.memberId)
      .single();
    assert.equal(rsvp.deposit_status, "confirmed_by_admin");
    assert.equal(rsvp.deposit_confirmed_by, memberTarget.memberId);
  });

  await t.test("trip-api rejects admin actions for accountant with 403 administrator_required", async () => {
    const resConfig = await callTripApi("admin_configure_trip", memberTarget.accessToken, {
      tripId,
      title: "Accountant Hijacked Title",
      reason: "Unauthorized attempt",
    });
    assert.equal(resConfig.status, 403);
    assert.equal(resConfig.raw?.error?.code ?? resConfig.body?.error, "administrator_required");

    const resFinalize = await callTripApi("admin_finalize_settlement", memberTarget.accessToken, {
      tripId,
    });
    assert.equal(resFinalize.status, 403);
    assert.equal(resFinalize.raw?.error?.code ?? resFinalize.body?.error, "administrator_required");
  });

  await t.test("admin_manage_trip_expense guards against zero-attendee dynamic split creation", async () => {
    // Create an empty trip with 0 attendees
    const emptyTrip = await createTestTrip();

    const res = await callTripApi("admin_manage_trip_expense", admin.accessToken, {
      tripId: emptyTrip.tripId,
      action: "create",
      amountCents: 10000,
      description: "Campfire Groceries",
      splitMode: "all_attendees",
    });

    assert.equal(res.status, 400, `Expected 400 error for 0 attendees dynamic split, got ${res.status}`);
  });

  await t.test("getTripFinancials returns dynamically calculated allocations across all Coming attendees", async () => {
    // attendee1 is already Coming. Add attendee2 as Coming.
    await setupRsvp(tripId, attendee2.memberId, "coming");

    // Create an expense with splitMode: "all_attendees" and receipt metadata
    const createRes = await callTripApi("admin_manage_trip_expense", admin.accessToken, {
      tripId,
      action: "create",
      payerMemberId: attendee1.memberId,
      amountCents: 10000,
      description: "Camp firewood and s'mores",
      splitMode: "all_attendees",
      receiptStoragePath: `trips/${tripId}/receipt-1.jpg`,
      receiptFileName: "receipt-1.jpg",
      receiptContentType: "image/jpeg",
    });
    assert.equal(createRes.status, 200, `Create expense failed: ${JSON.stringify(createRes.raw)}`);

    // Fetch financials with 2 attendees
    const finRes2 = await callTripApi("get_trip_financials", attendee1.accessToken, { tripId });
    assert.equal(finRes2.status, 200);

    const expenseItem = finRes2.body.expenses.find((e) => e.description === "Camp firewood and s'mores");
    assert.ok(expenseItem, "Expense item should be present");
    assert.equal(expenseItem.splitMode, "all_attendees");
    assert.equal(expenseItem.receiptFileName, "receipt-1.jpg");
    assert.equal(expenseItem.receiptStoragePath, `trips/${tripId}/receipt-1.jpg`);
    assert.equal(expenseItem.receiptContentType, "image/jpeg");

    // Allocations should be split 5000/5000 between attendee1 and attendee2
    assert.equal(expenseItem.allocations.length, 2);
    const sum2 = expenseItem.allocations.reduce((sum, a) => sum + a.allocatedCents, 0);
    assert.equal(sum2, 10000);
    assert.ok(expenseItem.allocations.every((a) => a.allocatedCents === 5000));

    // Now attendee3 RSVPs Coming
    await setupRsvp(tripId, attendee3.memberId, "coming");

    // Fetch financials again: allocations should dynamically include all 3 attendees
    const finRes3 = await callTripApi("get_trip_financials", attendee1.accessToken, { tripId });
    assert.equal(finRes3.status, 200);

    const dynamicExp3 = finRes3.body.expenses.find((e) => e.description === "Camp firewood and s'mores");
    assert.equal(dynamicExp3.allocations.length, 3);
    const sum3 = dynamicExp3.allocations.reduce((sum, a) => sum + a.allocatedCents, 0);
    assert.equal(sum3, 10000);
    // 10000 / 3 = 3333 with remainder 1 cents -> one attendee gets 3334, others get 3333
    const centsList = dynamicExp3.allocations.map((a) => a.allocatedCents).sort((a, b) => b - a);
    assert.deepEqual(centsList, [3334, 3333, 3333]);
  });

  await t.test("admin_finalize_settlement materializes dynamic allocations into trip_expense_allocations", async () => {
    const finRes = await callTripApi("get_trip_financials", admin.accessToken, { tripId });
    const expenseItem = finRes.body.expenses.find((e) => e.description === "Camp firewood and s'mores");
    assert.ok(expenseItem);

    // Finalize settlement
    const finalizeRes = await callTripApi("admin_finalize_settlement", admin.accessToken, { tripId });
    assert.equal(finalizeRes.status, 200, `Finalize settlement failed: ${JSON.stringify(finalizeRes.raw)}`);

    // Verify trip_expense_allocations contains the 3 materialized rows
    const { data: dbAllocations } = await serviceClient
      .from("trip_expense_allocations")
      .select("member_id, allocated_cents")
      .eq("expense_id", expenseItem.id);

    assert.equal(dbAllocations.length, 3, "Dynamic allocations should be materialized into database table");
    const totalAllocated = dbAllocations.reduce((s, a) => s + a.allocated_cents, 0);
    assert.equal(totalAllocated, 10000);

    // Verify trip_expenses is locked
    const { data: lockedExp } = await serviceClient
      .from("trip_expenses")
      .select("is_locked")
      .eq("id", expenseItem.id)
      .single();
    assert.equal(lockedExp.is_locked, true);

    // Verify settlement run status is finalized
    const { data: run } = await serviceClient
      .from("settlement_runs")
      .select("status")
      .eq("trip_id", tripId)
      .single();
    assert.equal(run.status, "finalized");
  });
});
