import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const root = new URL("../frontend/dist/", import.meta.url).pathname;
const files = [];
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await walk(path);
    else files.push(path);
  }
}
try { await walk(root); } catch { throw new Error("Build the frontend before scanning: npm run build"); }
if (files.length === 0) throw new Error("Frontend build output is empty.");

const prohibited = [
  ["secret Supabase key", /sb_secret_[A-Za-z0-9_-]{12,}/g],
  ["server role credential", /SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEY|service_role_[A-Za-z0-9_-]{24,}/gi],
  ["payment encryption key material", /PAYMENT_ENCRYPTION_KEY|PAYMENT_FINGERPRINT_KEY|INVITATION_HMAC_KEY|IDEMPOTENCY_HMAC_KEY/g],
  ["bootstrap token configuration", /BOOTSTRAP_ADMIN_TOKEN/g],
  ["private key block", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
];
const findings = [];
for (const file of files) {
  const content = await readFile(file, "utf8");
  for (const [label, pattern] of prohibited) {
    pattern.lastIndex = 0;
    if (pattern.test(content)) findings.push(`${label} in ${file.replace(root, "")}`);
  }
}
if (findings.length) throw new Error(`Client bundle secret scan failed:\n${findings.join("\n")}`);
console.log(`Client bundle scan passed (${files.length} files; no privileged credentials or payment-key material found).`);
