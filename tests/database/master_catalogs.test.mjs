import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

function getSupabaseStatus() {
  const statusRun = spawnSync("npx", ["supabase", "status", "-o", "json"], { encoding: "utf8" });
  if (statusRun.status !== 0) throw new Error("Local Supabase is not running. Run npx supabase start first.");
  const jsonAt = statusRun.stdout.indexOf("{");
  return JSON.parse(statusRun.stdout.slice(jsonAt));
}

const status = getSupabaseStatus();
const api = status.API_URL;
const serviceKey = status.SERVICE_ROLE_KEY;
const publishableKey = status.PUBLISHABLE_KEY || status.ANON_KEY;

const serviceClient = createClient(api, serviceKey, { auth: { persistSession: false } });

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
    client,
    accessToken: sessionData.session.access_token,
  };
}

async function createTestTrip(startsInDays = 30, cabinPayerId = null) {
  const tripId = randomUUID();
  const { data: campsite } = await serviceClient.from("campsites").select("id").limit(1).single();
  const campsiteId = campsite.id;

  const startsOn = new Date(Date.now() + startsInDays * 86400000).toISOString().slice(0, 10);
  const endsOn = new Date(Date.now() + (startsInDays + 3) * 86400000).toISOString().slice(0, 10);

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
    rules_markdown: "# Camping Rules\n1. Be kind.\n2. Leave no trace.",
  });
  if (tripErr) throw tripErr;

  return { tripId, campsiteId };
}

async function setupRsvp(tripId, memberId, client, response = "coming") {
  let ackId = null;
  if (response === "coming") {
    const bundleId = randomUUID();
    const contentHash = "a".repeat(64);
    const { error: bundleErr } = await serviceClient.from("trip_rule_bundles").insert({
      id: bundleId,
      trip_id: tripId,
      version_no: 1,
      rendered_bundle: [],
      content_hash: contentHash,
      is_current: true,
    });
    if (bundleErr) throw bundleErr;

    ackId = randomUUID();
    const { error: ackErr } = await serviceClient.from("trip_rule_acknowledgments").insert({
      id: ackId,
      trip_id: tripId,
      member_id: memberId,
      bundle_id: bundleId,
      content_hash: contentHash,
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

test("master catalogs, commitments extension, and deposit tracking boundaries", async (t) => {
  let admin;
  let regularMember;

  await t.test("setup test actors", async () => {
    admin = await createTestMember("admin");
    regularMember = await createTestMember("member");
    assert.ok(admin.memberId);
    assert.ok(regularMember.memberId);
  });

  await t.test("1. Admin can insert, update, and delete in master_gear and master_food_groceries", async () => {
    // Admin inserts master gear
    const { data: gearData, error: gearErr } = await admin.client.rpc("admin_manage_master_gear", {
      p_action: "create",
      p_name: `Camp Stove ${randomBytes(4).toString("hex")}`,
      p_description: "2-burner propane stove",
      p_gear_type: "shared",
      p_category: "kitchen",
      p_default_quantity: "1",
      p_is_critical: true,
    });
    assert.ifError(gearErr);
    assert.ok(gearData.id);

    // Admin updates master gear
    const { data: updateData, error: updateErr } = await admin.client.rpc("admin_manage_master_gear", {
      p_action: "update",
      p_id: gearData.id,
      p_name: `Updated Stove ${randomBytes(4).toString("hex")}`,
      p_default_quantity: "2",
    });
    assert.ifError(updateErr);
    assert.equal(updateData.default_quantity, "2");

    // Admin inserts master food
    const { data: foodData, error: foodErr } = await admin.client.rpc("admin_manage_master_food", {
      p_action: "create",
      p_name: `Pancake Mix ${randomBytes(4).toString("hex")}`,
      p_description: "Fluffy buttermilk",
      p_category: "pantry",
      p_default_quantity: "2 boxes",
      p_is_critical: false,
    });
    assert.ifError(foodErr);
    assert.ok(foodData.id);

    // Admin updates master food
    const { data: updateFood, error: updateFoodErr } = await admin.client.rpc("admin_manage_master_food", {
      p_action: "update",
      p_id: foodData.id,
      p_default_quantity: "3 boxes",
    });
    assert.ifError(updateFoodErr);
    assert.equal(updateFood.default_quantity, "3 boxes");

    // Admin deletes master food
    const { data: delFood, error: delFoodErr } = await admin.client.rpc("admin_manage_master_food", {
      p_action: "delete",
      p_id: foodData.id,
    });
    assert.ifError(delFoodErr);
    assert.equal(delFood.success, true);
  });

  await t.test("2. Non-admin is rejected with permission error", async () => {
    // Non-admin attempts to create master gear via RPC
    const { error: rpcErr } = await regularMember.client.rpc("admin_manage_master_gear", {
      p_action: "create",
      p_name: "Unauthorized Tent",
      p_gear_type: "individual",
      p_category: "shelter",
    });
    assert.ok(rpcErr, "Expected non-admin RPC call to fail");
    assert.match(rpcErr.message, /unauthorized|administrator role required/i);

    // Non-admin attempts direct table insert via Data API
    const { error: tableErr } = await regularMember.client.from("master_gear").insert({
      name: "Direct Insert Tent",
      gear_type: "individual",
      category: "shelter",
    });
    assert.ok(tableErr, "Expected direct table insert to fail under RLS");

    // Non-admin attempts master food creation
    const { error: foodErr } = await regularMember.client.rpc("admin_manage_master_food", {
      p_action: "create",
      p_name: "Unauthorized Food",
      p_category: "pantry",
    });
    assert.ok(foodErr, "Expected non-admin food RPC to fail");
  });

  await t.test("3. submit_member_deposit updates trip_rsvps.deposit_status to 'submitted_by_member'", async () => {
    const { tripId } = await createTestTrip(20);
    await setupRsvp(tripId, regularMember.memberId, regularMember.client, "coming");

    // Regular member submits deposit
    const { data: submitData, error: submitErr } = await regularMember.client.rpc("submit_member_deposit", {
      p_trip_id: tripId,
    });
    assert.ifError(submitErr);
    assert.equal(submitData.deposit_status, "submitted_by_member");

    // Verify in database
    const { data: rsvpRow } = await serviceClient
      .from("trip_rsvps")
      .select("deposit_status, deposit_submitted_at")
      .eq("trip_id", tripId)
      .eq("member_id", regularMember.memberId)
      .single();

    assert.equal(rsvpRow.deposit_status, "submitted_by_member");
    assert.ok(rsvpRow.deposit_submitted_at);

    // Admin verifies member deposit
    const { data: verifyData, error: verifyErr } = await admin.client.rpc("verify_member_deposit", {
      p_trip_id: tripId,
      p_member_id: regularMember.memberId,
      p_status: "confirmed_by_admin",
    });
    assert.ifError(verifyErr);
    assert.equal(verifyData.deposit_status, "confirmed_by_admin");
  });

  await t.test("4. Attending cabin payer resolves to 'exempt'", async () => {
    // Trip where regularMember is the designated cabin payer
    const { tripId } = await createTestTrip(25, regularMember.memberId);
    await setupRsvp(tripId, regularMember.memberId, regularMember.client, "coming");

    const { data: payerSubmit, error: payerErr } = await regularMember.client.rpc("submit_member_deposit", {
      p_trip_id: tripId,
    });
    assert.ifError(payerErr);
    assert.equal(payerSubmit.deposit_status, "exempt");

    const { data: rsvpRow } = await serviceClient
      .from("trip_rsvps")
      .select("deposit_status")
      .eq("trip_id", tripId)
      .eq("member_id", regularMember.memberId)
      .single();

    assert.equal(rsvpRow.deposit_status, "exempt");
  });

  await t.test("5. Deleting a master gear item sets trip_commitments.master_gear_id to NULL without deleting commitment", async () => {
    const { tripId } = await createTestTrip(30);

    // Create a master gear item
    const { data: gearItem } = await admin.client.rpc("admin_manage_master_gear", {
      p_action: "create",
      p_name: `Temp Lantern ${randomBytes(4).toString("hex")}`,
      p_description: "Bright lantern",
      p_gear_type: "shared",
      p_category: "lighting",
      p_default_quantity: "1",
    });
    assert.ok(gearItem.id);

    // Create a trip commitment referencing this master gear
    const commitmentId = randomUUID();
    const { error: commitErr } = await serviceClient.from("trip_commitments").insert({
      id: commitmentId,
      trip_id: tripId,
      category: "lighting",
      item_name: "Temp Lantern",
      quantity_description: "1",
      master_gear_id: gearItem.id,
      commitment_type: "shared_volunteer",
      is_active: true,
    });
    assert.ifError(commitErr);

    // Delete the master gear item
    const { data: delResult, error: delErr } = await admin.client.rpc("admin_manage_master_gear", {
      p_action: "delete",
      p_id: gearItem.id,
    });
    assert.ifError(delErr);
    assert.equal(delResult.success, true);

    // Commitment row must still exist, with master_gear_id set to NULL
    const { data: retainedCommitment, error: fetchErr } = await serviceClient
      .from("trip_commitments")
      .select("id, item_name, master_gear_id")
      .eq("id", commitmentId)
      .single();

    assert.ifError(fetchErr);
    assert.ok(retainedCommitment, "Commitment row must not be deleted");
    assert.equal(retainedCommitment.item_name, "Temp Lantern");
    assert.equal(retainedCommitment.master_gear_id, null, "master_gear_id must be ON DELETE SET NULL");
  });

  await t.test("6. Deleting unused master responsibility deletes row; deleting used one soft-retires (active = FALSE)", async () => {
    // Create an unused master responsibility
    const { data: unusedResp } = await serviceClient.rpc("phase3_admin_create_master_responsibility", {
      p_title: `Unused Chore ${randomBytes(4).toString("hex")}`,
      p_description: "Temporary unused chore",
      p_category: "cleanup",
      p_default_capacity: 2,
      p_workload_weight: 1.0,
      p_actor_id: admin.memberId,
    });
    assert.ok(unusedResp.id);

    // Admin deletes unused responsibility -> hard delete
    const { data: delUnused, error: delUnusedErr } = await admin.client.rpc("admin_delete_master_responsibility", {
      p_id: unusedResp.id,
    });
    assert.ifError(delUnusedErr);
    assert.equal(delUnused.action, "deleted");

    const { data: checkDeleted } = await serviceClient
      .from("master_responsibilities")
      .select("id")
      .eq("id", unusedResp.id);
    assert.equal(checkDeleted.length, 0, "Unused responsibility should be removed from database");

    // Create a used master responsibility
    const { data: usedResp } = await serviceClient.rpc("phase3_admin_create_master_responsibility", {
      p_title: `Used Duty ${randomBytes(4).toString("hex")}`,
      p_description: "Duty assigned in a trip slot",
      p_category: "cooking",
      p_default_capacity: 1,
      p_workload_weight: 1.5,
      p_actor_id: admin.memberId,
    });
    assert.ok(usedResp.id);

    // Reference it in a trip slot duty
    const { tripId } = await createTestTrip(40);
    const slotId = randomUUID();
    await serviceClient.from("trip_time_slots").insert({
      id: slotId,
      trip_id: tripId,
      slot_date: new Date(Date.now() + 40 * 86400000).toISOString().slice(0, 10),
      time_block: "saturday_dinner",
      slot_type: "meal",
      label: "Saturday Dinner",
    });

    const dutyId = randomUUID();
    await serviceClient.from("trip_slot_duties").insert({
      id: dutyId,
      time_slot_id: slotId,
      master_responsibility_id: usedResp.id,
      capacity: 1,
      workload_weight: 1.5,
    });

    // Admin deletes used responsibility -> soft-retire
    const { data: delUsed, error: delUsedErr } = await admin.client.rpc("admin_delete_master_responsibility", {
      p_id: usedResp.id,
    });
    assert.ifError(delUsedErr);
    assert.equal(delUsed.action, "soft_retired");
    assert.equal(delUsed.active, false);

    const { data: checkSoftRetired } = await serviceClient
      .from("master_responsibilities")
      .select("id, active")
      .eq("id", usedResp.id)
      .single();

    assert.ok(checkSoftRetired, "Used responsibility must still exist in table");
    assert.equal(checkSoftRetired.active, false, "Used responsibility active flag must be false");
  });

  await t.test("7. seed_trip_commitments_from_master auto-seeds items and update_trip_commitment_status toggles active", async () => {
    const { tripId } = await createTestTrip(45);

    // Seed commitments from master
    const { data: seedData, error: seedErr } = await admin.client.rpc("seed_trip_commitments_from_master", {
      p_trip_id: tripId,
    });
    assert.ifError(seedErr);
    assert.ok(seedData.gear_seeded > 0, "Should seed master gear items");
    assert.ok(seedData.food_seeded > 0, "Should seed master food items");

    // Check commitments exist
    const { data: seededItems, error: itemsErr } = await serviceClient
      .from("trip_commitments")
      .select("id, item_name, is_active, commitment_type, master_gear_id, master_food_id")
      .eq("trip_id", tripId);
    assert.ifError(itemsErr);
    assert.ok(seededItems.length >= seedData.gear_seeded + seedData.food_seeded);

    const testItem = seededItems[0];
    assert.equal(testItem.is_active, true);

    // Admin toggles active status to false
    const { data: toggleData, error: toggleErr } = await admin.client.rpc("update_trip_commitment_status", {
      p_commitment_id: testItem.id,
      p_is_active: false,
    });
    assert.ifError(toggleErr);
    assert.equal(toggleData.is_active, false);

    const { data: updatedItem } = await serviceClient
      .from("trip_commitments")
      .select("is_active")
      .eq("id", testItem.id)
      .single();
    assert.equal(updatedItem.is_active, false);

    // Non-admin cannot toggle status
    const { error: unauthErr } = await regularMember.client.rpc("update_trip_commitment_status", {
      p_commitment_id: testItem.id,
      p_is_active: true,
    });
    assert.ok(unauthErr, "Non-admin should not be able to toggle commitment status");
  });
});
