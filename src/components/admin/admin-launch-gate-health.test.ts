import { test } from "node:test";
import assert from "node:assert/strict";
import { launchGateHealthy } from "./admin-launch-gate-health";

// The exact inline expression AdminOperationsDashboard.tsx used to carry before this fix —
// kept here only to prove the regression it had, never imported back into the component.
function oldHardcodedCheck(status: { open_count: number; total_count: number; locked_keys: readonly string[] }) {
  return (
    status.open_count === status.total_count ||
    (status.open_count === 5 && status.locked_keys.length === 1 && status.locked_keys[0] === "largo")
  );
}

test("launchGateHealthy: everything launched is healthy at any tool count", () => {
  assert.strictEqual(launchGateHealthy({ open_count: 7, total_count: 7, locked_keys: [] }), true);
  assert.strictEqual(launchGateHealthy({ open_count: 3, total_count: 3, locked_keys: [] }), true);
});

test("launchGateHealthy: only largo locked is healthy regardless of total tool count", () => {
  // 7 tools total (current real TOOLS.length in tool-access.ts, incl. Meridian): 6 open, largo locked.
  assert.strictEqual(
    launchGateHealthy({ open_count: 6, total_count: 7, locked_keys: ["largo"] }),
    true,
  );
  // A hypothetical future 8th tool added: 7 open, largo still the only lock — still healthy.
  assert.strictEqual(
    launchGateHealthy({ open_count: 7, total_count: 8, locked_keys: ["largo"] }),
    true,
  );
});

test("launchGateHealthy: anything else locked besides largo is degraded", () => {
  assert.strictEqual(
    launchGateHealthy({ open_count: 5, total_count: 7, locked_keys: ["largo", "vector"] }),
    false,
  );
  assert.strictEqual(
    launchGateHealthy({ open_count: 6, total_count: 7, locked_keys: ["vector"] }),
    false,
  );
});

test("regression: the old open_count===5 inline check misread today's real default state as degraded", () => {
  // Real current state per tool-access.ts: TOOLS.length === 7, defaultLaunched false only for
  // "largo" => with LAUNCHED_TOOLS unset, open_count is 6 (not 5) and locked_keys is ["largo"].
  const realDefaultState = { open_count: 6, total_count: 7, locked_keys: ["largo"] as const };

  // The bug: the OLD inline expression read this exact, correct, intended default state as
  // unhealthy (false) because it was pinned to a stale open_count===5 from before Meridian
  // shipped as the 7th tool.
  assert.strictEqual(oldHardcodedCheck(realDefaultState), false);

  // The fix: the new helper reads the same real state correctly as healthy.
  assert.strictEqual(launchGateHealthy(realDefaultState), true);
});
