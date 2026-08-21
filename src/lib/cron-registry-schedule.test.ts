import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { CRON_JOBS } from "./cron-registry";

/**
 * `schedule_cron_utc` IS NOT DOCUMENTATION. It changes what the health board reports.
 *
 * `admin-cron-health.ts` feeds it to `isInOffScheduleIdleGap()` to suppress staleness while a job is
 * inside a long gap where no tick is due. That is correct for a real schedule and actively harmful
 * for a fictional one: a job that never fires and never logs a run gets its status downgraded from
 *
 *     "NEVER logged a run — job may not be scheduled at all"        (the alarm)
 *   → "No runs logged (not due — outside its window)"               (silence)
 *
 * which is the one alarm designed to catch exactly that condition. Measured on 2026-08-21:
 * `largo-morning-brief`'s phantom `25 13 * * 1-5` suppressed it at **48/48** half-hour probes across
 * a weekday — permanently — and `zerodte-grade`'s at 42/48. Neither job is in blackout-infra's
 * generated manifest. Neither has ever run.
 *
 * WHY THIS TEST CHECKS THE TOML AND NOT THE MANIFEST. The deployed schedule lives in the other
 * repository, and a test that silently skips when it cannot see that file would pass in CI forever —
 * which is the failure being fixed (`cron-schedule-coverage.mjs` says the same and is a script for
 * that reason). But the manifest is GENERATED: `blackout-infra/scripts/sync-cron-schedules.mjs`
 * reads the `railway.*.toml` files IN THIS REPO and rebuilds it. So the TOMLs are the in-repo source
 * of truth, and registry-vs-TOML is checkable in CI with no cross-repo dependency.
 */

const REPO_ROOT = process.cwd();

/**
 * Registry entries whose `schedule_cron_utc` has no backing TOML.
 *
 * This is not a formality. The generator `writeFileSync`s `cron-jobs.json` from scratch with NO
 * merge and no preservation of hand-added entries, so every job listed here exists in the deployed
 * manifest only as a hand-edit and **would be deleted the next time anyone runs the sync** — leaving
 * a route that still exists, is still registered here, still reports healthy, and never fires again.
 *
 * Adding a TOML is what removes a line from this list. Adding a line requires saying why.
 */
const NO_BACKING_TOML: Record<string, string> = {
  "x-autopost":
    "Hand-added to blackout-infra's cron-jobs.json with no railway.x-autopost.toml behind it. A sync run would delete its schedule silently. Owned by the x-content lane, which is already changing this job's schedule for the EST/EDT defect — leaving the TOML to that change rather than racing it.",
  "x-growth":
    "Hand-added to cron-jobs.json with no railway.x-growth.toml. Same regeneration hazard as x-autopost; grouped with the other x-* marketing jobs so one change can add all four TOMLs together.",
  "x-replies":
    "Hand-added to cron-jobs.json with no railway.x-replies.toml. Same regeneration hazard as x-autopost.",
  "x-analytics":
    "Hand-added to cron-jobs.json with no railway.x-analytics.toml. Same regeneration hazard as x-autopost.",
  "banger-live-sync":
    "Hand-added to cron-jobs.json with no railway.banger-live-sync.toml. Worst of the five: produces_member_alert is true, so a sync run would silently stop the live banger board updating during the session with nothing to indicate it.",
};

/**
 * TOMLs that declare a cron in a spelling the generator does not parse.
 *
 * `parseTomlCron` matches `^cronSchedule\s*=` only. A file using the `[[cron]]` table form is
 * SKIPPED with a `console.warn` and never reaches the manifest — the job simply never runs, and
 * nothing downstream says so.
 */
const UNPARSEABLE_TOML_SPELLING: Record<string, string> = {
  "largo-morning-brief":
    "Declares `[[cron]] schedule = \"25 13 * * 1-5\"`, which sync-cron-schedules.mjs skips, so this job has never been scheduled. NOT corrected here on purpose: rewriting the spelling would cause the next sync to switch on a member-facing pre-open push cron as a side effect of a metadata fix. Whether to run it at all is a product decision for the coordinator — either schedule it deliberately or delete the TOML.",
};

/** `cronSchedule = "..."` — the only spelling blackout-infra's generator parses. */
function parseableCron(toml: string): string | null {
  return /^cronSchedule\s*=\s*"([^"]+)"/m.exec(toml)?.[1] ?? null;
}

/** Any cron declaration, including the `[[cron]] schedule = "..."` form the generator ignores. */
function anyCron(toml: string): string | null {
  return parseableCron(toml) ?? /^\s*schedule\s*=\s*"([^"]+)"/m.exec(toml)?.[1] ?? null;
}

function readToml(key: string): string | null {
  try {
    return readFileSync(join(REPO_ROOT, `railway.${key}.toml`), "utf8");
  } catch {
    return null;
  }
}

test("every registry schedule_cron_utc matches the railway TOML the manifest is generated from", () => {
  const drifted: string[] = [];

  for (const job of CRON_JOBS) {
    if (!job.schedule_cron_utc) continue;
    const toml = readToml(job.key);
    if (!toml) {
      if (job.key in NO_BACKING_TOML) continue;
      drifted.push(
        `${job.key}: registry advertises "${job.schedule_cron_utc}" but there is no railway.${job.key}.toml. ` +
          `Its manifest entry (if any) is a hand-edit that a sync run will delete.`
      );
      continue;
    }
    const declared = parseableCron(toml);
    if (declared == null) {
      if (job.key in UNPARSEABLE_TOML_SPELLING) continue;
      drifted.push(
        `${job.key}: railway.${job.key}.toml declares no \`cronSchedule = "..."\` line, so the generator ` +
          `skips it and the job never reaches the deployed manifest — while the registry advertises ` +
          `"${job.schedule_cron_utc}", which suppresses its staleness alarm.`
      );
      continue;
    }
    if (declared !== job.schedule_cron_utc) {
      drifted.push(
        `${job.key}: registry says "${job.schedule_cron_utc}" but railway.${job.key}.toml says "${declared}".`
      );
    }
  }

  assert.deepEqual(
    drifted,
    [],
    "A registry `schedule_cron_utc` that disagrees with the TOML is not a stale comment — the health " +
      "board uses it to decide when NOT to alert, so a wrong one buys silence for a job that may be " +
      "dead. Update whichever side is wrong:\n  " + drifted.join("\n  ")
  );
});

test("no registry entry advertises a schedule for a job with no parseable TOML", () => {
  // The inverse framing of the same invariant, aimed at the specific regression that motivated it:
  // re-adding `schedule_cron_utc` to a job that is still dark. Restoring such a line is only correct
  // in the SAME change that actually schedules the job.
  for (const key of Object.keys(UNPARSEABLE_TOML_SPELLING)) {
    const job = CRON_JOBS.find((j) => j.key === key);
    if (!job) continue;
    assert.equal(
      job.schedule_cron_utc,
      undefined,
      `${key} has no parseable TOML, so it is not in the generated manifest and does not fire. ` +
        `Carrying a schedule_cron_utc for it suppresses the "NEVER logged a run" alarm — measured 48/48 ` +
        `half-hour probes across a weekday for largo-morning-brief. Schedule the job first, then restore the field.`
    );
  }
});

test("every railway TOML that declares a cron uses the spelling the generator parses", () => {
  const unparseable: string[] = [];

  for (const file of readdirSync(REPO_ROOT)) {
    if (!file.startsWith("railway.") || !file.endsWith(".toml") || file === "railway.toml") continue;
    const key = file.replace(/^railway\./, "").replace(/\.toml$/, "");
    const toml = readFileSync(join(REPO_ROOT, file), "utf8");
    if (anyCron(toml) == null) continue; // not a cron trigger service
    if (parseableCron(toml) != null) continue;
    if (key in UNPARSEABLE_TOML_SPELLING) continue;
    unparseable.push(
      `${file} declares a cron the generator cannot read (it matches \`^cronSchedule =\` only), so this ` +
        `job is skipped with a console.warn and never scheduled.`
    );
  }

  assert.deepEqual(
    unparseable,
    [],
    "A TOML the generator skips produces no error anywhere — the job simply never runs:\n  " +
      unparseable.join("\n  ")
  );
});

test("both exemption lists carry a real reason for each entry", () => {
  // Same discipline as cron-registry.test.ts's INTENTIONALLY_UNREGISTERED: a bare key set would
  // quietly become the place schedules go to stop being checked.
  for (const [key, reason] of [
    ...Object.entries(NO_BACKING_TOML),
    ...Object.entries(UNPARSEABLE_TOML_SPELLING),
  ]) {
    assert.ok(reason.length > 40, `${key} needs a real reason, not a placeholder`);
  }
});
