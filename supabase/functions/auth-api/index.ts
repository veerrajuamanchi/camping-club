import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { resolveServiceApiKey } from "../_shared/service-key.mjs";
import { emailDigest, requiredEnv } from "../_shared/crypto.ts";
import { corsHeaders, emailSchema, isOriginAllowed, json, readBody } from "../_shared/http.ts";

const service = createClient(
  requiredEnv("SUPABASE_URL"),
  resolveServiceApiKey(Deno.env.get("SUPABASE_SECRET_KEYS")),
  { auth: { persistSession: false, autoRefreshToken: false } }
);

const actionNames = ["check_access"] as const;
const requestSchema = z
  .object({ action: z.enum(actionNames), input: z.unknown().optional() })
  .strict();

const checkAccessSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    email: emailSchema,
  })
  .strict();

Deno.serve(async (request) => {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  if (request.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders(request.headers.get("origin")) });
  if (request.method !== "POST" || !isOriginAllowed(request))
    return json(request, 405, { error: "request_not_allowed", requestId });

  let body: z.infer<typeof requestSchema>;
  try {
    body = await readBody(request, requestSchema);
  } catch {
    return json(request, 400, { error: "invalid_request", requestId });
  }

  if (body.action === "check_access") {
    let input: z.infer<typeof checkAccessSchema>;
    try {
      input = checkAccessSchema.parse(body.input);
    } catch {
      return json(request, 400, { error: "invalid_request", requestId });
    }

    const digest = await emailDigest(input.email);
    const keyVersion = requiredEnv("EMAIL_HMAC_KEY_VERSION");

    // Rate-limit: no more than 5 requests from this email in 24h
    const { data: rateData, error: rateError } = await service.rpc(
      "auth_api_check_rate_limit",
      { p_email_hmac: digest }
    );
    if (rateError || (rateData as number) > 5) {
      return json(request, 429, { error: "too_many_requests", requestId });
    }

    // Check if already an approved member (via admin_invitation_events or approved access_request)
    const { data: isApproved, error: approvedError } = await service.rpc(
      "auth_api_is_approved_member",
      { p_email_hmac: digest }
    );
    if (approvedError) {
      return json(request, 500, { error: "lookup_failed", requestId });
    }

    if (isApproved) {
      // Return approved — frontend will call supabase.auth.signInWithOtp
      return json(request, 200, { status: "approved_member", requestId });
    }

    // Check if pending request already exists
    const { data: isPending, error: pendingError } = await service.rpc(
      "auth_api_has_pending_request",
      { p_email_hmac: digest }
    );
    if (pendingError) {
      return json(request, 500, { error: "lookup_failed", requestId });
    }
    if (isPending) {
      return json(request, 200, { status: "duplicate_request", requestId });
    }

    // Create new access request
    const { data: newId, error: createError } = await service.rpc(
      "auth_api_create_access_request",
      { p_email_hmac: digest, p_hmac_key_version: keyVersion, p_display_name: input.name }
    );
    if (createError?.message?.includes("duplicate_access_request")) {
      return json(request, 200, { status: "duplicate_request", requestId });
    }
    if (createError || !newId) {
      return json(request, 500, { error: "request_failed", requestId });
    }
    return json(request, 200, { status: "new_request_created", requestId });
  }

  return json(request, 400, { error: "unknown_action", requestId });
});
