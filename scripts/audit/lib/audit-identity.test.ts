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

/**
 * PER-RUN IDENTITY REMOVED AN ACCIDENTAL GARBAGE COLLECTOR — this restores an explicit one.
 *
 * When every harness shared ONE address, adoption meant one user existed forever and held exactly
 * one phone number from the `+1415555xxxx` pool. Per-run identity makes each run CREATE a user, so
 * every run consumes a number, and any run that dies before its `finally` leaks one indefinitely.
 *
 * MEASURED 2026-08-20, ~40 minutes after per-run identity shipped: a validator pass failed with
 * `phone-number collision persisted across 2 attempt(s) with distinct +1415555XXXX numbers —
 * likely leaked temp users holding numbers`. 5 of 6 passes in that burst were clean — a rising
 * -probability collision rather than a hard break, which is precisely how it would foul the pool
 * unnoticed.
 */

test("REGRESSION: leaked temp users are swept before a new one is minted", () => {
  assert.match(CODE, /sweepLeakedAuditUsers/, "a sweep must exist");
  assert.match(CODE, /await sweepLeakedAuditUsers\(\)/, "and must run before the mint");
  // It must run BEFORE user creation, or it reclaims nothing for the run that needed it.
  // Compare against the CALL SITE, not the import. `createAuditClerkUser` appears in the import
  // line at the top of the file, so a bare indexOf matches there and the ordering assertion passes
  // for the wrong reason — it would keep passing even if the sweep ran after the mint.
  assert.ok(
    CODE.indexOf("await sweepLeakedAuditUsers()") < CODE.indexOf("await createAuditClerkUser({"),
    "sweep must precede the createAuditClerkUser CALL"
  );
});

test("the sweep is age-gated, and the gate exceeds any real run", () => {
  // THE SAFETY ARGUMENT. Without an age gate this is exactly the delete-race that per-run identity
  // was built to remove — it would reap a LIVE concurrent run's user. The threshold must exceed the
  // longest harness here (the paired Largo audit, ~15 min).
  const ms = /STALE_USER_MS = (\d+) \* 60_000/.exec(CODE)?.[1];
  assert.ok(ms, "the threshold must be stated as minutes");
  assert.ok(Number(ms) >= 30, `age gate ${ms}m must comfortably exceed the ~15m longest run`);
  assert.match(CODE, /u\.created_at > cutoff\) continue/, "fresh users must be skipped");
});

test("the sweep only reaps OUR tagged users", () => {
  // Scoped to the per-run prefix. The bare pre-per-run address is deliberately left alone: another
  // agent or an older checkout may still be using it, and reaping it would break them.
  assert.match(CODE, /\^claude-audit-temp\\\+/, "must match only the tagged prefix");
});

test("housekeeping never blocks the run", () => {
  // A sweep failure must not stop a harness from getting a session — the sweep is an optimisation,
  // the session is the job.
  assert.match(CODE, /return 0; \/\/ never block a run on housekeeping/);
});
