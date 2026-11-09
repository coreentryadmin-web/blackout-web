import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/** Source ratchet: off-hours GHA audit must not fail on non-RTH watchdog problems alone. */
test("gha-rth-audit: cron-watchdog uses rthOpen + rth_stale_keys for off-hours gating", () => {
  const src = readFileSync(new URL("./gha-rth-audit.mjs", import.meta.url), "utf8");
  assert.match(src, /label === "cron-watchdog"/);
  assert.match(src, /rth_stale_keys/);
  assert.match(src, /off-hours problems \(non-blocking\)/);
});

test("gha-rth-audit: full-site deep audit skipped outside RTH window unless --force", () => {
  const src = readFileSync(new URL("./gha-rth-audit.mjs", import.meta.url), "utf8");
  assert.match(src, /if \(rthOpen \|\| force\)/);
  assert.match(src, /Skipped \(off RTH window/);
});
