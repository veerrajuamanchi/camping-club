import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { terminateProcessTree } from "./terminate-process.mjs";

test("terminates a spawned command and its descendants", async () => {
  const child = spawn(process.execPath, ["-e", `
    const { spawn } = require("node:child_process");
    spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
    setInterval(() => {}, 1000);
  `], { detached: true, stdio: ["ignore", "ignore", "ignore"] });

  const closed = new Promise((resolve) => child.once("close", resolve));
  try {
    await delay(100);
    await terminateProcessTree(child, { graceMs: 500 });
    await Promise.race([
      closed,
      delay(2_000).then(() => { throw new Error("Child process group did not close."); }),
    ]);
    assert.notEqual(child.signalCode, null);
  } finally {
    if (child.pid) {
      try { process.kill(-child.pid, "SIGKILL"); } catch { /* already exited */ }
    }
  }
});
