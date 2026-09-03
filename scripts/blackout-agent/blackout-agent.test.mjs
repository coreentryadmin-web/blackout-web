import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

test("claimLock: first claim succeeds", async () => {
  const { claimLock, releaseLock } = await import("./lib/locks.mjs");
  const r = claimLock("BO-TEST-0001", "cursor", { phase: "IMPLEMENTING", leaseMs: 60_000 });
  assert.equal(r.ok, true);
  releaseLock("BO-TEST-0001", "cursor");
});

test("claimLock: second agent blocked", async () => {
  const { claimLock, releaseLock } = await import("./lib/locks.mjs");
  claimLock("BO-TEST-0002", "claude", { leaseMs: 60_000 });
  const second = claimLock("BO-TEST-0002", "cursor", { leaseMs: 60_000 });
  assert.equal(second.ok, false);
  assert.equal(second.reason, "leased_by_other");
  releaseLock("BO-TEST-0002", "claude");
});

test("claimLock: expired lease reclaimed", async () => {
  const { claimLock, releaseLock } = await import("./lib/locks.mjs");
  claimLock("BO-TEST-0003", "claude", { leaseMs: 1 });
  await new Promise((r) => setTimeout(r, 5));
  const second = claimLock("BO-TEST-0003", "cursor", { leaseMs: 60_000 });
  assert.equal(second.ok, true);
  releaseLock("BO-TEST-0003", "cursor");
});

test("dispatch-prompt includes coordination rules", () => {
  const r = spawnSync("node", ["scripts/blackout-agent/dispatch-prompt.mjs", "--agent=cursor"], { encoding: "utf8", cwd: repoRoot });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /BLACKOUT AUTOPILOT/);
  assert.match(r.stdout, /Never approve your own PR/);
});
