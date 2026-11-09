import test from "node:test";
import assert from "node:assert/strict";
import { cronWatchdogGhaVerdict } from "./gha-cron-watchdog-eval.mjs";

test("swing-discovery-only stale is warn, not fail (ops P1)", () => {
  const v = cronWatchdogGhaVerdict({
    problem_keys: ["swing-discovery"],
    rth_stale_keys: [],
    error_spike: "none",
  });
  assert.equal(v.fail, false);
  assert.deepEqual(v.warnKeys, ["swing-discovery"]);
});

test("rth_stale_keys fails the GHA step", () => {
  const v = cronWatchdogGhaVerdict({
    problem_keys: ["heatmap-warm", "flow-ingest"],
    rth_stale_keys: ["heatmap-warm", "flow-ingest"],
    error_spike: "none",
  });
  assert.equal(v.fail, true);
  assert.match(v.failures[0], /heatmap-warm/);
});

test("critical error spike fails even with no stale crons", () => {
  const v = cronWatchdogGhaVerdict({
    problem_keys: [],
    rth_stale_keys: [],
    error_spike: "critical",
    error_count: 120,
    error_window_min: 15,
  });
  assert.equal(v.fail, true);
  assert.match(v.failures.join(" "), /error-spike/);
});
