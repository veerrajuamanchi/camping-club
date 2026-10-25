import { spawnSync, spawn } from "node:child_process";

// Fail-closed invariant: This runner CANNOT target production (kdxmwqxlhswcgwanlump)
const STAGING_PROJECT_REF = "rwmizunhxszjvcsaqkre";
const PRODUCTION_PROJECT_REF = "kdxmwqxlhswcgwanlump";

if (process.env.SUPABASE_PROJECT_REF === PRODUCTION_PROJECT_REF) {
  throw new Error("CRITICAL SAFETY VIOLATION: Cannot run hosted QA against production project.");
}

console.log(`[Hosted Staging QA] Retrieving credentials for classified staging project (${STAGING_PROJECT_REF})...`);
const run = spawnSync(
  "npx",
  ["supabase", "projects", "api-keys", "--project-ref", STAGING_PROJECT_REF, "--reveal", "--output", "json"],
  { encoding: "utf8" }
);

if (run.status !== 0) {
  throw new Error("Cannot obtain isolated staging credentials from Supabase CLI.");
}

const parsed = JSON.parse(run.stdout.slice(run.stdout.search(/[\[{]/)));

function objects(value) {
  if (Array.isArray(value)) return value.flatMap(objects);
  if (value && typeof value === "object") return [value, ...Object.values(value).flatMap(objects)];
  return [];
}

const values = objects(parsed).flatMap((value) => Object.values(value));
const secret = values.find((value) => typeof value === "string" && value.startsWith("sb_secret_"));
const publishable = values.find((value) => typeof value === "string" && value.startsWith("sb_publishable_"));

if (!secret || !publishable) {
  throw new Error("Staging requires active publishable and secret credentials.");
}

const apiUrl = `https://${STAGING_PROJECT_REF}.supabase.co`;
console.log(`[Hosted Staging QA] Verified isolation. Target: ${apiUrl} (Production is excluded).`);

const specs = process.argv.slice(2);
const targetSpecs = specs.length > 0 ? specs : ["e2e/camping-club-v2-iteration3.spec.ts"];

console.log(`[Hosted Staging QA] Executing Playwright test specs: ${targetSpecs.join(", ")}`);

const runner = spawn(
  "npx",
  ["playwright", "test", ...targetSpecs, "--retries=0"],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      CI: "1",
      HOSTED_QA: "1",
      SUPABASE_URL: apiUrl,
      SUPABASE_SERVICE_ROLE_KEY: secret,
      SUPABASE_PUBLISHABLE_KEY: publishable,
      VITE_SUPABASE_URL: apiUrl,
      VITE_SUPABASE_PUBLISHABLE_KEY: publishable,
      PLAYWRIGHT_BASE_URL: "http://127.0.0.1:5173",
    },
  }
);

runner.on("error", (err) => {
  console.error("Failed to start hosted staging QA runner:", err);
  process.exitCode = 1;
});

runner.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
