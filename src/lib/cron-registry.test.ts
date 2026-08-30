import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { CRON_JOBS } from "./cron-registry";

/**
 * The cron health board can only report on jobs whose run-log key it knows. There are two ways for a
 * key to go missing, and BOTH shipped:
 *
 *   1. A route logs under a key with no registry entry. Ten did — including `banger-live-sync`,
 *      which marks the live banger board every five minutes during the session. Those jobs were not
 *      "healthy", they were unwatched: `buildCronHealthSnapshot` never looked their rows up, so the
 *      board covered 40 of the 50 cron routes and nothing said which ten were missing.
 *
 *   2. A registry entry names a key no route ever emits. `welcome-sequence` did — the route logged
 *      `welcome-sequence-send`. That job runs fine (its e-mails are demonstrably sending), but the
 *      board had said "No runs logged" since the day it was added and could never say anything else.
 *      A monitor permanently stuck on one reading is worse than no monitor: it looks like coverage.
 *
 * Neither failure produces an error, a log line, or a red test. Both are invisible until someone
 * diffs the two lists by hand, which is what this test does on every run.
 *
 * Keys are resolved from the route source rather than by convention, because the two legitimately
 * differ: `nighthawk-edition/route.ts` emits `nighthawk-playbook`, and several routes pass a
 * `CRON_KEY` constant instead of a string literal. Matching on directory name would flag both as
 * defects — a check that cries wolf gets deleted, and then the real drift returns.
 */

const CRON_ROUTES_DIR = join(process.cwd(), "src/app/api/cron");

/**
 * Jobs deliberately outside the health board, each with the reason it is safe.
 *
 * These are NOT "not got around to yet". Every one of them is unscheduled in blackout-infra's
 * `cron-jobs.json`, so adding it here would make it permanently stale — a standing false alarm,
 * which is the fastest way to teach people to ignore the board. Whoever schedules one of these
 * should delete its line here in the same change; the test then requires the registry entry.
 */
const INTENTIONALLY_UNREGISTERED: Record<string, string> = {
  "x-engage": "Outward-facing social posting, gated on xApiEnabled + xMarketingSilentOnly. Unscheduled on purpose — enabling it publishes on our behalf, which is a business decision. (Same reason scripts/audit/cron-schedule-coverage.mjs lists it as intentional.)",
  "x-intel": "Operator confirmed 2026-08-28: X marketing crons are unused/redundant. EventBridge rule was never provisioned for this one; route.ts and its admin review-queue UI are left in place (not requested for removal), only the schedule is gone.",
  "x-autopost": "Operator confirmed 2026-08-28: X marketing crons are unused/redundant. EventBridge rule (already DISABLED in prod) deleted the same day; route.ts left in place.",
  "x-growth": "Operator confirmed 2026-08-28: X marketing crons are unused/redundant. EventBridge rule (already DISABLED in prod) deleted the same day; route.ts left in place.",
  "x-replies": "Operator confirmed 2026-08-28: X marketing crons are unused/redundant. EventBridge rule (already DISABLED in prod) deleted the same day; route.ts left in place.",
  "darkpool-discord": "Unscheduled in cron-jobs.json; invoked off another job's path rather than on its own timer, so a stale window computed from a schedule it does not have would be meaningless.",
  "helix-discord-digest": "Unscheduled in cron-jobs.json — same reason as darkpool-discord.",
  "thermal-discord": "Unscheduled in cron-jobs.json — same reason as darkpool-discord.",
};

/** Every `logCronRun(...)` key a route can emit, resolving `CRON_KEY`-style constants. */
function emittedKeysByRoute(): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const entry of readdirSync(CRON_ROUTES_DIR)) {
    const routeFile = join(CRON_ROUTES_DIR, entry, "route.ts");
    let src: string;
    try {
      // Read straight through rather than stat-then-read: the stat was a redundant existence check
      // that CodeQL correctly flags as a TOCTOU race, and the read has to handle the missing/not-a-
      // file case anyway. A directory without a route.ts simply throws here and is skipped.
      src = readFileSync(routeFile, "utf8");
    } catch {
      continue; // no route.ts in this directory — not a cron route
    }

    const keys = new Set<string>();
    for (const m of src.matchAll(/logCronRun\(\s*"([^"]+)"/g)) keys.add(m[1]);
    // Constant form: `logCronRun(CRON_KEY, …)` with `const CRON_KEY = "…"` in the same file.
    for (const m of src.matchAll(/logCronRun\(\s*([A-Z_][A-Z0-9_]*)\s*,/g)) {
      const decl = new RegExp(`const\\s+${m[1]}\\s*(?::[^=]+)?=\\s*"([^"]+)"`).exec(src);
      assert.ok(
        decl,
        `${entry}/route.ts calls logCronRun(${m[1]}) but ${m[1]} is not a string constant declared in that file — ` +
          `this test cannot resolve the key, so the job would silently escape the coverage check.`
      );
      keys.add(decl![1]);
    }
    if (keys.size) out.set(entry, keys);
  }
  return out;
}

test("every cron key a route logs under has a health-registry entry", () => {
  const registry = new Set(CRON_JOBS.map((j) => j.key));
  const orphans: string[] = [];

  for (const [route, keys] of emittedKeysByRoute()) {
    for (const key of keys) {
      if (registry.has(key)) continue;
      if (key in INTENTIONALLY_UNREGISTERED) continue;
      orphans.push(`${key} (logged by src/app/api/cron/${route}/route.ts)`);
    }
  }

  assert.deepEqual(
    orphans,
    [],
    "These cron jobs write run rows that no health board reads — they cannot be reported stale, " +
      "failed, or dark. Add a CRON_JOBS entry (cadence from blackout-infra's cron-jobs.json), or, " +
      "if the job is deliberately unscheduled, add it to INTENTIONALLY_UNREGISTERED with the reason:\n  " +
      orphans.join("\n  ")
  );
});

test("every http registry entry is emitted by some cron route", () => {
  const emitted = new Set<string>();
  for (const keys of emittedKeysByRoute().values()) for (const k of keys) emitted.add(k);

  // `worker` jobs (e.g. nighthawk-playbook's edition builder) report through a heartbeat rather
  // than an HTTP route, so they have nothing to emit and are correctly excluded.
  const unreachable = CRON_JOBS.filter((j) => j.kind === "http" && !emitted.has(j.key)).map(
    (j) => `${j.key} (${j.path ?? "no path"})`
  );

  assert.deepEqual(
    unreachable,
    [],
    "These registry entries name a run-log key no route ever writes, so the board is pinned on " +
      '"No runs logged" for them forever and can never detect the job dying. Either the route logs ' +
      "under a different key (fix the route), or the entry is stale (remove it):\n  " +
      unreachable.join("\n  ")
  );
});

test("INTENTIONALLY_UNREGISTERED carries a real reason for each exemption", () => {
  // An exemption list is only safe while each line explains itself; a bare key set would quietly
  // become the place jobs go to stop being monitored.
  for (const [key, reason] of Object.entries(INTENTIONALLY_UNREGISTERED)) {
    assert.ok(reason.length > 40, `${key} needs a real reason, not a placeholder`);
  }
});
