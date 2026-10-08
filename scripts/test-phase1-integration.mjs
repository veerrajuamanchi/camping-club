import { execFileSync, spawn, spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { terminateProcessTree } from "./terminate-process.mjs";

const resetRun = spawnSync("npx", ["supabase", "db", "reset", "--local"], { encoding: "utf8" });
if (resetRun.status !== 0) throw new Error("Start the local Supabase stack first; integration tests reset its local database.");
const statusRun = spawnSync("npx", ["supabase", "status", "-o", "json"], { encoding: "utf8" });
if (statusRun.status !== 0) throw new Error("Start the local Supabase stack first: npx supabase start");
const jsonAt = statusRun.stdout.indexOf("{");
const status = JSON.parse(statusRun.stdout.slice(jsonAt));
const api = status.API_URL;
const serviceKey = status.SERVICE_ROLE_KEY;
const publicKey = status.PUBLISHABLE_KEY;
const tempDir = await mkdtemp(join(tmpdir(), "camping-club-phase1-"));
const envPath = join(tempDir, "functions.env");
const envValue = (length = 32) => randomBytes(length).toString("base64");
const bootstrapToken = envValue();
await writeFile(envPath, [
  `SUPABASE_URL=${api}`,
  `SUPABASE_SECRET_KEYS={"default":"${serviceKey}"}`,
  `INVITATION_HMAC_KEY=${envValue()}`,
  `IDEMPOTENCY_HMAC_KEY=${envValue()}`,
  "IDEMPOTENCY_HMAC_KEY_VERSION=v1",
  `PAYMENT_ENCRYPTION_KEY=${envValue()}`,
  "PAYMENT_ENCRYPTION_KEY_VERSION=local-test-v1",
  `PAYMENT_FINGERPRINT_KEY=${envValue()}`,
  `BOOTSTRAP_ADMIN_TOKEN=${bootstrapToken}`,
  "WEB_APP_URL=http://localhost:5173",
  "ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173",
].join("\n"), { mode: 0o600 });

const server = spawn("npx", ["supabase", "functions", "serve", "--env-file", envPath], { stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32" });
const serverLogChunks = [];
server.stdout.on("data", (chunk) => serverLogChunks.push(chunk));
server.stderr.on("data", (chunk) => serverLogChunks.push(chunk));
const check = (condition, message) => { if (!condition) throw new Error(message); };
async function eventually(checkFn, message, timeoutMs = 45_000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (server.exitCode !== null) throw new Error("Supabase Functions server exited before becoming ready.");
    try { if (await checkFn()) return; } catch { /* startup retry */ }
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
    headers: { apikey: publicKey, Authorization: `Bearer ${token}`, "Content-Type": "application/json", Prefer: "return=representation" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
async function edge(action, token, input, idempotencyKey, origin = "http://localhost:5173") {
  const headers = { apikey: publicKey, Authorization: `Bearer ${token}`, Origin: origin, "Content-Type": "application/json" };
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  return fetch(`${api}/functions/v1/member-api`, {
    method: "POST",
    headers,
    body: JSON.stringify({ action, input }),
  });
}
async function createUser(email) {
  const password = `T3st-${randomBytes(15).toString("hex")}!`;
  const response = await authAdmin("POST", "users", { email, password, email_confirm: true });
  check(response.ok, `Local Auth test fixture creation failed (${response.status}).`);
  const user = await response.json();
  return { id: user.id, email, password };
}
async function login(user) {
  const response = await fetch(`${api}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: publicKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email: user.email, password: user.password }),
  });
  if (!response.ok) throw new Error(`Local Auth login failed (${response.status}; ${await response.text()}).`);
  return (await response.json()).access_token;
}

const suffix = randomUUID();
const fixtures = [];
let profiles = [];
let inviteUserId = null;
let bootstrapProfileId = null;
try {
  await eventually(async () => {
    const response = await fetch(`${api}/functions/v1/member-api`, { method: "POST", headers: { apikey: publicKey, "Content-Type": "application/json" }, body: JSON.stringify({ action: "me" }) });
    return response.status === 401;
  }, "Edge Functions did not become ready.");

  const memberPreflight = await fetch(`${api}/functions/v1/member-api`, {
    method: "OPTIONS",
    headers: {
      Origin: "http://localhost:5173",
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "authorization, apikey, content-type, x-client-info",
    },
  });
  const memberAllowedHeaders = memberPreflight.headers.get("access-control-allow-headers")?.toLowerCase() ?? "";
  check(memberPreflight.ok && memberAllowedHeaders.includes("x-client-info"),
    `Member API CORS preflight did not allow x-client-info (status ${memberPreflight.status}, headers ${memberAllowedHeaders}).`);

  const deniedBootstrap = await fetch(`${api}/functions/v1/bootstrap-admin`, { method: "POST", headers: { apikey: publicKey, "Content-Type": "application/json", "x-bootstrap-token": "wrong" }, body: JSON.stringify({ email: `no-bootstrap-${suffix}@example.test` }) });
  check(deniedBootstrap.status === 401, `Bootstrap endpoint did not reject the invalid token as expected (${deniedBootstrap.status}; ${await deniedBootstrap.text()}).`);
  const publicSignup = await fetch(`${api}/auth/v1/signup`, { method: "POST", headers: { apikey: publicKey, "Content-Type": "application/json" }, body: JSON.stringify({ email: `public-signup-${suffix}@example.test`, password: `T3st-${randomBytes(15).toString("hex")}!` }) });
  check(!publicSignup.ok, "Supabase Auth allowed public email registration.");

  const admin = { email: `phase1-admin-${suffix}@example.test`, password: `Admin-${randomBytes(15).toString("hex")}!` };
  const bootstrapResponse = await fetch(`${api}/functions/v1/bootstrap-admin`, { method: "POST", headers: { apikey: publicKey, "Content-Type": "application/json", "x-bootstrap-token": bootstrapToken }, body: JSON.stringify({ email: admin.email }) });
  check(bootstrapResponse.status === 200, `One-time bootstrap invitation failed (${bootstrapResponse.status}; ${await bootstrapResponse.text()}).`);
  const authUsersResponse = await authAdmin("GET", "users?page=1&per_page=1000");
  check(authUsersResponse.ok, "Unable to inspect the local bootstrap invitation fixture.");
  const authUsers = await authUsersResponse.json();
  const bootstrapUser = (authUsers.users ?? []).find((user) => user.email === admin.email);
  check(Boolean(bootstrapUser), "Supabase Auth did not create the bootstrap administrator invitation.");
  admin.id = bootstrapUser.id;
  fixtures.push(admin);
  const bootstrapAuth = await authAdmin("PUT", `users/${admin.id}`, { password: admin.password, email_confirm: true });
  check(bootstrapAuth.ok, "Could not prepare the local bootstrap administrator session.");
  const bootstrapTokenForMemberApi = await login(admin);
  const bootstrapInput = { displayName: "Local Bootstrap Admin", phoneE164: "+14155550125", paymentMethod: "zelle", paymentIdentifier: `bootstrap-${suffix}@example.test` };
  const bootstrapComplete = await edge("complete_profile", bootstrapTokenForMemberApi, bootstrapInput, randomUUID());
  check(bootstrapComplete.status === 200, `Bootstrap admin profile completion failed (${bootstrapComplete.status}).`);
  bootstrapProfileId = (await bootstrapComplete.json()).data.memberId;
  const bootstrapMe = await edge("me", bootstrapTokenForMemberApi);
  check(bootstrapMe.status === 200 && (await bootstrapMe.json()).data.member.role === "admin", "Bootstrap invitation did not grant the initial administrator role.");

  const member = await createUser(`phase1-member-${suffix}@example.test`); fixtures.push(member);
  const seed = await rest("POST", "member_profiles", serviceKey, [
    { auth_user_id: member.id, display_name: "Local Test Member", member_role: "member", account_status: "active" },
  ]);
  check(seed.ok, `Local membership fixture creation failed (${seed.status}).`);
  profiles = await seed.json();

  const adminToken = bootstrapTokenForMemberApi;
  const memberToken = await login(member);
  const own = await edge("me", memberToken);
  check(own.status === 200 && (await own.json()).data.member.displayName === "Local Test Member", "Member API did not return the authenticated member's profile.");
  const memberList = await edge("list_members", memberToken);
  check(memberList.status === 403, "Non-administrator accessed the admin member list.");

  const noAuth = await fetch(`${api}/functions/v1/member-api`, { method: "POST", headers: { apikey: publicKey, "Content-Type": "application/json" }, body: JSON.stringify({ action: "me" }) });
  check(noAuth.status === 401, "Member API accepted a missing JWT.");
  const badOrigin = await edge("me", memberToken, undefined, undefined, "https://unapproved.example");
  check(badOrigin.status === 405, "Member API accepted an unapproved origin.");

  const otherProfile = await rest("GET", `member_profiles?auth_user_id=eq.${admin.id}&select=*`, memberToken);
  check(otherProfile.ok && (await otherProfile.json()).length === 0, "Member read another member's profile through the Data API.");
  const privilegeEscalation = await rest("PATCH", `member_profiles?auth_user_id=eq.${member.id}`, memberToken, { member_role: "admin" });
  check(!privilegeEscalation.ok, "Member changed their role directly through the Data API.");
  const privateIdentifier = await rest("GET", "member_payment_identifiers?select=*", memberToken);
  check(privateIdentifier.status >= 400, "Payment identifiers are reachable through the Data API.");

  const updateInput = { displayName: "Updated Test Member", phoneE164: "+14155550123", paymentMethod: "venmo", paymentIdentifier: `@private-${suffix}` };
  const updateKey = randomUUID();
  const update = await edge("update_profile", memberToken, updateInput, updateKey);
  check(update.status === 200, `Member profile update failed (${update.status}).`);
  const updateResult = await update.json();
  check(!JSON.stringify(updateResult).includes(updateInput.paymentIdentifier), "Profile API response revealed the payment identifier.");
  const storedIdentifier = execFileSync("psql", [status.DB_URL, "-X", "-A", "-t", "-c", `select encode(i.identifier_ciphertext,'hex') || ':' || encode(i.nonce,'hex') || ':' || i.encryption_key_version from private.member_payment_identifiers i join public.member_payment_methods m on m.id=i.payment_method_id where m.member_id='${profiles[0].member_id}'`], { encoding: "utf8" }).trim();
  const [ciphertextHex, nonceHex, encryptionVersion] = storedIdentifier.split(":");
  check(ciphertextHex?.length >= 34 && !ciphertextHex.includes(Buffer.from(updateInput.paymentIdentifier).toString("hex")) && nonceHex?.length === 24 && encryptionVersion === "local-test-v1", "Payment identifier was not stored as authenticated ciphertext with a fresh nonce and key version.");
  const replay = await edge("update_profile", memberToken, updateInput, updateKey);
  check(replay.status === 200 && (await replay.json()).data.replayed === true, "Same-key retry did not replay its completed result.");
  const conflict = await edge("update_profile", memberToken, { ...updateInput, displayName: "Changed body" }, updateKey);
  check(conflict.status === 409, "Same idempotency key with a changed body was not rejected.");
  const visibleMethods = await rest("GET", `member_payment_methods?member_id=eq.${profiles[0].member_id}&select=*`, memberToken);
  check(visibleMethods.ok, "Member could not read own safe payment method metadata.");
  const visibleJson = await visibleMethods.json();
  check(visibleJson.length === 1 && !("identifier" in visibleJson[0]) && !("ciphertext" in visibleJson[0]), "Safe payment method endpoint exposed identifier material.");

  const inviteEmail = `phase1-invite-${suffix}@example.test`;
  const inviteKey = randomUUID();
  const invite = await edge("invite_member", adminToken, { email: inviteEmail }, inviteKey);
  check(invite.status === 200, `Administrator invite operation failed (${invite.status}).`);
  const inviteReplay = await edge("invite_member", adminToken, { email: inviteEmail }, inviteKey);
  check(inviteReplay.status === 200 && (await inviteReplay.json()).data.replayed === true, "Invitation replay did not return the original invite result.");
  const listed = await edge("list_members", adminToken);
  check(listed.status === 200, "Administrator could not list safe membership data.");
  check(!JSON.stringify((await listed.json()).data).includes(inviteEmail), "Admin member list exposed email addresses.");

  const invitedResponse = await authAdmin("GET", "users?page=1&per_page=1000");
  check(invitedResponse.ok, "Unable to inspect the local Auth invitation fixture.");
  const invitedData = await invitedResponse.json();
  const invitedUser = (invitedData.users ?? []).find((user) => user.email === inviteEmail);
  check(Boolean(invitedUser), "Supabase Auth did not create the invitation user.");
  inviteUserId = invitedUser.id;
  const knownInvitePassword = `Invite-${randomBytes(15).toString("hex")}!`;
  const setPassword = await authAdmin("PUT", `users/${inviteUserId}`, { password: knownInvitePassword, email_confirm: true });
  check(setPassword.ok, "Could not prepare the invited-user local sign-in.");
  const invitedToken = await login({ email: inviteEmail, password: knownInvitePassword });
  const inviteProfileInput = { displayName: "Invited Local Member", phoneE164: "+14155550124", paymentMethod: "paypal", paymentIdentifier: `invite-${suffix}@example.test` };
  const acceptKey = randomUUID();
  const accept = await edge("complete_profile", invitedToken, inviteProfileInput, acceptKey);
  check(accept.status === 200, `Verified invitation did not complete profile (${accept.status}).`);
  const acceptReplay = await edge("complete_profile", invitedToken, inviteProfileInput, acceptKey);
  check(acceptReplay.status === 200 && (await acceptReplay.json()).data.replayed === true, "Profile completion retry did not replay safely.");

  const removeLastAdmin = await edge("update_membership", adminToken, { memberId: bootstrapProfileId, memberRole: "member", accountStatus: "active", reason: "Should be blocked: last administrator" }, randomUUID());
  check(removeLastAdmin.status === 400, "System allowed removal of its last active administrator.");
  const adminStillActive = await edge("me", adminToken);
  check(adminStillActive.status === 200 && (await adminStillActive.json()).data.member.role === "admin", "Rejected last-admin change altered administrator authority.");

  const suspendKey = randomUUID();
  const suspend = await edge("update_membership", adminToken, { memberId: profiles[0].member_id, memberRole: "member", accountStatus: "suspended", reason: "Phase 1 integration test" }, suspendKey);
  check(suspend.status === 200, "Administrator membership update failed.");
  const auditRows = await rest("GET", `audit_events?actor_id=eq.${bootstrapProfileId}&entity_id=eq.${profiles[0].member_id}&action=eq.membership_changed&select=action,reason`, serviceKey);
  check(auditRows.ok && (await auditRows.json()).length === 1, "Administrator membership update did not create an audit event.");
  const inactiveMe = await edge("me", memberToken);
  check(inactiveMe.status === 403, "A suspended member retained trusted member API access.");

  console.log("Phase 1 local integration/security checks passed (invitation, verified profile completion, RLS, role denial, encrypted identifier boundary, idempotency, admin actions, CORS/JWT).");
} catch (error) {
  console.error(error);
  const logs = Buffer.concat(serverLogChunks).toString("utf8").slice(-6000);
  if (logs) console.error("Local function server log tail:\n" + logs);
  process.exitCode = 1;
} finally {
  for (const row of profiles) {
    await rest("DELETE", `member_profiles?member_id=eq.${row.member_id}`, serviceKey).catch(() => {});
  }
  if (bootstrapProfileId) await rest("DELETE", `member_profiles?member_id=eq.${bootstrapProfileId}`, serviceKey).catch(() => {});
  if (inviteUserId) await rest("DELETE", `member_profiles?auth_user_id=eq.${inviteUserId}`, serviceKey).catch(() => {});
  for (const fixture of fixtures) {
    await authAdmin("DELETE", `users/${fixture.id}`).catch(() => {});
  }
  if (inviteUserId) await authAdmin("DELETE", `users/${inviteUserId}`).catch(() => {});
  await terminateProcessTree(server);
  await rm(tempDir, { recursive: true, force: true });
}
