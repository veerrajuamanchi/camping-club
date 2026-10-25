import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { terminateProcessTree } from "./terminate-process.mjs";

const statusRun = spawnSync("npx", ["supabase", "status", "-o", "json"], { encoding: "utf8" });
if (statusRun.status !== 0) {
  console.error("Local Supabase must be running before starting E2E tests. Run 'npx supabase start'.");
  process.exit(1);
}

const status = JSON.parse(statusRun.stdout.slice(statusRun.stdout.indexOf("{")));
const api = status.API_URL;
const serviceKey = status.SERVICE_ROLE_KEY;

const temporaryDirectory = await mkdtemp(join(tmpdir(), "camping-club-e2e-"));
const envPath = join(temporaryDirectory, "functions.env");
const secret = () => randomBytes(32).toString("base64");

await writeFile(
  envPath,
  [
    `SUPABASE_URL=${api}`,
    `SUPABASE_SECRET_KEYS={"default":"${serviceKey}"}`,
    `INVITATION_HMAC_KEY=${secret()}`,
    `IDEMPOTENCY_HMAC_KEY=${secret()}`,
    "IDEMPOTENCY_HMAC_KEY_VERSION=v1",
    "EMAIL_HMAC_KEY_VERSION=v1",
    `PAYMENT_ENCRYPTION_KEY=${secret()}`,
    "PAYMENT_ENCRYPTION_KEY_VERSION=local-test-v1",
    `PAYMENT_FINGERPRINT_KEY=${secret()}`,
    `BOOTSTRAP_ADMIN_TOKEN=${secret()}`,
    "WEB_APP_URL=http://localhost:5173",
    "ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173",
  ].join("\n"),
  { mode: 0o600 }
);

console.log("Starting local Supabase Edge Functions server for E2E tests...");
const server = spawn("npx", ["supabase", "functions", "serve", "--env-file", envPath], {
  stdio: ["ignore", "pipe", "pipe"],
  detached: process.platform !== "win32",
});

const logParts = [];
server.stdout.on("data", (part) => logParts.push(part));
server.stderr.on("data", (part) => logParts.push(part));

async function waitForFunctionsServer() {
  const expiresAt = Date.now() + 15000;
  while (Date.now() < expiresAt) {
    if (server.exitCode !== null) {
      throw new Error("Local Edge Functions server exited unexpectedly during startup.");
    }
    try {
      const res = await fetch(`${api}/functions/v1/trip-api`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "get_calendar" }),
      });
      if (res.status === 401 || res.status === 405 || res.status === 200) {
        return;
      }
    } catch {
      // Waiting for server to accept connections
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error("Timed out waiting for Edge Functions server to start.");
}

let playwrightExitCode = 1;
try {
  await waitForFunctionsServer();
  console.log("Edge Functions server ready. Running Playwright test runner...");

  const args = process.argv.slice(2);
  const playwrightProcess = spawn("npx", ["playwright", "test", ...args], {
    stdio: "inherit",
    env: {
      ...process.env,
      PLAYWRIGHT_BASE_URL: process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:5173",
      SUPABASE_URL: api,
      SUPABASE_SERVICE_ROLE_KEY: serviceKey,
      SUPABASE_PUBLISHABLE_KEY: status.PUBLISHABLE_KEY,
      MAILPIT_URL: status.MAILPIT_URL || "http://127.0.0.1:54324",
    },
  });

  playwrightExitCode = await new Promise((resolve) => {
    playwrightProcess.on("close", (code) => resolve(code ?? 1));
  });
  if (playwrightExitCode !== 0) {
    const safeLogTail = Buffer.concat(logParts).toString("utf8").slice(-4000).replaceAll(serviceKey, "[redacted]");
    if (safeLogTail) {
      console.error(`Edge Functions log tail:\n${safeLogTail}`);
    }
  }
} catch (error) {
  console.error("E2E runner failure:", error);
  const safeLogTail = Buffer.concat(logParts).toString("utf8").slice(-4000).replaceAll(serviceKey, "[redacted]");
  if (safeLogTail) {
    console.error(`Edge Functions log tail:\n${safeLogTail}`);
  }
  playwrightExitCode = 1;
} finally {
  console.log("Shutting down Edge Functions server...");
  await terminateProcessTree(server).catch((err) => console.error("Error stopping functions server:", err));
  await rm(temporaryDirectory, { recursive: true, force: true }).catch(() => {});
}

process.exit(playwrightExitCode);
