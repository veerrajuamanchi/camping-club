import { z } from "zod";
import { corsHeaders as buildCorsHeaders } from "./cors.mjs";

const defaultOrigins = ["http://localhost:5173", "http://127.0.0.1:5173"];

export function corsHeaders(origin: string | null): Record<string, string> {
  const configured = Deno.env.get("ALLOWED_ORIGINS")?.split(",").map((item) => item.trim()).filter(Boolean) ?? defaultOrigins;
  return buildCorsHeaders(origin, configured);
}

export function json(request: Request, status: number, body: unknown): Response {
  const result = typeof body === "object" && body !== null ? body as Record<string, unknown> : {};
  const requestId = typeof result.request_id === "string" ? result.request_id : typeof result.requestId === "string" ? result.requestId : crypto.randomUUID();
  let envelope: Record<string, unknown>;
  if (typeof result.error === "string") {
    envelope = { error: { code: result.error, message: "The request could not be completed." }, request_id: requestId };
  } else {
    const data = { ...result };
    delete data.request_id;
    delete data.requestId;
    envelope = { data, request_id: requestId };
  }
  return new Response(JSON.stringify(envelope), {
    status,
    headers: { ...corsHeaders(request.headers.get("origin")), "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export function isOriginAllowed(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const configured = Deno.env.get("ALLOWED_ORIGINS")?.split(",").map((item) => item.trim()).filter(Boolean) ?? defaultOrigins;
  return configured.includes(origin);
}

export async function readBody<T extends z.ZodType>(request: Request, schema: T): Promise<z.infer<T>> {
  const contentType = request.headers.get("content-type") ?? "";
  const raw = await request.text();
  if (!contentType.toLowerCase().includes("application/json") || raw.length > 16_384) throw new Error("invalid request");
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error("invalid request"); }
  const result = schema.safeParse(parsed);
  if (!result.success) throw new Error("invalid request");
  return result.data;
}

export const emailSchema = z.string().email().max(254).transform((value) => value.trim().toLowerCase());
export const profileSchema = z.object({
  displayName: z.string().trim().min(1).max(80),
  phoneE164: z.string().regex(/^\+[1-9][0-9]{7,14}$/),
  paymentMethod: z.enum(["zelle", "venmo", "paypal", "apple_cash"]),
  paymentIdentifier: z.string().trim().min(1).max(254),
});
