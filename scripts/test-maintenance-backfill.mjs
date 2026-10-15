import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const statusRun = spawnSync("npx", ["supabase", "status", "-o", "json"], { encoding: "utf8" });
if (statusRun.status !== 0) throw new Error("The local Supabase stack must be running.");
const status = JSON.parse(statusRun.stdout.slice(statusRun.stdout.indexOf("{")));
const database = new URL(status.DB_URL);
if (!["127.0.0.1", "localhost"].includes(database.hostname)) throw new Error("Only a local synthetic test database is allowed.");
const migration = readFileSync(new URL("../supabase/migrations/20261015070306_event_access_and_rsvp_maintenance.sql", import.meta.url), "utf8");
const fixture = readFileSync(new URL("./fixtures/maintenance-backfill.sql", import.meta.url), "utf8");
const input = fixture.replaceAll("\\ir ../migrations/20261015070306_event_access_and_rsvp_maintenance.sql", () => migration);
const config = readFileSync(new URL("../supabase/config.toml", import.meta.url), "utf8");
const projectId = /^project_id\s*=\s*"([a-zA-Z0-9_-]+)"/m.exec(config)?.[1];
if (!projectId) throw new Error("Cannot identify the local project.");
const result = spawnSync("docker", ["exec", "-i", `supabase_db_${projectId}`, "psql", "-U", "postgres", "-d", "postgres", "-X", "--set=ON_ERROR_STOP=1", "-f", "-"], { input, encoding: "utf8" });
process.stdout.write(result.stdout ?? "");
process.stderr.write(result.stderr ?? "");
if (result.error) throw result.error;
process.exit(result.status !== 0 || /^not ok\b/m.test(result.stdout) ? 1 : 0);
