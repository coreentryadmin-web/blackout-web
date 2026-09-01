#!/usr/bin/env node

/**
 * HELIX RTH (Regular Trading Hours) Re-measurement — Item 8 of the HELIX Phase 1 certification.
 *
 * WHAT THIS ACTUALLY DOES (rewritten 2026-08-29 — the prior version was a stub, see below).
 * Spawns the REAL `helix-tape-inventory.mjs --json` against a live target and reports its
 * numbers, honestly labeled with the market phase the run actually happened in. Nothing here
 * reimplements what that script measures — it is the single source of truth for tape population,
 * writer split, route breakdown, IV units, and signal eligibility; this file only spawns it,
 * parses its JSON, and formats a comparison against the 2026-08-22 weekend baseline.
 *
 * WHY THE PRIOR VERSION WAS WORSE THAN NOTHING. `measureHelix()` was a stub: it printed a banner,
 * suggested the command a human could run, and returned an empty measurement object. `--compare`
 * printed a warning and compared nothing. The script always exited 0. It was marked "FRAMEWORK
 * COMPLETE — ready for RTH execution" in docs/audit/HELIX-PHASE1-COMPLETION-STATUS.md on
 * 2026-08-24 and never corrected — a run of it looked identical whether HELIX was healthy,
 * broken, or the script had simply never been implemented, because it was never implemented.
 *
 * THE BASELINE'S SIGNAL-ELIGIBILITY FIGURE IS ALREADY SETTLED, NOT SOMETHING THIS RUN TESTS.
 * The 2026-08-22 baseline's 30% eligibility was the SPX/SPY `event_at` parse bug; #2723 fixed it
 * and HELIX-MAP.md's own framing was inverted by #2744 once it was re-measured at 100%. This
 * script still prints the baseline for the historical record, but does not present eligibility as
 * an open question — the other five metrics (writer split, route breakdown, GEX proximity, IV
 * distribution, real-print span) are live population facts that legitimately move session to
 * session and are what a fresh RTH run is actually for.
 *
 * AN OFF-HOURS RUN IS NOT AN RTH VALIDATION. `getMarketPhase()` labels every run's market phase
 * and the summary says so explicitly — this script will run and report real numbers at any hour,
 * but only a run inside 9:30 AM-4:00 PM ET actually satisfies Item 8's original purpose (confirm
 * the weekend baseline holds under live trading conditions, not a settled/quiet tape).
 *
 * Run from REPO ROOT with NODE_USE_ENV_PROXY=1 (Node 20 — this script spawns a `--import tsx`
 * child, same runtime requirement as helix-tape-inventory.mjs itself):
 *   node scripts/audit/helix-rth-measurement.mjs [--json] [--base=URL] [--limit=N] [--since-hours=N]
 *
 * Exits non-zero if the underlying measurement fails to run at all (never silently "succeeds").
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");

const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};
const flag = (name) => argv.includes(`--${name}`);

const BASE = arg("base", process.env.VALIDATE_BASE ?? "https://blackouttrades.com");
const LIMIT = arg("limit", "5000");
const SINCE_HOURS = arg("since-hours", "168");
const AS_JSON = flag("json");

/**
 * BASELINE from the 2026-08-22 weekend run (docs/audit/HELIX-MAP.md). Deliberately does NOT
 * include a route-breakdown baseline: that vocabulary itself changed (#2647 retired OTHER for
 * UNREPORTED and added REPEAT), so there is no stale-safe way to diff old bucket names against
 * new ones — the live breakdown is reported on its own below instead.
 */
const BASELINE = {
  date: "2026-08-22",
  signal_eligible_pct: 30, // SETTLED — see the file header. Historical record only.
  group_a_rows: 1500,
  group_b_rows: 3500,
  gex_proximity_pct: 2.2,
  iv_median: 0.17,
  iv_max: 106.2,
  span_hours: 168,
};

function getMarketPhase() {
  const now = new Date();
  const utcTime = now.getUTCHours() * 60 + now.getUTCMinutes();
  const day = now.getUTCDay(); // 0=Sun, 6=Sat
  if (day === 0 || day === 6) return "WEEKEND";
  if (utcTime >= 13 * 60 + 30 && utcTime < 20 * 60) return "RTH (9:30 AM - 4:00 PM ET)";
  if (utcTime >= 20 * 60 && utcTime < 21 * 60) return "POST-CLOSE (4:00 PM - 5:00 PM ET)";
  if (utcTime >= 12 * 60 && utcTime < 13 * 60 + 30) return "PRE-MARKET (~8:00 AM - 9:30 AM ET)";
  return "OFF-HOURS";
}

/** Spawn the real inventory harness and parse its --json output. Never reimplements its logic. */
async function runTapeInventory() {
  const scriptPath = path.join(REPO_ROOT, "scripts/audit/helix-tape-inventory.mjs");
  const args = [
    "--import", "tsx",
    scriptPath,
    `--limit=${LIMIT}`,
    `--since-hours=${SINCE_HOURS}`,
    `--base=${BASE}`,
    "--json",
  ];
  // 90s: the underlying script mints a Clerk session, fetches up to 5000 rows, and does field-
  // presence/route/IV analysis over all of them — generous on purpose, matching the tunnel's own
  // documented preference for a deadline chosen on purpose over a silently-truncated run.
  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    args,
    { cwd: REPO_ROOT, timeout: 90_000, maxBuffer: 32 * 1024 * 1024 }
  );
  if (stdout.trim().startsWith("SKIP:")) return { skip: true, reason: stdout.trim() };
  try {
    return { skip: false, report: JSON.parse(stdout) };
  } catch (e) {
    throw new Error(`helix-tape-inventory.mjs did not return parseable JSON: ${e.message}\nstderr: ${stderr.slice(0, 500)}`);
  }
}

function compareLine(label, baseline, live, unit = "") {
  const delta = live == null || baseline == null ? "" : ` (${live >= baseline ? "+" : ""}${(live - baseline).toFixed(1)}${unit})`;
  return `  ${label.padEnd(28)} baseline ${String(baseline ?? "—").padStart(8)}${unit}   live ${String(live ?? "—").padStart(8)}${unit}${delta}`;
}

async function main() {
  const phase = getMarketPhase();
  const isRth = phase.startsWith("RTH");

  let result;
  try {
    result = await runTapeInventory();
  } catch (e) {
    console.error(`HELIX RTH measurement FAILED to run: ${e.message}`);
    process.exit(1);
  }

  if (result.skip) {
    console.log(result.reason);
    process.exit(0);
  }

  const r = result.report;
  const rows = r.response?.rows ?? null;
  const routePct = (n) => (n != null && rows ? Math.round((1000 * n) / rows) / 10 : null);
  const live = {
    signal_eligible_pct: r.signal_eligibility?.eligible_pct ?? null,
    group_a_rows: r.writers?.A?.rows ?? null,
    group_b_rows: r.writers?.B?.rows ?? null,
    // The baseline's OTHER/FLOOR/SWEEP vocabulary is itself stale — #2647 replaced OTHER with
    // UNREPORTED and added REPEAT (measured live 2026-08-29: {UNREPORTED, REPEAT, FLOOR, SWEEP},
    // no OTHER key at all). Forcing today's numbers into the old bucket names would compare two
    // different vocabularies as if they were the same metric, so report the live breakdown as its
    // own thing rather than diffing it against a baseline shaped for a bucketing that no longer
    // ships.
    route_breakdown_pct: Object.fromEntries(
      Object.entries(r.route_breakdown ?? {}).map(([k, n]) => [k, routePct(n)])
    ),
    gex_proximity_pct: r.field_presence_pct?.gex_proximity?.all ?? null,
    iv_median: r.iv_units?.median ?? null,
    iv_max: r.iv_units?.max ?? null,
    span_hours: r.tape_shape?.real_print_span_minutes != null
      ? Math.round((r.tape_shape.real_print_span_minutes / 60) * 10) / 10
      : null,
  };

  const summary = {
    timestamp: new Date().toISOString(),
    market_phase: phase,
    is_rth: isRth,
    rows_measured: r.response?.rows ?? null,
    baseline: BASELINE,
    live,
  };

  if (AS_JSON) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log("=== HELIX RTH Measurement ===\n");
    console.log(`Timestamp:    ${summary.timestamp}`);
    console.log(`Market phase: ${phase}`);
    if (!isRth) {
      console.log(`!! NOT RTH — this run reports real numbers, but does not satisfy Item 8's`);
      console.log(`   original purpose (confirm the baseline holds under LIVE market conditions).`);
      console.log(`   Re-run 9:30 AM-4:00 PM ET on a weekday for an actual RTH validation.`);
    }
    console.log(`Rows measured: ${summary.rows_measured}\n`);
    console.log(`Signal eligibility is a SETTLED question (fixed by #2723, re-measured 100% and`);
    console.log(`documented in HELIX-MAP.md via #2744) — shown for the historical record, not as`);
    console.log(`something this run is testing:`);
    console.log(compareLine("signal_eligible_pct", BASELINE.signal_eligible_pct, live.signal_eligible_pct, "%"));
    console.log();
    console.log("Live population facts (these DO legitimately move session to session):");
    console.log(compareLine("group_a_rows (UW flow)", BASELINE.group_a_rows, live.group_a_rows));
    console.log(compareLine("group_b_rows (SPX/SPY)", BASELINE.group_b_rows, live.group_b_rows));
    console.log(compareLine("gex_proximity_pct", BASELINE.gex_proximity_pct, live.gex_proximity_pct, "%"));
    console.log(compareLine("iv_median", BASELINE.iv_median, live.iv_median));
    console.log(compareLine("iv_max", BASELINE.iv_max, live.iv_max));
    console.log(compareLine("span_hours", BASELINE.span_hours, live.span_hours, "h"));
    console.log();
    console.log("Live route breakdown (no baseline — #2647 changed the bucket vocabulary itself):");
    for (const [k, pctVal] of Object.entries(live.route_breakdown_pct)) {
      console.log(`  ${String(pctVal).padStart(6)}%  ${k}`);
    }
    console.log(`\nFull underlying report: re-run with --json, or invoke helix-tape-inventory.mjs`);
    console.log(`directly for every field this summary condenses.`);
  }

  process.exit(0);
}

main().catch((e) => {
  console.error("HELIX RTH measurement crashed:", e);
  process.exit(1);
});
