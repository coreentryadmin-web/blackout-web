import test from "node:test";
import assert from "node:assert/strict";
import { watchdogProblemKeysForAudit } from "./watchdog-audit-keys.mjs";

const RTH_MID = new Date("2026-06-04T15:00:00.000Z"); // Wed 11:00 ET
const POST_CLOSE = new Date("2026-11-09T23:12:00.000Z"); // Mon 6:12 PM ET

test("watchdogProblemKeysForAudit: RTH uses full problem_keys", () => {
  const keys = watchdogProblemKeysForAudit(
    { problem_keys: ["spx-evaluate", "banger-discovery"], rth_stale_keys: ["spx-evaluate"] },
    RTH_MID
  );
  assert.deepEqual(keys, ["spx-evaluate", "banger-discovery"]);
});

test("watchdogProblemKeysForAudit: off-hours uses only rth_stale_keys", () => {
  const keys = watchdogProblemKeysForAudit(
    { problem_keys: ["swing-discovery", "banger-discovery"], rth_stale_keys: [] },
    POST_CLOSE
  );
  assert.deepEqual(keys, []);
});
