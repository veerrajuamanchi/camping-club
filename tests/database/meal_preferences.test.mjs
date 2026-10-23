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

async function createTestTrip(startsInDays = 30) {
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
    rules_markdown: "# Camping Rules\n1. Be kind.\n2. Leave no trace.",
  });
  if (tripErr) throw tripErr;

  return { tripId, campsiteId };
}

async function setupRsvp(tripId, memberId, response = "coming") {
  let ackId = null;
  let bundleId = null;
  let contentHash = null;

  if (response === "coming") {
    bundleId = randomUUID();
    contentHash = "a".repeat(64);
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

  const { data: rsvp, error: rsvpErr } = await serviceClient.from("trip_rsvps").insert({
    trip_id: tripId,
    member_id: memberId,
    response,
    rule_acknowledgment_id: ackId,
    deposit_status: "unpaid",
  }).select().single();
  if (rsvpErr) throw rsvpErr;

  return { rsvp, bundleId, contentHash };
}

test("trip_meal_preferences and not_coming guardrails", async (t) => {
  let admin;
  let member;
  let otherMember;

  await t.test("setup test actors", async () => {
    admin = await createTestMember("admin");
    member = await createTestMember("member");
    otherMember = await createTestMember("member");
    assert.ok(admin.memberId);
    assert.ok(member.memberId);
    assert.ok(otherMember.memberId);
  });

  await t.test("releases duty assignments, commitments, and meal preferences when member switches to not_coming via phase2_submit_rsvp", async () => {
    const { tripId } = await createTestTrip(45);
    const { rsvp } = await setupRsvp(tripId, member.memberId, "coming");

    // 1. Create a duty assignment for the member
    const slotId = randomUUID();
    const { error: slotErr } = await serviceClient.from("trip_time_slots").insert({
      id: slotId,
      trip_id: tripId,
      slot_date: new Date(Date.now() + 45 * 86400000).toISOString().slice(0, 10),
      time_block: "saturday_dinner",
      slot_type: "meal",
      label: "Saturday Dinner",
    });
    assert.ifError(slotErr);

    const { data: resp } = await serviceClient.from("master_responsibilities").select("id").limit(1).single();
    const dutyId = randomUUID();
    const { error: dutyErr } = await serviceClient.from("trip_slot_duties").insert({
      id: dutyId,
      time_slot_id: slotId,
      master_responsibility_id: resp.id,
      capacity: 2,
      workload_weight: 1.0,
    });
    assert.ifError(dutyErr);

    const assignmentId = randomUUID();
    const { error: assignErr } = await serviceClient.from("trip_duty_assignments").insert({
      id: assignmentId,
      trip_id: tripId,
      slot_duty_id: dutyId,
      member_id: member.memberId,
      status: "claimed",
    });
    assert.ifError(assignErr);

    // 2. Create a shared commitment assigned to member
    const commitmentId = randomUUID();
    const { error: commitErr } = await serviceClient.from("trip_commitments").insert({
      id: commitmentId,
      trip_id: tripId,
      category: "gear",
      item_name: "Camp Stove",
      assigned_member_id: member.memberId,
    });
    assert.ifError(commitErr);

    // 3. Insert meal preferences
    const { error: prefErr } = await serviceClient.from("trip_meal_preferences").insert({
      trip_id: tripId,
      member_id: member.memberId,
      saturday_beverage: "coffee",
      sunday_beverage: "tea",
      default_diet: "vegetarian",
      meal_choices: { saturday_dinner: "veg" },
      allergies_notes: "No peanuts",
    });
    assert.ifError(prefErr);

    // Verify all 3 exist
    const { count: dutyCountBefore } = await serviceClient.from("trip_duty_assignments").select("*", { count: "exact" }).eq("trip_id", tripId).eq("member_id", member.memberId).in("status", ["claimed", "assigned_by_admin"]);
    assert.equal(dutyCountBefore, 1);

    const { data: commitBefore } = await serviceClient.from("trip_commitments").select("assigned_member_id").eq("id", commitmentId).single();
    assert.equal(commitBefore.assigned_member_id, member.memberId);

    const { count: prefCountBefore } = await serviceClient.from("trip_meal_preferences").select("*", { count: "exact" }).eq("trip_id", tripId).eq("member_id", member.memberId);
    assert.equal(prefCountBefore, 1);

    // 4. Member switches RSVP to not_coming via phase2_submit_rsvp
    const { data: rsvpResult, error: rsvpError } = await serviceClient.rpc("phase2_submit_rsvp", {
      p_auth_user_id: member.authUserId,
      p_trip_id: tripId,
      p_response: "not_coming",
      p_bundle_id: null,
      p_content_hash: null,
      p_expected_version: rsvp.version,
      p_request_id: randomUUID(),
    });
    assert.ifError(rsvpError);
    assert.equal(rsvpResult.response, "not_coming");

    // 5. Verify auto-release:
    // Duty assignments must be cleared / deleted / unassigned
    const { count: dutyCountAfter } = await serviceClient.from("trip_duty_assignments").select("*", { count: "exact" }).eq("trip_id", tripId).eq("member_id", member.memberId).in("status", ["claimed", "assigned_by_admin"]);
    assert.equal(dutyCountAfter, 0, "Duty assignments should be dropped or deleted");

    // Commitments must be released (assigned_member_id = null)
    const { data: commitAfter } = await serviceClient.from("trip_commitments").select("assigned_member_id").eq("id", commitmentId).single();
    assert.equal(commitAfter.assigned_member_id, null, "Trip commitment should be reset to null");

    // Meal preferences must be removed
    const { count: prefCountAfter } = await serviceClient.from("trip_meal_preferences").select("*", { count: "exact" }).eq("trip_id", tripId).eq("member_id", member.memberId);
    assert.equal(prefCountAfter, 0, "Meal preferences should be deleted on not_coming");
  });

  await t.test("releases duty assignments, commitments, and meal preferences when admin records not_coming", async () => {
    const { tripId } = await createTestTrip(50);
    const { rsvp } = await setupRsvp(tripId, otherMember.memberId, "coming");

    // Create commitment and preferences
    const commitmentId = randomUUID();
    await serviceClient.from("trip_commitments").insert({
      id: commitmentId,
      trip_id: tripId,
      category: "supplies",
      item_name: "Firewood Bundle",
      assigned_member_id: otherMember.memberId,
    });

    await serviceClient.from("trip_meal_preferences").insert({
      trip_id: tripId,
      member_id: otherMember.memberId,
      saturday_beverage: "tea",
      sunday_beverage: "none",
      default_diet: "non_vegetarian",
    });

    // Admin records not_coming
    const { data: adminRsvpResult, error: adminRsvpErr } = await serviceClient.rpc("phase2_admin_record_interest", {
      p_actor_id: admin.memberId,
      p_trip_id: tripId,
      p_member_id: otherMember.memberId,
      p_response: "not_coming",
      p_expected_version: rsvp.version,
      p_reason: "Member called admin unable to attend",
      p_request_id: randomUUID(),
    });
    assert.ifError(adminRsvpErr);
    assert.equal(adminRsvpResult.response, "not_coming");

    // Commitments must be released
    const { data: commitAfter } = await serviceClient.from("trip_commitments").select("assigned_member_id").eq("id", commitmentId).single();
    assert.equal(commitAfter.assigned_member_id, null);

    // Meal preferences must be deleted
    const { count: prefCountAfter } = await serviceClient.from("trip_meal_preferences").select("*", { count: "exact" }).eq("trip_id", tripId).eq("member_id", otherMember.memberId);
    assert.equal(prefCountAfter, 0);
  });

  await t.test("trip_meal_preferences RLS policies enforce access control", async () => {
    const { tripId } = await createTestTrip(60);
    await setupRsvp(tripId, member.memberId, "coming");
    await setupRsvp(tripId, otherMember.memberId, "not_coming");

    // 1. Confirmed attendee can insert own meal preferences
    const { error: insertErr } = await member.client.from("trip_meal_preferences").insert({
      trip_id: tripId,
      member_id: member.memberId,
      saturday_beverage: "coffee",
      sunday_beverage: "tea",
      default_diet: "vegetarian",
      meal_choices: { sat_breakfast: "veg" },
      allergies_notes: "None",
    });
    assert.ifError(insertErr, "Confirmed coming member should be able to insert their preferences");

    // 2. Confirmed attendee can update own meal preferences
    const { error: updateErr } = await member.client.from("trip_meal_preferences").update({
      saturday_beverage: "tea",
    }).eq("trip_id", tripId).eq("member_id", member.memberId);
    assert.ifError(updateErr, "Confirmed coming member should be able to update their preferences");

    // 3. Member cannot insert preferences for another member
    const { error: impersonateErr } = await member.client.from("trip_meal_preferences").insert({
      trip_id: tripId,
      member_id: otherMember.memberId,
      saturday_beverage: "coffee",
      sunday_beverage: "coffee",
      default_diet: "vegetarian",
    });
    assert.ok(impersonateErr, "Member must not be allowed to insert preferences for another member");

    // 4. Not-going member cannot insert meal preferences
    const { error: notGoingInsertErr } = await otherMember.client.from("trip_meal_preferences").insert({
      trip_id: tripId,
      member_id: otherMember.memberId,
      saturday_beverage: "coffee",
      sunday_beverage: "coffee",
      default_diet: "vegetarian",
    });
    assert.ok(notGoingInsertErr, "Not-going member must be rejected from saving meal preferences");

    // 5. Authenticated members can read meal preferences for viewable trip
    const { data: readData, error: readErr } = await otherMember.client.from("trip_meal_preferences").select("*").eq("trip_id", tripId);
    assert.ifError(readErr);
    assert.equal(readData.length, 1);
    assert.equal(readData[0].saturday_beverage, "tea");
  });

  await t.test("guardrail: not-going respondent cannot volunteer for commitments", async () => {
    const { tripId } = await createTestTrip(70);
    await setupRsvp(tripId, member.memberId, "not_coming");

    const commitmentId = randomUUID();
    await serviceClient.from("trip_commitments").insert({
      id: commitmentId,
      trip_id: tripId,
      category: "gear",
      item_name: "Lantern",
    });

    // Attempt to claim commitment as not_coming member
    const { error: claimErr } = await serviceClient.rpc("phase4_manage_commitment", {
      p_action: "claim",
      p_trip_id: tripId,
      p_commitment_id: commitmentId,
      p_actor_id: member.memberId,
      p_is_admin: false,
    });
    assert.ok(claimErr, "Not-going member must be blocked from volunteering for commitments");
  });
});
