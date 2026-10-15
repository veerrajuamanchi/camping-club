import { spawnSync, spawn } from "node:child_process";

// This runner cannot target production or create resources in another project.
const project = "rwmizunhxszjvcsaqkre";
const run = spawnSync("npx", ["supabase", "projects", "api-keys", "--project-ref", project, "--reveal", "--output", "json"], { encoding: "utf8" });
if (run.status !== 0) throw new Error("Cannot obtain the isolated staging credentials; values were not logged.");
const parsed = JSON.parse(run.stdout.slice(run.stdout.search(/[\[{]/)));
function objects(value) {
  if (Array.isArray(value)) return value.flatMap(objects);
  if (value && typeof value === "object") return [value, ...Object.values(value).flatMap(objects)];
  return [];
}
const values = objects(parsed).flatMap(value => Object.values(value));
const secret = values.find(value => typeof value === "string" && value.startsWith("sb_secret_"));
const publishable = values.find(value => typeof value === "string" && value.startsWith("sb_publishable_"));
if (!secret || !publishable) throw new Error("Staging requires current secret and publishable credentials.");
const api = `https://${project}.supabase.co`;
console.log(`Running hosted workload QA against classified staging ${project}; production is excluded.`);
const runner = spawn("npx", ["playwright", "test", "e2e/daily-workload.spec.ts", "--retries=0"], {
  stdio: "inherit",
  env: { ...process.env, CI: "1", HOSTED_QA: "1", SUPABASE_URL: api, SUPABASE_SERVICE_ROLE_KEY: secret,
    SUPABASE_PUBLISHABLE_KEY: publishable, VITE_SUPABASE_URL: api, VITE_SUPABASE_PUBLISHABLE_KEY: publishable,
    PLAYWRIGHT_BASE_URL: "http://127.0.0.1:5173" },
});
runner.on("error", () => { console.error("Cannot start the hosted QA runner."); process.exitCode = 1; });
runner.on("exit", code => { process.exitCode = code ?? 1; });
