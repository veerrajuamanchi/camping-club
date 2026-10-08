import { spawn, spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { terminateProcessTree } from "./terminate-process.mjs";

const reset = spawnSync("npx", ["supabase", "db", "reset", "--local"], { encoding: "utf8" });
if (reset.status !== 0) throw new Error("Start local Supabase before running Phase 2 integration tests.");
const statusRun = spawnSync("npx", ["supabase", "status", "-o", "json"], { encoding: "utf8" });
if (statusRun.status !== 0) throw new Error("Start local Supabase before running Phase 2 integration tests.");
const status = JSON.parse(statusRun.stdout.slice(statusRun.stdout.indexOf("{")));
const api = status.API_URL;
const serviceKey = status.SERVICE_ROLE_KEY;
const publishableKey = status.PUBLISHABLE_KEY;
const temporaryDirectory = await mkdtemp(join(tmpdir(), "camping-club-phase2-"));
const envPath = join(temporaryDirectory, "functions.env");
const secret = () => randomBytes(32).toString("base64");
await writeFile(envPath, [
  `SUPABASE_URL=${api}`,
  `SUPABASE_SECRET_KEYS={"default":"${serviceKey}"}`,
  `INVITATION_HMAC_KEY=${secret()}`,
  `IDEMPOTENCY_HMAC_KEY=${secret()}`,
  "IDEMPOTENCY_HMAC_KEY_VERSION=v1",
  `PAYMENT_ENCRYPTION_KEY=${secret()}`,
  "PAYMENT_ENCRYPTION_KEY_VERSION=local-test-v1",
  `PAYMENT_FINGERPRINT_KEY=${secret()}`,
  `BOOTSTRAP_ADMIN_TOKEN=${secret()}`,
  "WEB_APP_URL=http://localhost:5173",
  "ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173",
].join("\n"), { mode: 0o600 });

const server = spawn("npx", ["supabase", "functions", "serve", "--env-file", envPath], { stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32" });
const logParts = [];
server.stdout.on("data", (part) => logParts.push(part));
server.stderr.on("data", (part) => logParts.push(part));
const fixtures = [];
const check = (condition, message) => { if (!condition) throw new Error(message); };
async function eventually(probe, message) {
  const expiresAt = Date.now() + 12000;
  while (Date.now() < expiresAt) {
    if (server.exitCode !== null) throw new Error("Local Edge Functions server exited during startup.");
    try { if (await probe()) return; } catch { /* Edge runtime is starting. */ }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(message);
}
async function authAdmin(method, path, body) {
  return fetch(`${api}/auth/v1/admin/${path}`, {
    method,
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
async function rest(method, path, token, body) {
  return fetch(`${api}/rest/v1/${path}`, {
    method,
    headers: { apikey: publishableKey, Authorization: `Bearer ${token}`, "Content-Type": "application/json", Prefer: "return=representation" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
async function tripApi(action, token, input, requestKey) {
  const headers = { apikey: publishableKey, Authorization: `Bearer ${token}`, Origin: "http://localhost:5173", "Content-Type": "application/json" };
  if (requestKey) headers["Idempotency-Key"] = requestKey;
  return fetch(`${api}/functions/v1/trip-api`, { method: "POST", headers, body: JSON.stringify({ action, input }) });
}
async function createIdentity(role, suffix) {
  const email = `phase2-${role}-${suffix}@example.test`;
  const password = `P2-Test-${randomBytes(15).toString("hex")}!`;
  const response = await authAdmin("POST", "users", { email, password, email_confirm: true });
  check(response.ok, `Local ${role} identity creation failed (${response.status}).`);
  const user = await response.json();
  fixtures.push({ authId: user.id, password });
  const profile = await rest("POST", "member_profiles", serviceKey, [
    { auth_user_id: user.id, display_name: `Phase 2 ${role}`, member_role: role, account_status: "active" },
  ]);
  check(profile.ok, `Local ${role} profile creation failed (${profile.status}).`);
  return { authId: user.id, email, password, memberId: (await profile.json())[0].member_id };
}
async function login(user) {
  const response = await fetch(`${api}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: publishableKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email: user.email, password: user.password }),
  });
  check(response.ok, `Local ${user.email} sign-in failed (${response.status}).`);
  return (await response.json()).access_token;
}
function addDays(date, days) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

try {
  await eventually(async () => {
    const response = await fetch(`${api}/functions/v1/trip-api`, { method: "POST", headers: { apikey: publishableKey, "Content-Type": "application/json" }, body: JSON.stringify({ action: "get_calendar" }) });
    return response.status === 401;
  }, "Trip API did not start.");
  const preflight = await fetch(`${api}/functions/v1/trip-api`, { method: "OPTIONS", headers: { Origin: "http://localhost:5173", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization, apikey, content-type, idempotency-key, x-client-info" } });
  const allowedHeaders = preflight.headers.get("access-control-allow-headers")?.toLowerCase() ?? "";
  check(preflight.ok && allowedHeaders.includes("idempotency-key") && allowedHeaders.includes("x-client-info"), `Trip API CORS preflight failed (status ${preflight.status}, headers ${allowedHeaders}).`);
  const blockedOrigin = await fetch(`${api}/functions/v1/trip-api`, { method: "POST", headers: { Origin: "https://unapproved.example", apikey: publishableKey, "Content-Type": "application/json" }, body: JSON.stringify({ action: "get_calendar" }) });
  check(blockedOrigin.status === 405, "Trip API accepted an unapproved browser origin.");
  const suffix = randomUUID();
  const admin = await createIdentity("admin", suffix);
  const member = await createIdentity("member", suffix);
  const adminToken = await login(admin);
  const memberToken = await login(member);

  const calendarResponse = await tripApi("get_calendar", memberToken);
  check(calendarResponse.ok, `Active member calendar request failed (${calendarResponse.status}).`);
  const initialCalendar = (await calendarResponse.json()).data;
  check(initialCalendar.campsites.length === 7, "Member calendar did not return the seven configured campsites.");
  check(initialCalendar.trips.length === 12, "Member calendar did not return the rolling twelve-month horizon.");
  check(initialCalendar.trips.every((trip) => trip.pollStatus === "draft" && trip.minimumBasis === null), "Calendar silently opened a poll or selected a minimum-count policy.");
  check(initialCalendar.trips.every((trip) => trip.tripDecision === "none"), "Calendar exposed an automatic trip decision.");
  check(!JSON.stringify(initialCalendar).match(/contribution|paymentDue|confirmedAttendees/i), "Interest-poll calendar exposed financial or confirmation state.");
  check(!JSON.stringify(initialCalendar).match(/adminNotes|participantEntries|withdrawalRequests|members"/i), "Member calendar exposed administrator-only details or other members' RSVP identities.");

  const forbiddenAdmin = await tripApi("admin_configure_club", memberToken, { timezone: "America/Los_Angeles" }, randomUUID());
  check(forbiddenAdmin.status === 403, "Non-administrator changed Phase 2 club configuration.");
  const unsupportedConfirmation = await tripApi("admin_confirm_trip", adminToken, {}, randomUUID());
  check(unsupportedConfirmation.status === 400, "Phase 2 exposed a trip confirmation operation.");

  const config = initialCalendar.clubConfiguration;
  const configured = await tripApi("admin_configure_club", adminToken, {
    timezone: "America/Los_Angeles", leadDays: 35, closeTime: "18:00:00",
    defaultMinimumParticipants: 4, nextRotationPosition: config.nextRotationPosition, expectedVersion: config.version,
  }, randomUUID());
  check(configured.ok, `Administrator could not configure club calendar settings (${configured.status}).`);

  const afterConfig = (await (await tripApi("get_calendar", adminToken)).json()).data.clubConfiguration;
  const racingUpdates = await Promise.all([
    tripApi("admin_configure_club", adminToken, {
      timezone: "America/Los_Angeles", leadDays: 35, closeTime: "18:00:00",
      defaultMinimumParticipants: 4, nextRotationPosition: 2, expectedVersion: afterConfig.version,
    }, randomUUID()),
    tripApi("admin_configure_club", adminToken, {
      timezone: "America/Los_Angeles", leadDays: 35, closeTime: "19:00:00",
      defaultMinimumParticipants: 4, nextRotationPosition: 3, expectedVersion: afterConfig.version,
    }, randomUUID()),
  ]);
  check(racingUpdates.filter((response) => response.ok).length === 1 && racingUpdates.filter((response) => response.status === 409).length === 1,
    "Concurrent stale club-configuration writes were not serialized to one winner and one conflict.");

  const siteOrder = [...initialCalendar.campsites].sort((left, right) => left.rotationPosition - right.rotationPosition);
  const reorderedSites = [siteOrder[1].campsiteId, siteOrder[0].campsiteId, ...siteOrder.slice(2).map((site) => site.campsiteId)];
  const reorderResult = await tripApi("admin_reorder_campsites", adminToken, {
    order: reorderedSites, nextRotationPosition: 2, reason: "Synthetic rotation reorder",
  }, randomUUID());
  check(reorderResult.ok, `Administrator could not reorder the campsite rotation (${reorderResult.status}).`);
  const afterReorderSites = (await (await tripApi("get_calendar", adminToken)).json()).data.campsites;
  const siteToUpdate = afterReorderSites.find((site) => site.campsiteId === siteOrder[0].campsiteId);
  const updateSite = await tripApi("admin_update_campsite", adminToken, {
    campsiteId: siteToUpdate.campsiteId, expectedVersion: siteToUpdate.version,
    name: siteToUpdate.name, availabilityUrl: siteToUpdate.availabilityUrl,
    locationDescription: "Synthetic admin-edited location", directions: siteToUpdate.directions,
    cabinCapacity: siteToUpdate.cabinCapacity, cabinTypes: siteToUpdate.cabinTypes,
    reservationInstructions: siteToUpdate.reservationInstructions, estimatedRateCents: siteToUpdate.estimatedRateCents,
    availabilityStatus: siteToUpdate.availabilityStatus, availabilitySourceUrl: siteToUpdate.availabilitySourceUrl,
    availabilityVerifiedAt: null, adminNotes: "Synthetic private administrator note", reason: "Synthetic campsite update",
  }, randomUUID());
  check(updateSite.ok, `Administrator could not update campsite details (${updateSite.status}).`);
  const adminSiteView = (await (await tripApi("get_calendar", adminToken)).json()).data.campsites;
  check(adminSiteView.find((site) => site.campsiteId === siteOrder[1].campsiteId).rotationPosition === 1,
    "Administrator rotation order was not persisted.");
  const editedSite = adminSiteView.find((site) => site.campsiteId === siteToUpdate.campsiteId);
  check(editedSite.locationDescription === "Synthetic admin-edited location" && editedSite.adminNotes === "Synthetic private administrator note",
    "Administrator campsite details or protected notes were not returned after a trusted update.");

  const trip = initialCalendar.trips[1];
  const startsOn = `${trip.monthKey}-20`;
  const deadlineDate = addDays(startsOn, -35);
  const configureTripKey = randomUUID();
  const configuredTrip = await tripApi("admin_configure_trip", adminToken, {
    tripId: trip.tripId, startsOn, endsOn: addDays(startsOn, 2), deadlineDate, deadlineTime: "18:00:00",
    minimumParticipants: 4, maxCapacity: 8, selectedCampsiteId: trip.suggestedCampsiteId,
    availabilityStatus: "unknown", additionalInformation: "Synthetic test poll", expectedVersion: trip.version,
    reason: "Local integration fixture",
  }, configureTripKey);
  check(configuredTrip.ok, `Administrator could not configure the interest poll (${configuredTrip.status}).`);
  const openPoll = await tripApi("admin_set_poll_status", adminToken, { tripId: trip.tripId, pollStatus: "open", expectedVersion: 2, reason: "Local test open" }, randomUUID());
  check(openPoll.ok, `Administrator could not open the interest poll (${openPoll.status}).`);

  const refreshed = (await (await tripApi("get_calendar", memberToken)).json()).data;
  const openTrip = refreshed.trips.find((row) => row.tripId === trip.tripId);
  check(openTrip?.pollStatus === "open" && openTrip.currentRuleBundle?.contentHash, "Open poll did not expose its current immutable rule bundle.");
  const constitutionResponse = await tripApi("get_constitution", memberToken, { tripId: trip.tripId });
  check(constitutionResponse.ok && (await constitutionResponse.json()).data.currentBundle?.id === openTrip.currentRuleBundle.id,
    "Open-poll Constitution read did not return the refreshed current bundle.");
  const lateNotComing = await tripApi("admin_record_interest", adminToken, {
    tripId: trip.tripId, memberId: member.memberId, response: "not_coming", expectedVersion: 0, reason: "Synthetic late interest response",
  }, randomUUID());
  check(lateNotComing.ok, `Administrator could not record a late Not Coming response (${lateNotComing.status}).`);
  const adminComingWithoutAck = await tripApi("admin_record_interest", adminToken, {
    tripId: trip.tripId, memberId: member.memberId, response: "coming", expectedVersion: 1, reason: "Synthetic late Coming response without member acknowledgment",
  }, randomUUID());
  check(adminComingWithoutAck.status === 400, "Administrator recorded Coming without the member's own current rule acknowledgment.");
  const comingWithoutAck = await tripApi("submit_rsvp", memberToken, { tripId: trip.tripId, response: "coming", expectedVersion: 1 }, randomUUID());
  check(comingWithoutAck.status === 400, "Coming RSVP was accepted without acknowledging the exact rule bundle.");

  const adminNotComing = await tripApi("submit_rsvp", adminToken, { tripId: trip.tripId, response: "not_coming", expectedVersion: 0 }, randomUUID());
  check(adminNotComing.ok, "Not Coming response incorrectly required a rule acknowledgment.");

  const comingKey = randomUUID();
  const comingInput = { tripId: trip.tripId, response: "coming", bundleId: openTrip.currentRuleBundle.id, contentHash: openTrip.currentRuleBundle.contentHash, expectedVersion: 1 };
  const concurrentComing = await Promise.all([
    tripApi("submit_rsvp", memberToken, comingInput, comingKey),
    tripApi("submit_rsvp", memberToken, comingInput, comingKey),
  ]);
  check(concurrentComing.some((response) => response.ok) && concurrentComing.every((response) => response.ok || response.status === 409),
    "Concurrent duplicate RSVP request did not produce one durable result and a replay/in-progress response.");
  const concurrentBodies = await Promise.all(concurrentComing.map((response) => response.json()));
  const originalComing = concurrentBodies.find((body) => body.data?.acknowledgmentId);
  check(originalComing, "Concurrent Coming RSVP did not return the original acknowledgment result.");
  const comingResult = originalComing.data;
  check(Boolean(comingResult.acknowledgmentId), "Coming RSVP did not preserve its exact rule acknowledgment.");
  const replay = await tripApi("submit_rsvp", memberToken, comingInput, comingKey);
  check(replay.ok && (await replay.json()).data.replayed === true, "Idempotent Coming RSVP retry did not replay.");
  const conflict = await tripApi("submit_rsvp", memberToken, { ...comingInput, response: "not_coming" }, comingKey);
  check(conflict.status === 409, "Reusing an RSVP idempotency key with changed input was not rejected.");

  const directRsvps = await rest("GET", `trip_rsvps?select=trip_id,member_id,response`, memberToken);
  check(directRsvps.ok, "Active member could not read the RSVP projection through its permitted Data API path.");
  const visibleRsvps = await directRsvps.json();
  check(visibleRsvps.length === 1 && visibleRsvps[0].member_id === member.memberId, "Member could enumerate another participant's RSVP row.");
  const visibleAcknowledgments = await rest("GET", "trip_rule_acknowledgments?select=id,member_id,bundle_id", memberToken);
  check(visibleAcknowledgments.ok, "Member could not read their own rule acknowledgments.");
  const acknowledgmentRows = await visibleAcknowledgments.json();
  check(acknowledgmentRows.length === 1 && acknowledgmentRows[0].member_id === member.memberId, "Member could enumerate another participant's rule acknowledgment.");

  const oldBundle = openTrip.currentRuleBundle;
  const published = await tripApi("admin_publish_rule", adminToken, {
    scope: "general", stableKey: "trip-conduct", category: "conduct",
    text: "Treat the campsite and other members respectfully.", structuredValues: { appliesTo: "all_trips" },
    effectiveFrom: new Date().toISOString(), expiresAt: null, reason: "Synthetic rule history test",
  }, randomUUID());
  const publishedPayload = await published.clone().json();
  check(published.ok, `Administrator could not publish a general rule version (${published.status}, ${publishedPayload?.error?.code ?? "unknown"}).`);
  const afterEdit = (await (await tripApi("get_calendar", memberToken)).json()).data.trips.find((row) => row.tripId === trip.tripId);
  check(afterEdit.currentRuleBundle.id !== oldBundle.id, "Rule publication did not create a new immutable bundle version.");
  check(afterEdit.myRsvp.acknowledgmentId === comingResult.acknowledgmentId, "Rule publication rewrote a prior signup acknowledgment.");

  const tripRuleNoExpiry = await tripApi("admin_publish_rule", adminToken, {
    scope: "trip", tripId: trip.tripId, stableKey: "quiet-hours", category: "conduct",
    text: "Quiet hours begin at the posted campsite time.", structuredValues: {},
    effectiveFrom: new Date().toISOString(), expiresAt: null, reason: "Must have expiry",
  }, randomUUID());
  check(tripRuleNoExpiry.status === 400, "Trip-specific rule was accepted without its required expiry.");
  const tripRule = await tripApi("admin_publish_rule", adminToken, {
    scope: "trip", tripId: trip.tripId, stableKey: "quiet-hours", category: "conduct",
    text: "Quiet hours begin at the posted campsite time.", structuredValues: { type: "quiet_hours" },
    effectiveFrom: new Date().toISOString(), expiresAt: (() => { const [year, month] = trip.monthKey.split("-").map(Number); return new Date(Date.UTC(year, month - 1, 28, 23, 59)).toISOString(); })(), reason: "Synthetic expiring trip rule",
  }, randomUUID());
  check(tripRule.ok, `Administrator could not publish an expiring trip-specific rule (${tripRule.status}).`);

  const closePoll = await tripApi("admin_set_poll_status", adminToken, { tripId: trip.tripId, pollStatus: "closed", expectedVersion: 3, reason: "Local test close" }, randomUUID());
  check(closePoll.ok, `Administrator could not close the poll without deciding trip status (${closePoll.status}).`);
  const withdrawal = await tripApi("request_withdrawal", memberToken, { tripId: trip.tripId, reason: "Synthetic post-close withdrawal" }, randomUUID());
  check(withdrawal.ok && (await withdrawal.json()).data.state === "pending_owner_policy", "Closed-poll withdrawal did not remain pending under the unapproved policy.");
  const afterWithdrawal = (await (await tripApi("get_calendar", memberToken)).json()).data.trips.find((row) => row.tripId === trip.tripId);
  check(afterWithdrawal.myRsvp.response === "coming", "Unapproved post-close withdrawal policy changed effective attendance.");
  const adminCalendarResponse = await tripApi("get_calendar", adminToken);
  const adminCalendarEnvelope = await adminCalendarResponse.json();
  check(adminCalendarResponse.ok && adminCalendarEnvelope.data?.members?.some((row) => row.memberId === member.memberId), `Administrator cannot select an active member for a late poll entry (${adminCalendarResponse.status}, ${adminCalendarEnvelope.error?.code ?? "missing members"}).`);
  check(adminCalendarEnvelope.data.withdrawalRequests?.some((row) => row.tripId === trip.tripId && row.memberId === member.memberId), "Administrator cannot review a pending post-close withdrawal request.");

  const memberOnlyCampsites = await rest("POST", "campsites", memberToken, [{ name: "Injected", location_description: "", rotation_position: 99 }]);
  check(memberOnlyCampsites.status === 401 || memberOnlyCampsites.status === 403, "Member directly wrote the campsite catalog.");
  const memberSiteNotes = await rest("GET", "campsite_admin_notes?select=campsite_id,admin_notes", memberToken);
  check(memberSiteNotes.status !== 200, "Private administrator campsite notes are available through the public Data API.");
  const memberRuleBundles = await rest("GET", "trip_rule_bundles?select=id,rendered_bundle", memberToken);
  check(memberRuleBundles.status === 401 || memberRuleBundles.status === 403, "Member directly queried potentially stale rule bundle snapshots through the Data API.");
  const memberOnlyAckUpdate = await rest("PATCH", `trip_rule_acknowledgments?id=eq.${comingResult.acknowledgmentId}`, memberToken, { content_hash: "0".repeat(64) });
  check(memberOnlyAckUpdate.status === 401 || memberOnlyAckUpdate.status === 403, "Member directly changed immutable rule acknowledgment history.");

  console.log("Phase 2 local integration/security checks passed (rolling calendar, concurrent version/idempotency protection, admin gates, poll/RSVP, time-effective rule bundles, acknowledgments, RLS, pending withdrawal policy).");
} catch (error) {
  console.error(error);
  const safeLogTail = Buffer.concat(logParts).toString("utf8").slice(-4000).replaceAll(serviceKey, "[service key redacted]");
  if (safeLogTail) console.error(`Local function server log tail:\n${safeLogTail}`);
  process.exitCode = 1;
} finally {
  for (const fixture of fixtures) {
    const list = await authAdmin("GET", `users/${fixture.authId}`).catch(() => null);
    const userProfile = list?.ok ? await list.json() : null;
    if (userProfile?.id) {
      await fetch(`${api}/rest/v1/member_profiles?auth_user_id=eq.${fixture.authId}`, { method: "DELETE", headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }).catch(() => {});
    }
    await authAdmin("DELETE", `users/${fixture.authId}`).catch(() => {});
  }
  await terminateProcessTree(server);
  const cleanupReset = spawnSync("npx", ["supabase", "db", "reset", "--local"], { encoding: "utf8", stdio: "ignore" });
  if (cleanupReset.status !== 0 && process.exitCode === undefined) {
    console.error("Local synthetic fixtures could not be cleared after the integration run.");
    process.exitCode = 1;
  }
  await rm(temporaryDirectory, { recursive: true, force: true });
}
