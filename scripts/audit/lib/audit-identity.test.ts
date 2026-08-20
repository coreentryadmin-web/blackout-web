import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * CONCURRENT AUDIT RUNS MUST NOT SHARE ONE CLERK USER.
 *
 * Every harness defaulted to `claude-audit-temp@blackouttrades.com`. `createAuditClerkUser` adopts
 * on e-mail collision — correct for reclaiming a leftover from a crashed run, fatal for two runs
 * overlapping in time: they share ONE user, and whichever finishes first `cleanup()`s it out from
 * under the other. The survivor holds a session whose user no longer exists.
 *
 * MEASURED ON PROD 2026-08-20: `POST /sign_in_tokens` -> **HTTP 404 resource_not_found** mid-run.
 * Not a rate limit and not an expiry — the user was deleted. Four probe runs pinned it:
 *   - two overlapping a 6-pass validator burst died at t=60s and t=90s
 *   - one run with nothing else running survived 7/7 refreshes to t=210s
 *   - one "solo" run died at t=120s because an EARLIER probe was still alive and cleaned up
 *
 * The failure surfaces as a run that 401s for its whole remainder, which is exactly the shape
 * CLAUDE.md records as having been mis-diagnosed as a product fault three times.
 */

const SRC = readFileSync(
  join(process.cwd(), "scripts/audit/lib/prod-clerk-session.mjs"),
  "utf8"
);
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

test("REGRESSION: the default temp-user e-mail is unique per run", () => {
  // The bare shared address must not survive as the default.
  assert.doesNotMatch(
    CODE,
    /["'`]claude-audit-temp@blackouttrades\.com["'`]/,
    "the shared, collision-prone default must be gone"
  );
  assert.match(CODE, /claude-audit-temp\+\$\{runTag\}@/, "the default must carry a per-run tag");
});

test("the run tag is stable within a process, not per-call", () => {
  // Re-establishment mints a NEW sign-in for the SAME user. A per-call random tag would create a
  // fresh user on every recovery and leak one per attempt — trading a delete race for a leak.
  assert.match(CODE, /process\.pid/, "tag must derive from the process identity");
  assert.doesNotMatch(
    CODE,
    /const runTag[^\n]*Math\.random/,
    "must not be random per call"
  );
});

test("an explicit email override is still honoured", () => {
  // The entitlement probe mints a NON-admin member at a known address on purpose; verifying a gate
  // with the wrong identity proves nothing about the gate.
  assert.match(CODE, /emailOverride \|\|/, "override must take precedence over the generated tag");
  assert.match(CODE, /process\.env\.AUDIT_EMAIL/, "and the env override must survive too");
});

test("adoption is still present — it is scoped, not removed", () => {
  // The point is not to stop adopting. A leftover from a CRASHED previous run must still be
  // reclaimed; what must stop is adopting a LIVE concurrent run's user. Uniqueness achieves that
  // without touching the adopt path, so the adopt path must still be wired.
  const helper = readFileSync(
    join(process.cwd(), "scripts/audit/lib/clerk-audit-user.mjs"),
    "utf8"
  );
  assert.match(helper, /adoptByEmail/, "adoption must remain available for genuine leftovers");
});
