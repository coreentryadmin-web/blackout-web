#!/usr/bin/env node
/**
 * CRON SCHEDULE COVERAGE — is every cron route actually reachable by a scheduler?
 *
 * WHY THIS EXISTS. On 2026-08-10 Largo was asked which desk had been more right this month. It
 * correctly reached for `get_helix_signal_outcomes` and got "0 graded samples". Every part of that
 * feature shipped — table, job, cron route, reader, Largo tool, the /flows panel that renders it —
 * except an entry in `cron-jobs.json`. The route had never been called in production, so the table
 * had never been written, so every consumer honestly reported zero.
 *
 * Nothing failed. Not a test, not an error log, not an alert. A fully-built feature sat dark for
 * weeks and the only symptom was a truthful "0 samples" that reads like "nothing happened".
 *
 * The gap is structural: a route lives in blackout-web, its schedule lives in blackout-infra, and
 * no check spans the two. This is that check.
 *
 * WHY IT IS A SCRIPT AND NOT A CI TEST. The schedule file is in the OTHER repository. A unit test
 * in blackout-web cannot read it in CI without checking out blackout-infra, and a test that
 * silently skips when the file is absent would pass in CI forever — which is precisely the
 * failure mode being fixed here. A script that must be run, and that says plainly when it cannot
 * see the schedule, is more honest than a green test that checked nothing.
 *
 * Usage:
 *   node scripts/audit/cron-schedule-coverage.mjs [--infra ../blackout-infra] [--json]
 *
 * Exits non-zero when a route has no schedule and no documented reason.
 */

import { readdirSync, statSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const JSON_OUT = args.includes("--json");
const INFRA = (args.find((a) => a.startsWith("--infra=")) || "").split("=")[1] || "../blackout-infra";
const SCHEDULE = path.join(INFRA, "terraform/modules/crons/cron-jobs.json");
const ROUTES_DIR = "src/app/api/cron";

/**
 * Routes that are INTENTIONALLY unscheduled, each with the reason it is safe.
 *
 * This list is the point of the check. An unscheduled route is either a deliberate decision — in
 * which case it belongs here with its justification — or a feature nobody noticed was dark. Adding
 * a route without adding it here fails the check, which forces the question to be answered rather
 * than assumed.
 *
 * Verified 2026-08-10 by reading each route.
 */
const INTENTIONALLY_UNSCHEDULED = {
  "vector-bead-record":
    "Backup + observability only. The primary 5s cadence is the in-process vector-bead-recorder-leader, which does run; the route says so in its first line.",
  "x-engage":
    "Outward-facing social posting, gated on xApiEnabled + xMarketingSilentOnly. Enabling it publishes on our behalf and is a business decision, not a scheduling oversight.",
  "vector-alerts":
    "Inert without VECTOR_ALERTS_PUSH, which is NOT set in blackout-production/app/env (verified 2026-08-22 by key name) — the route returns {ok:true,inert:true} even when called, so scheduling it would change nothing. Turning it on is a product decision (a new member-facing push channel), not a scheduling oversight. NOTE: members' rules ARE mirrored to Postgres by VectorPageShell.persistRules for this cron to read, and the panel only ever promises background-TAB delivery, never closed-tab — so nothing member-facing is broken while it sleeps. See docs/audit/VECTOR-MAP.md section 7.",
};

function fail(msg) {
  console.error(msg);
  process.exit(2);
}

if (!existsSync(ROUTES_DIR)) fail(`no ${ROUTES_DIR} — run from the blackout-web repo root`);
if (!existsSync(SCHEDULE)) {
  // Stated loudly rather than skipped quietly. A silent skip is how the original bug survived.
  fail(
    `CANNOT CHECK: ${SCHEDULE} not found.\n` +
      `This check spans two repos — clone blackout-infra beside blackout-web, or pass --infra=<path>.\n` +
      `Exiting non-zero: "could not check" must never read as "checked and fine".`
  );
}

const routes = readdirSync(ROUTES_DIR)
  .filter((d) => statSync(path.join(ROUTES_DIR, d)).isDirectory())
  .sort();

const schedule = JSON.parse(readFileSync(SCHEDULE, "utf8"));
const scheduled = new Set(
  (schedule.jobs ?? []).map((j) => String(j.path ?? "").replace("/api/cron/", ""))
);

const unscheduled = routes.filter((r) => !scheduled.has(r));
const undocumented = unscheduled.filter((r) => !INTENTIONALLY_UNSCHEDULED[r]);
const documented = unscheduled.filter((r) => INTENTIONALLY_UNSCHEDULED[r]);
// A schedule pointing at a route that no longer exists fires forever into a 404.
const orphans = [...scheduled].filter((k) => k && !routes.includes(k)).sort();

if (JSON_OUT) {
  console.log(JSON.stringify({ routes: routes.length, scheduled: scheduled.size, undocumented, documented, orphans }, null, 2));
} else {
  console.log(`cron routes: ${routes.length} · scheduled: ${scheduled.size}\n`);
  if (documented.length) {
    console.log("Intentionally unscheduled:");
    for (const d of documented) console.log(`  - ${d}: ${INTENTIONALLY_UNSCHEDULED[d]}`);
    console.log("");
  }
  if (orphans.length) {
    console.log("SCHEDULED BUT NO ROUTE (fires into a 404):");
    for (const o of orphans) console.log(`  - ${o}`);
    console.log("");
  }
  if (undocumented.length) {
    console.log("UNSCHEDULED AND UNEXPLAINED — a feature may be silently dark:");
    for (const u of undocumented) console.log(`  - ${u}`);
    console.log(
      "\nEither add it to cron-jobs.json, or add it to INTENTIONALLY_UNSCHEDULED in this file\n" +
        "with the reason it is safe. Leaving it unlisted is how helix-signal-outcomes stayed dark."
    );
  } else if (!orphans.length) {
    console.log("Every cron route is either scheduled or documented as intentionally not.");
  }
}

process.exit(undocumented.length || orphans.length ? 1 : 0);
