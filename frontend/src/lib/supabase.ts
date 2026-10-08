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

export async function invokeMemberApi<T>(action: string, input?: unknown, idempotencyKey?: string): Promise<T> {
  if (!supabase) throw new Error(configurationError ?? "Supabase is unavailable.");
  const body = { action, input };
  const headers = !["me", "list_members"].includes(action) ? { "Idempotency-Key": idempotencyKey ?? crypto.randomUUID() } : undefined;
  const { data, error } = await supabase.functions.invoke("member-api", { body, headers });
  if (error) throw new Error("The request could not be completed.");
  if (data?.error) throw new Error("The request could not be completed.");
  return data?.data as T;
}
