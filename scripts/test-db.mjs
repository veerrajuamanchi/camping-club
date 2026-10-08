import { spawnSync } from "node:child_process";

function run(args, label) {
  const result = spawnSync("npx", ["supabase", ...args], { encoding: "utf8", stdio: "inherit" });
  if (result.status !== 0) throw new Error(`${label} failed${result.status === null ? " before completion" : ` with exit code ${result.status}`}.`);
}

run(["db", "reset", "--local"], "Local database reset");
run(["test", "db", "--local"], "Database test suite");
