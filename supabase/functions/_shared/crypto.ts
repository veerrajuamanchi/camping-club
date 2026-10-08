const encoder = new TextEncoder();

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function toHex(value: ArrayBuffer): string {
  return [...new Uint8Array(value)].map((part) => part.toString(16).padStart(2, "0")).join("");
}

async function hmac(secret: string, value: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", decodeBase64(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}

export async function emailDigest(email: string): Promise<string> {
  const digest = await hmac(requiredEnv("INVITATION_HMAC_KEY"), email.trim().toLowerCase());
  return `\\x${toHex(digest.buffer)}`;
}

export async function keyedDigest(secretName: string, value: string): Promise<string> {
  const digest = await hmac(requiredEnv(secretName), value);
  return `\\x${toHex(digest.buffer)}`;
}

export async function requestDigest(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return `\\x${toHex(digest)}`;
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
}

export async function protectPaymentIdentifier(identifier: string) {
  const keyVersion = requiredEnv("PAYMENT_ENCRYPTION_KEY_VERSION");
  const encryptionKey = await crypto.subtle.importKey("raw", decodeBase64(requiredEnv("PAYMENT_ENCRYPTION_KEY")), "AES-GCM", false, ["encrypt"]);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, encryptionKey, encoder.encode(identifier.trim()));
  const fingerprint = await hmac(requiredEnv("PAYMENT_FINGERPRINT_KEY"), identifier.trim().toLowerCase());
  return {
    ciphertext: `\\x${toHex(ciphertext)}`,
    nonce: `\\x${toHex(nonce.buffer)}`,
    keyVersion,
    fingerprint: `\\x${toHex(fingerprint.buffer)}`,
  };
}

export function requiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing server configuration: ${name}`);
  return value;
}

export function constantTimeEqual(left: string, right: string): boolean {
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  let mismatch = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) mismatch |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return mismatch === 0;
}
