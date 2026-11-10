import assert from "node:assert/strict";
import test from "node:test";

import {
  cronWatchdogQueryExitProblems,
  cronWatchdogQueryShouldFail,
} from "./cron-watchdog-query-eval.mjs";

test("off cash RTH: only rth_stale_keys fail query (run 42735522106)", () => {
  const body = {
    problem_keys: ["swing-discovery"],
    rth_stale_keys: [],
    error_spike: "none",
  };
  const problems = cronWatchdogQueryExitProblems(body, { inCashRthSession: false });
  assert.deepEqual(problems, []);
  assert.equal(cronWatchdogQueryShouldFail(body, problems), false);
});

test("in cash RTH: all problem_keys count", () => {
  const body = {
    problem_keys: ["swing-discovery", "flow-ingest"],
    rth_stale_keys: ["flow-ingest"],
    error_spike: "none",
  };
  const problems = cronWatchdogQueryExitProblems(body, { inCashRthSession: true });
  assert.deepEqual(problems.sort(), ["flow-ingest", "swing-discovery"]);
});

test("error_spike critical fails even with zero problems", () => {
  const body = { error_spike: "critical", problem_keys: [], rth_stale_keys: [] };
  assert.equal(cronWatchdogQueryShouldFail(body, []), true);
});
