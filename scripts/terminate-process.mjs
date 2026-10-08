import { setTimeout as delay } from "node:timers/promises";

export async function terminateProcessTree(child, { graceMs = 2_000 } = {}) {
  if (!child.pid) return;

  let didClose = Boolean(child.closed);
  const closed = didClose
    ? Promise.resolve()
    : new Promise((resolve) => child.once("close", () => {
        didClose = true;
        resolve();
      }));

  const signalTree = (signal) => {
    try {
      if (process.platform === "win32") child.kill(signal);
      else process.kill(-child.pid, signal);
    } catch (error) {
      if (error?.code !== "ESRCH") throw error;
    }
  };

  signalTree("SIGTERM");
  await Promise.race([closed, delay(graceMs)]);
  if (!didClose) {
    signalTree("SIGKILL");
    await Promise.race([closed, delay(graceMs)]);
  }
  if (!didClose) throw new Error("Child process tree did not close after termination.");
}
