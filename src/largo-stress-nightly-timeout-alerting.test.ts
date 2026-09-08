import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * A STEP THAT ALERTS "on failure" MUST ALSO CATCH A TIMEOUT — `if: failure()` alone does not.
 *
 * `largo-stress-nightly.yml` sets `timeout-minutes: 45` on its job and gated the ops-issue step
 * on `if: failure()`. When the job hits that wall clock, GitHub Actions marks the timed-out step
 * `cancelled`, not `failed` — `failure()` evaluates false, so the alert step was silently SKIPPED,
 * not run. Measured 2026-08-31 across the last 19 scheduled runs (2026-08-13 through 08-31): 15
 * ended `cancelled` at the 45-minute timeout, 3 ended `failure`, and exactly 1 ended `success`.
 * The `cancelled` outcome is the DOMINANT one (79% of runs), not a rare edge case, and none of
 * those 15 runs ever opened an ops-auto-fix issue — this exact workflow has been silently broken
 * for weeks despite the earlier `issues: write` permissions fix (that fix only helps once this
 * step actually runs; a timeout never let it run at all).
 */

const WORKFLOW = join(import.meta.dirname, "..", ".github", "workflows", "largo-stress-nightly.yml");

test("largo-stress-nightly's ops-issue step alerts on cancelled() (timeout) as well as failure()", () => {
  const src = readFileSync(WORKFLOW, "utf8");
  const stepMatch = src.match(/Open ops issue on failure\s*\n\s*if:\s*(.+)/);
  assert.ok(stepMatch, "expected an 'Open ops issue on failure' step with an `if:` condition");
  const condition = stepMatch![1];
  assert.match(
    condition,
    /cancelled\(\)/,
    `the ops-issue step's \`if:\` condition ("${condition}") does not check cancelled() — a job ` +
      "that hits timeout-minutes ends the previous step `cancelled`, not `failed`, so failure() " +
      "alone silently skips the alert on every timeout"
  );
  assert.match(condition, /failure\(\)/, "the condition should still catch a genuine failure() too");
});

test("largo-stress-nightly still declares a timeout-minutes budget (this test assumes one exists)", () => {
  const src = readFileSync(WORKFLOW, "utf8");
  assert.match(
    src,
    /timeout-minutes:\s*\d+/,
    "expected a job-level timeout-minutes — if this is ever removed, the cancelled() branch " +
      "above becomes dead code for this specific workflow (a job can still be cancelled by a " +
      "human, but the whole point of this test is the timeout case)"
  );
});
