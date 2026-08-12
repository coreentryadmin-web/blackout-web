import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * THE POST-ROLLOUT ASSET GATE — the step that decides whether a merge actually reached members.
 *
 * It failed a real deploy on 2026-08-12 and four merged fixes sat in `main` while production served
 * the previous build for ~25 minutes, with every PR reporting green. The cause was not a broken
 * build (a re-run with no code change passed) but the mixed-fleet window: during a rolling deploy
 * the ALB fronts BOTH builds, and a page from a new task references chunks an old task 404s.
 *
 * Two properties keep that from recurring, and both are easy to quietly undo while "cleaning up the
 * workflow", so they are asserted here rather than left to a comment:
 *
 *   PATIENCE  — enough wall-clock for the fleet to converge (a false RED blocks a good deploy).
 *   CONFIRMATION — two consecutive passes, because ONE probe can pass by luck while the fleet is
 *                  still mixed (a false GREEN ships a half-rolled fleet, which is worse: it is
 *                  silent).
 */

const WORKFLOW = join(import.meta.dirname, "..", ".github/workflows/ecr-push-production.yml");
const MIN_WINDOW_SECONDS = 240;

function gateStep(): string {
  const body = readFileSync(WORKFLOW, "utf8");
  const start = body.indexOf("Validate static assets on origin");
  assert.ok(start > 0, "the production deploy must still validate static assets after rollout");
  // Up to the next step at the same indentation.
  const rest = body.slice(start);
  const end = rest.indexOf("\n      - name:");
  return end > 0 ? rest.slice(0, end) : rest;
}

test("the gate waits long enough for a rolling ECS fleet to converge", () => {
  const step = gateStep();
  const attempts = Number(/seq 1 (\d+)/.exec(step)?.[1] ?? 0);
  const sleep = Number(/sleep (\d+)/.exec(step)?.[1] ?? 0);
  assert.ok(attempts > 0 && sleep > 0, "the gate must retry on a schedule, not probe once");
  assert.ok(
    attempts * sleep >= MIN_WINDOW_SECONDS,
    `gate window is ${attempts * sleep}s; 2.5min was demonstrably too short on 2026-08-12 ` +
      `(needs >= ${MIN_WINDOW_SECONDS}s)`
  );
});

test("one lucky pass is not enough — it requires consecutive passes", () => {
  const step = gateStep();
  assert.match(step, /streak/, "the gate must track consecutive passes, not accept the first one");
  assert.match(
    step,
    /streak.*-ge 2|-ge 2.*streak/s,
    "a single probe can pass while the fleet is still mixed; require at least two in a row"
  );
});

test("a failure resets the streak — passes must be CONSECUTIVE, not cumulative", () => {
  const step = gateStep();
  // Counting total passes instead of consecutive ones would re-admit exactly the luck this guards.
  assert.match(step, /streak=0/, "a failed probe must reset the streak");
});

test("the gate still FAILS the deploy when the fleet never converges", () => {
  const step = gateStep();
  assert.match(step, /exit 1/, "an unconverged fleet must fail the job, never warn and pass");
});
