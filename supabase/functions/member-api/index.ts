import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { resolveServiceApiKey } from "../_shared/service-key.mjs";
import { canonicalJson, emailDigest, keyedDigest, protectPaymentIdentifier, requestDigest, requiredEnv } from "../_shared/crypto.ts";
import { corsHeaders, emailSchema, isOriginAllowed, json, profileSchema, readBody } from "../_shared/http.ts";

const service = createClient(requiredEnv("SUPABASE_URL"), resolveServiceApiKey(Deno.env.get("SUPABASE_SECRET_KEYS")), { auth: { persistSession: false, autoRefreshToken: false } });
const inviteSchema = z.object({ email: emailSchema });
const membershipSchema = z.object({ memberId: z.string().uuid(), memberRole: z.enum(["member", "admin"]), accountStatus: z.enum(["active", "inactive", "suspended"]), reason: z.string().trim().min(1).max(500) });
const accessRequestActionSchema = z.object({
  requestId: z.string().uuid(),
  adminNote: z.string().max(500).optional(),
});
const requestSchema = z.object({
  action: z.enum(["me", "complete_profile", "update_profile", "invite_member", "list_members", "update_membership", "list_access_requests", "approve_access_request", "reject_access_request"]),
  input: z.unknown().optional(),
});

type Member = { member_id: string; auth_user_id: string; display_name: string; member_role: "member" | "admin"; account_status: "active" | "inactive" | "suspended" };
type IdempotencyClaim = { state: "started" | "in_progress" | "replay"; resultId?: string; resultCode?: string };

async function claim(principal: string, action: string, key: string, input: unknown): Promise<IdempotencyClaim> {
  const canonical = canonicalJson({ action, input });
  const { data, error } = await service.rpc("phase1_begin_idempotency", {
    p_principal: principal,
    p_operation: action,
    p_aggregate: key,
    p_key_hmac: await keyedDigest("IDEMPOTENCY_HMAC_KEY", key),
    p_hmac_key_version: requiredEnv("IDEMPOTENCY_HMAC_KEY_VERSION"),
    p_request_hash: await requestDigest(canonical),
  });
  if (error) throw new Error(error.code === "22023" ? "idempotency conflict or replay expired" : "idempotency unavailable");
  return data as IdempotencyClaim;
}

async function finish(principal: string, action: string, key: string, input: unknown, resultId: string | null, code: string): Promise<void> {
  const { error } = await service.rpc("phase1_finish_idempotency", {
    p_principal: principal,
    p_operation: action,
    p_aggregate: key,
    p_key_hmac: await keyedDigest("IDEMPOTENCY_HMAC_KEY", key),
    p_hmac_key_version: requiredEnv("IDEMPOTENCY_HMAC_KEY_VERSION"),
    p_request_hash: await requestDigest(canonicalJson({ action, input })),
    p_result_id: resultId,
    p_result_code: code,
  });
  if (error) throw new Error("idempotency completion failed");
}

function replayResponse(request: Request, action: string, resultId: string | undefined, resultCode: string | undefined, requestId: string): Response {
  if (resultCode === "profile_already_completed") return json(request, 409, { error: resultCode, replayed: true, requestId });
  if (resultCode === "active_membership_required" || resultCode === "administrator_required") return json(request, 403, { error: resultCode, replayed: true, requestId });
  if (!resultId) return json(request, 500, { error: "invalid_replay_record", requestId });
  if (action === "complete_profile") return json(request, 200, { memberId: resultId, replayed: true, requestId });
  if (action === "update_profile") return json(request, 200, { paymentMethodId: resultId, replayed: true, requestId });
  if (action === "invite_member") return json(request, 200, { invitationId: resultId, replayed: true, requestId });
  return json(request, 200, { updated: true, replayed: true, requestId });
}

Deno.serve(async (request) => {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(request.headers.get("origin")) });
  if (request.method !== "POST" || !isOriginAllowed(request)) return json(request, 405, { error: "request_not_allowed", requestId });
  const authorization = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  if (!match) return json(request, 401, { error: "unauthorized", requestId });

  const { data: authData, error: authError } = await service.auth.getUser(match[1]);
  const authUser = authData.user;
  if (authError || !authUser?.email || !authUser.email_confirmed_at) return json(request, 401, { error: "verified_member_session_required", requestId });
  const { data: member, error: memberError } = await service.from("member_profiles")
    .select("member_id,auth_user_id,display_name,member_role,account_status")
    .eq("auth_user_id", authUser.id).maybeSingle<Member>();
  if (memberError) return json(request, 500, { error: "membership_lookup_failed", requestId });

  let body: z.infer<typeof requestSchema>;
  try { body = await readBody(request, requestSchema); }
  catch { return json(request, 400, { error: "invalid_request", requestId }); }
  const action = body.action;
  if (action === "me") {
    if (!member) return json(request, 403, { error: "invitation_profile_required", requestId });
    if (member.account_status !== "active") return json(request, 403, { error: "membership_inactive", requestId });
    const [{ data: contact }, { data: method }] = await Promise.all([
      service.from("member_private_contacts").select("phone_e164").eq("member_id", member.member_id).maybeSingle(),
      service.from("member_payment_methods").select("method").eq("member_id", member.member_id).eq("preferred", true).eq("active", true).maybeSingle(),
    ]);
    return json(request, 200, { member: { memberId: member.member_id, displayName: member.display_name, role: member.member_role, phoneE164: contact?.phone_e164 ?? "", paymentMethod: method?.method ?? null }, requestId });
  }
  if (action === "list_members") {
    if (!member || member.member_role !== "admin" || member.account_status !== "active") return json(request, 403, { error: "administrator_required", requestId });
    const { data, error } = await service.from("member_profiles").select("member_id,display_name,member_role,account_status,created_at").order("display_name");
    if (error) return json(request, 500, { error: "member_list_failed", requestId });
    return json(request, 200, { members: data, requestId });
  }
  if (action === "list_access_requests") {
    if (!member || member.member_role !== "admin" || member.account_status !== "active")
      return json(request, 403, { error: "administrator_required", requestId });
    const { data, error } = await service.rpc("member_api_list_pending_requests");
    if (error) return json(request, 500, { error: "request_list_failed", requestId });
    return json(request, 200, { requests: data, requestId });
  }
  if (action === "approve_access_request" || action === "reject_access_request") {
    if (!member || member.member_role !== "admin" || member.account_status !== "active")
      return json(request, 403, { error: "administrator_required", requestId });
    let parsedAccessInput: z.infer<typeof accessRequestActionSchema>;
    try { parsedAccessInput = accessRequestActionSchema.parse(body.input); }
    catch { return json(request, 400, { error: "invalid_request", requestId }); }
    const newStatus = action === "approve_access_request" ? "approved" : "rejected";
    const { error } = await service.rpc("member_api_resolve_access_request", {
      p_request_id: parsedAccessInput.requestId,
      p_actor_id: member.member_id,
      p_status: newStatus,
      p_admin_note: parsedAccessInput.adminNote ?? null,
    });
    if (error?.code === "42501") return json(request, 403, { error: "administrator_required", requestId });
    if (error?.message?.includes("request_already_resolved")) return json(request, 409, { error: "request_already_resolved", requestId });
    if (error?.message?.includes("request_not_found")) return json(request, 404, { error: "request_not_found", requestId });
    if (error) return json(request, 500, { error: "request_failed", requestId });
    return json(request, 200, { resolved: true, requestId });
  }

  let parsedInput: unknown;
  try {
    if (action === "complete_profile" || action === "update_profile") parsedInput = profileSchema.parse(body.input);
    else if (action === "invite_member") parsedInput = inviteSchema.parse(body.input);
    else if (action === "update_membership") parsedInput = membershipSchema.parse(body.input);
  } catch { return json(request, 400, { error: "invalid_request", requestId }); }

  const keyResult = z.string().uuid().safeParse(request.headers.get("Idempotency-Key"));
  if (!keyResult.success) return json(request, 400, { error: "idempotency_key_required", requestId });
  const idempotencyKey = keyResult.data;
  let idempotency: IdempotencyClaim;
  try { idempotency = await claim(authUser.id, action, idempotencyKey, parsedInput); }
  catch { return json(request, 409, { error: "idempotency_conflict_or_expired", requestId }); }
  if (idempotency.state === "replay") return replayResponse(request, action, idempotency.resultId, idempotency.resultCode, requestId);
  if (idempotency.state === "in_progress") return json(request, 409, { error: "request_in_progress_retry_same_key", requestId });

  if (action === "complete_profile" && member) {
    await finish(authUser.id, action, idempotencyKey, parsedInput, member.member_id, "profile_already_completed");
    return json(request, 409, { error: "profile_already_completed", requestId });
  }
  if (action !== "complete_profile" && (!member || member.account_status !== "active")) {
    await finish(authUser.id, action, idempotencyKey, parsedInput, null, "active_membership_required");
    return json(request, 403, { error: "active_membership_required", requestId });
  }
  if ((action === "invite_member" || action === "update_membership") && member?.member_role !== "admin") {
    await finish(authUser.id, action, idempotencyKey, parsedInput, null, "administrator_required");
    return json(request, 403, { error: "administrator_required", requestId });
  }

  try {
    if (action === "complete_profile") {
      const input = parsedInput as z.infer<typeof profileSchema>;
      const protectedValue = await protectPaymentIdentifier(input.paymentIdentifier);
      const { data, error } = await service.rpc("phase1_complete_invited_profile", {
        p_auth_user_id: authUser.id, p_email_hmac: await emailDigest(authUser.email!), p_display_name: input.displayName,
        p_phone_e164: input.phoneE164, p_method: input.paymentMethod, p_ciphertext: protectedValue.ciphertext,
        p_nonce: protectedValue.nonce, p_key_version: protectedValue.keyVersion, p_fingerprint: protectedValue.fingerprint, p_request_id: idempotencyKey,
      });
      if (error) return json(request, error.code === "42501" ? 403 : 400, { error: "profile_completion_failed", requestId });
      await finish(authUser.id, action, idempotencyKey, parsedInput, data, "profile_completed");
      return json(request, 200, { memberId: data, requestId });
    }
    if (action === "update_profile") {
      const input = parsedInput as z.infer<typeof profileSchema>;
      const protectedValue = await protectPaymentIdentifier(input.paymentIdentifier);
      const { data, error } = await service.rpc("phase1_update_own_profile", {
        p_auth_user_id: authUser.id, p_display_name: input.displayName, p_phone_e164: input.phoneE164,
        p_method: input.paymentMethod, p_ciphertext: protectedValue.ciphertext, p_nonce: protectedValue.nonce,
        p_key_version: protectedValue.keyVersion, p_fingerprint: protectedValue.fingerprint, p_request_id: idempotencyKey,
      });
      if (error) return json(request, 400, { error: "profile_update_failed", requestId });
      await finish(authUser.id, action, idempotencyKey, parsedInput, data, "profile_updated");
      return json(request, 200, { paymentMethodId: data, requestId });
    }
    if (action === "invite_member") {
      const input = parsedInput as z.infer<typeof inviteSchema>;
      const redirectTo = `${requiredEnv("WEB_APP_URL").replace(/\/$/, "")}/accept-invitation`;
      const { data: invitation, error: authInviteError } = await service.auth.admin.inviteUserByEmail(input.email, { redirectTo });
      if (authInviteError || !invitation.user) return json(request, 400, { error: "invitation_failed", requestId });
      const { data: invitationId, error } = await service.rpc("phase1_create_invitation", {
        p_email_hmac: await emailDigest(input.email), p_actor_id: member!.member_id, p_auth_invite_id: invitation.user.id,
        p_expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        p_request_id: idempotencyKey,
      });
      if (error) {
        return json(request, 409, { error: "invitation_record_failed", requestId });
      }
      await finish(authUser.id, action, idempotencyKey, parsedInput, invitationId, "invitation_created");
      return json(request, 200, { invitationId, requestId });
    }
    const input = parsedInput as z.infer<typeof membershipSchema>;
    const { error } = await service.rpc("phase1_update_membership", {
      p_actor_id: member!.member_id, p_target_member_id: input.memberId,
      p_role: input.memberRole, p_status: input.accountStatus, p_reason: input.reason, p_request_id: idempotencyKey,
    });
    if (error) return json(request, error.code === "42501" ? 403 : 400, { error: "membership_update_failed", requestId });
    await finish(authUser.id, action, idempotencyKey, parsedInput, input.memberId, "membership_updated");
    return json(request, 200, { updated: true, requestId });
  } catch {
    return json(request, 500, { error: "request_failed", requestId });
  }
});
