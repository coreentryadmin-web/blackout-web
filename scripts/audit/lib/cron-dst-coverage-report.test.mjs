import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCoverageReport } from "./cron-dst-coverage-report.mjs";

test("COVERAGE section prints unaudited jobs even when there are zero registry mismatches (the bug this file fixes)", () => {
  // This is the common/healthy case: registry mirror agrees with the deployed manifest
  // (mismatches = []), but several deployed jobs are not yet classified into GATES/INTENTS.
  // Before the fix, the whole COVERAGE block (including this warning) lived inside
  // `if (mismatches.length)` in cron-dst-audit.mjs, so it silently never printed here.
  const lines = buildCoverageReport({
    manifestSize: 39,
    unaudited: ["vector-pick-sweep", "thermal-eod-snapshot"],
    mismatches: [],
  });
  const joined = lines.join("\n");
  assert.match(joined, /COVERAGE — 37 of 39 deployed jobs are in GATES or INTENTS/);
  assert.match(joined, /2 deployed job\(s\) are in NEITHER table/);
  assert.match(joined, /vector-pick-sweep/);
  assert.match(joined, /thermal-eod-snapshot/);
  // No mismatches were passed in, so the registry section must not appear.
  assert.doesNotMatch(joined, /REGISTRY `schedule_cron_utc`/);
});

test("registry-mismatch section prints even when every job is covered (coverage has nothing extra to say)", () => {
  const lines = buildCoverageReport({
    manifestSize: 10,
    unaudited: [],
    mismatches: [{ key: "x-autopost", registry: "15 13,14 * * 1-5", deployed: "0 14 * * 1-5", kind: "registry mirror disagrees with the deployed schedule" }],
  });
  const joined = lines.join("\n");
  assert.match(joined, /COVERAGE — 10 of 10 deployed jobs are in GATES or INTENTS/);
  assert.match(joined, /REGISTRY `schedule_cron_utc` vs DEPLOYED MANIFEST/);
  assert.match(joined, /x-autopost/);
  // No unaudited jobs, so the "NEITHER table" warning must not appear.
  assert.doesNotMatch(joined, /NEITHER table/);
});

test("both sections print together when both have something to say", () => {
  const lines = buildCoverageReport({
    manifestSize: 5,
    unaudited: ["some-warmer"],
    mismatches: [{ key: "foo", registry: "a", deployed: "b", kind: "mismatch" }],
  });
  const joined = lines.join("\n");
  assert.match(joined, /some-warmer/);
  assert.match(joined, /REGISTRY `schedule_cron_utc`/);
});

test("neither section prints when fully covered and no mismatches exist, other than the always-on COVERAGE header", () => {
  const lines = buildCoverageReport({ manifestSize: 3, unaudited: [], mismatches: [] });
  const joined = lines.join("\n");
  assert.match(joined, /COVERAGE — 3 of 3 deployed jobs are in GATES or INTENTS/);
  assert.doesNotMatch(joined, /NEITHER table/);
  assert.doesNotMatch(joined, /REGISTRY `schedule_cron_utc`/);
});
