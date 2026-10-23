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
    name: z.string().trim().max(120).optional().default(""),
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

    // Check if already an approved member (via admin_invitation_events, approved access_request, or existing active account)
    const { data: isApproved, error: approvedError } = await service.rpc(
      "auth_api_is_approved_member",
      { p_email_hmac: digest, p_email: input.email }
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
      return json(request, 200, { status: "pending_request", requestId });
    }

    // If no name was provided, this was a login attempt — do not create an access request
    if (!input.name || input.name.trim().length === 0) {
      return json(request, 200, { status: "not_registered", requestId });
    }

    // Create new access request
    const { data: newId, error: createError } = await service.rpc(
      "auth_api_create_access_request",
      { p_email_hmac: digest, p_hmac_key_version: keyVersion, p_display_name: input.name, p_email: input.email }
    );
    if (createError?.message?.includes("duplicate_access_request")) {
      return json(request, 200, { status: "duplicate_request", requestId });
    }
    if (createError || !newId) {
      return json(request, 500, { error: "request_failed", requestId });
    }

    // Attempt to notify administrator via Resend if RESEND_API_KEY is configured
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (resendApiKey) {
      const adminEmail = Deno.env.get("ADMIN_NOTIFICATION_EMAIL") || "veerraju.amanchi@gmail.com";
      const fromEmail = Deno.env.get("RESEND_FROM_EMAIL") || "Camping Club <onboarding@resend.dev>";
      const webAppUrl = Deno.env.get("WEB_APP_URL") || "https://camping-club.onrender.com";
      try {
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${resendApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: fromEmail,
            to: [adminEmail],
            subject: `🏕️ New Camping Club Access Request: ${input.name}`,
            html: `
              <div style="font-family: sans-serif; max-width: 540px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
                <h2 style="color: #0f172a; margin-top: 0;">New Access Request</h2>
                <p>A new member has requested access to the <strong>Private Camping Club</strong>:</p>
                <div style="background-color: #f8fafc; padding: 12px 16px; border-radius: 6px; margin: 16px 0;">
                  <p style="margin: 4px 0;"><strong>Name:</strong> ${input.name}</p>
                  <p style="margin: 4px 0;"><strong>Email:</strong> ${input.email}</p>
                  <p style="margin: 4px 0;"><strong>Time:</strong> ${new Date().toUTCString()}</p>
                </div>
                <p style="margin-top: 20px;">
                  <a href="${webAppUrl.replace(/\/$/, "")}/admin/members" style="background-color: #16a34a; color: #ffffff; padding: 10px 18px; border-radius: 6px; text-decoration: none; font-weight: bold; display: inline-block;">
                    Review & Approve in Admin Panel
                  </a>
                </p>
              </div>
            `,
          }),
        });
      } catch (notifyErr) {
        console.warn("Failed to dispatch admin notification email:", notifyErr);
      }
    }

    return json(request, 200, { status: "new_request_created", requestId });
  }

  return json(request, 400, { error: "unknown_action", requestId });
});
