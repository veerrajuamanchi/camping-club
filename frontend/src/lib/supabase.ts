import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const configurationError = !url || !key ? "Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY to connect this local app." : null;
export const supabase = url && key ? createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }) : null;

export type ApiMember = {
  memberId: string;
  displayName: string;
  role: "member" | "admin";
  phoneE164: string;
  paymentMethod: "zelle" | "venmo" | "paypal" | "apple_cash" | null;
};

export class MemberApiError extends Error {
  constructor(readonly code?: string, readonly status?: number, message?: string) {
    super(message ?? "The request could not be completed.");
    this.name = "MemberApiError";
  }
}

export class TripApiError extends Error {
  constructor(readonly code?: string, readonly status?: number, message?: string) {
    super(message ?? "The trip request could not be completed.");
    this.name = "TripApiError";
  }
}

export class AuthApiError extends Error {
  constructor(readonly code?: string, readonly status?: number) {
    super("The auth request could not be completed.");
    this.name = "AuthApiError";
  }
}

export async function responseErrorDetails(response?: Response): Promise<{ code?: string; message?: string }> {
  if (!response) return {};
  try {
    const payload = await response.clone().json();
    const code = typeof payload?.error === "string" ? payload.error : typeof payload?.error?.code === "string" ? payload.error.code : undefined;
    const message = typeof payload?.message === "string"
      ? payload.message
      : typeof payload?.error_description === "string"
        ? payload.error_description
        : undefined;
    return { code, message };
  } catch {
    return {};
  }
}

export async function responseErrorCode(response?: Response): Promise<string | undefined> {
  const { code } = await responseErrorDetails(response);
  return code;
}

export async function invokeMemberApi<T>(action: string, input?: unknown, idempotencyKey?: string): Promise<T> {
  if (!supabase) throw new Error(configurationError ?? "Supabase is unavailable.");
  const body = { action, input };
  const headers = !["me", "list_members"].includes(action) ? { "Idempotency-Key": idempotencyKey ?? crypto.randomUUID() } : undefined;
  const { data, error, response } = await supabase.functions.invoke("member-api", { body, headers });
  if (error || data?.error) {
    const { code: responseCode, message: responseMsg } = await responseErrorDetails(response);
    const payloadCode = typeof data?.error === "string" ? data.error : typeof data?.error?.code === "string" ? data.error.code : undefined;
    const msg = responseMsg || (typeof data?.message === "string" ? data.message : undefined) || (error?.message && error.message !== "Edge Function returned a non-2xx status code" ? error.message : undefined);
    throw new MemberApiError(responseCode ?? payloadCode, response?.status, msg);
  }
  return data?.data as T;
}

const tripMutationActions = new Set([
  "admin_configure_club", "admin_generate_calendar", "admin_reorder_campsites", "admin_update_campsite", "admin_create_campsite",
  "admin_configure_trip", "admin_set_poll_status", "admin_publish_rule", "admin_set_rule_override",
  "submit_rsvp", "admin_record_interest", "request_withdrawal", "admin_promote_from_waitlist",
  "admin_create_master_responsibility", "admin_update_master_responsibility",
  "admin_generate_candidate_slots", "admin_configure_time_slot", "admin_create_custom_time_slot",
  "admin_add_slot_duty", "admin_update_slot_duty",
  "claim_duty", "drop_duty", "admin_assign_duty", "admin_reassign_duty", "admin_set_driver_credit",
  "admin_delete_trip", "admin_create_custom_trip", "admin_delete_campsite",
]);

export async function invokeTripApi<T>(action: string, input?: unknown, idempotencyKey?: string): Promise<T> {
  if (!supabase) throw new Error(configurationError ?? "Supabase is unavailable.");
  const headers = tripMutationActions.has(action)
    ? { "Idempotency-Key": idempotencyKey ?? crypto.randomUUID() }
    : undefined;
  const { data, error, response } = await supabase.functions.invoke("trip-api", { body: { action, input }, headers });
  if (error || data?.error) {
    const { code: responseCode, message: responseMsg } = await responseErrorDetails(response);
    const payloadCode = typeof data?.error === "string" ? data.error : typeof data?.error?.code === "string" ? data.error.code : undefined;
    const msg = responseMsg || (typeof data?.message === "string" ? data.message : undefined) || (error?.message && error.message !== "Edge Function returned a non-2xx status code" ? error.message : undefined);
    throw new TripApiError(responseCode ?? payloadCode, response?.status, msg);
  }
  return data?.data as T;
}

export async function invokeAuthApi<T = unknown>(action: string, input?: unknown): Promise<T> {
  if (!supabase) throw new Error(configurationError ?? "Supabase is unavailable.");
  const { data, error, response } = await supabase.functions.invoke("auth-api", {
    body: { action, input: input ?? {} },
  });
  if (error || data?.error) {
    const responseCode = await responseErrorCode(response);
    const payloadCode = typeof data?.error === "string" ? data.error : typeof data?.error?.code === "string" ? data.error.code : undefined;
    throw new AuthApiError(responseCode ?? payloadCode, response?.status);
  }
  return (data?.data ?? data) as T;
}
