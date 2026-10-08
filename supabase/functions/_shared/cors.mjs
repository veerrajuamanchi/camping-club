const defaultOrigins = ["http://localhost:5173", "http://127.0.0.1:5173"];

export function corsHeaders(origin, configuredOrigins = defaultOrigins) {
  const configured = configuredOrigins.map((item) => item.trim()).filter(Boolean);
  const accepted = origin && configured.includes(origin) ? origin : "null";
  return {
    "Access-Control-Allow-Origin": accepted,
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, idempotency-key, x-bootstrap-token, x-client-info, x-request-id",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "600",
    "Vary": "Origin",
  };
}
