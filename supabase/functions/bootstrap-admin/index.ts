import { createClient } from "@supabase/supabase-js";
import { resolveServiceApiKey } from "../_shared/service-key.mjs";
import { emailDigest, constantTimeEqual, requiredEnv } from "../_shared/crypto.ts";
import { corsHeaders, emailSchema, isOriginAllowed, json, readBody } from "../_shared/http.ts";
import { z } from "zod";

const service = createClient(requiredEnv("SUPABASE_URL"), resolveServiceApiKey(Deno.env.get("SUPABASE_SECRET_KEYS")), { auth: { persistSession: false, autoRefreshToken: false } });

Deno.serve(async (request) => {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(request.headers.get("origin")) });
  if (request.method !== "POST" || !isOriginAllowed(request)) return json(request, 405, { error: "request_not_allowed", requestId });
  const bootstrapToken = Deno.env.get("BOOTSTRAP_ADMIN_TOKEN");
  if (!bootstrapToken || !constantTimeEqual(request.headers.get("x-bootstrap-token") ?? "", bootstrapToken)) return json(request, 401, { error: "invalid_bootstrap_token", requestId });
  try {
    const { email } = await readBody(request, z.object({ email: emailSchema }));
    const redirectTo = `${requiredEnv("WEB_APP_URL").replace(/\/$/, "")}/accept-invitation`;
    const { data: invitation, error: inviteError } = await service.auth.admin.inviteUserByEmail(email, { redirectTo });
    if (inviteError || !invitation.user) return json(request, 400, { error: "bootstrap_invitation_failed", requestId });
    const { data: invitationId, error } = await service.rpc("phase1_reserve_bootstrap_invitation", {
      p_email_hmac: await emailDigest(email), p_auth_invite_id: invitation.user.id,
      p_expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    });
    if (error) {
      return json(request, 409, { error: "bootstrap_already_reserved", requestId });
    }
    return json(request, 200, { invitationId, requestId });
  } catch {
    return json(request, 400, { error: "invalid_request", requestId });
  }
});
