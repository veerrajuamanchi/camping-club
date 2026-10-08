export function resolveServiceApiKey(secretKeysJson) {
  if (!secretKeysJson) {
    throw new Error("Missing server configuration: SUPABASE_SECRET_KEYS");
  }

  let keys;
  try {
    keys = JSON.parse(secretKeysJson);
  } catch {
    throw new Error("SUPABASE_SECRET_KEYS must be a JSON object");
  }

  if (!keys || typeof keys !== "object" || Array.isArray(keys)) {
    throw new Error("SUPABASE_SECRET_KEYS must be a JSON object");
  }

  if (typeof keys.default !== "string" || keys.default.trim() === "") {
    throw new Error("SUPABASE_SECRET_KEYS must contain a default Supabase secret key");
  }

  return keys.default;
}
