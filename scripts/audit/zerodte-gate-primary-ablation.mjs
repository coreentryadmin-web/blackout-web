#!/usr/bin/env node
/**
 * 0DTE PRIMARY-GATE-ONLY ablation study — G-1 / G-4 / G-10 / G-12 / G-13 Blocked WR (and
 * a modeled EV) vs the committed ledger's Passed WR/EV.
 *
 * WHY THIS EXISTS. The operator's CTO review (2026-09-09) asked whether G-1 (tape
 * alignment), G-4 (VIX regime), G-10 (intraday structure), G-12 (confluence floor) and
 * G-13 (flow-accumulation conflict) measure overlapping "does the environment agree with
 * this direction" phenomena. The FULL answer needs `blocks_json` (every gate a rejection
 * failed, not just the first) to accumulate a real sample — see
 * `docs/audit/findings-staging/2026-09-09-zerodte-rejection-log-primary-gate-only.md`,
 * the same-day fix that added that field going forward. That finding's own closing line
 * names the SMALLER thing that is buildable right now without waiting: a
 * primary-gate-only (i.e. `gate_failed`, the column that has existed since day one and
 * already has history) Blocked WR/EV comparison via the counterfactual grader
 * (`src/lib/zerodte/skip-grading.ts`) that already exists, cross-referenced against the
 * committed ledger's Passed WR/EV. This script IS that restricted study.
 *
 * WHAT IT DOES NOT DO (read before trusting a "G-X barely blocks anything" reading):
 * - It does NOT measure gate overlap directly — a row that failed both G-1 and G-12 is
 *   attributed ONLY to whichever evaluates FIRST in `evaluateZeroDteGates` (G-1, in this
 *   stack's fixed order), so G-1's blocked-n is inflated and every later gate's is
 *   deflated relative to "how often did this gate alone matter". See
 *   `scripts/audit/lib/gate-primary-ablation-eval.mjs`'s module doc for the exact
 *   evaluation-order evidence this claim rests on.
 * - It does NOT report real premium P&L for blocked plays. Rejection rows carry no OCC
 *   (no contract plan exists at block time), so skip-grading.ts can only grade them
 *   underlying-direction-only — a discrete win/lose call, no tradeable magnitude. The
 *   "assumed EV" printed for the blocked side is a MODELED number (the measured win rate
 *   run through the SAME fixed -50%/+100% payoff the rest of the 0DTE ledger already uses
 *   for its own breakeven math), clearly distinguished from the passed side's REAL
 *   mechanical-plan P&L. Never read the two EV numbers as the same kind of measurement.
 * - It does NOT gate anything. Read-only, evidence-only — same discipline as every other
 *   A/B script in this toolkit (cortex-oppose-magnitude-ab.mjs, tier-exit-mode-ab.mjs).
 *
 * DATA SOURCES (both already-shipped, admin-gated HTTP surfaces — nothing here writes
 * anything except the SAME idempotent, bounded skip-grading backfill
 * `gate-calibration-live-report.mjs` already triggers):
 *   POST /api/market/zerodte/calibration?grade_skips=1  — counterfactually grades any
 *     still-ungraded rejection in the window (idempotent: only ever fills NULL cells).
 *   GET  /api/market/zerodte/calibration?days=N — `blocked_value[]`, the graded skips
 *     already aggregated by PRIMARY gate_failed code (calibration.ts's blockedValueLines).
 *   GET  /api/market/zerodte/record?days=N — the committed ledger; `mechanical` is the
 *     SAME fixed -50/+100/15:50 plan grade skip-grading.ts's premium-basis path would use,
 *     so it (not the as-managed headline) is the correct "Passed" comparison target.
 *
 * USAGE
 *   env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY \
 *   node --import tsx scripts/audit/zerodte-gate-primary-ablation.mjs \
 *        [--days=90] [--skip-grade-days=14] [--no-grade] [--min-n=10] [--base=https://blackouttrades.com] [--json]
 */
import { mintClerkPremiumSession } from "./lib/prod-clerk-session.mjs";
import {
  evaluateAllGatesPrimaryAblation,
  platformWideSkipGradingHealth,
} from "./lib/gate-primary-ablation-eval.mjs";

function parseArgs(argv) {
  const args = {
    days: 90,
    skipGradeDays: 14,
    grade: true,
    minN: 10,
    json: false,
    base: process.env.VALIDATE_BASE || "https://blackouttrades.com",
  };
  for (const a of argv) {
    if (a === "--json") args.json = true;
    else if (a === "--no-grade") args.grade = false;
    else if (a.startsWith("--days=")) args.days = Math.max(1, Math.min(90, Number(a.slice(7)) || 90));
    else if (a.startsWith("--skip-grade-days=")) args.skipGradeDays = Math.max(1, Math.min(14, Number(a.slice(18)) || 14));
    else if (a.startsWith("--min-n=")) args.minN = Math.max(1, Number(a.slice(8)) || 10);
    else if (a.startsWith("--base=")) args.base = a.slice(7);
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

function line(ch = "─", n = 90) {
  return ch.repeat(n);
}
function pct(n) {
  return n == null ? "n/a" : `${n.toFixed(1)}%`;
}
function ptsSigned(n) {
  return n == null ? "n/a" : `${n >= 0 ? "+" : ""}${n.toFixed(1)}pts`;
}

function printRow(row) {
  console.log(`\n  ${row.gate}  ${row.label}`);
  console.log(`    codes: ${row.codes.length ? row.codes.join(", ") : "(none — see verdict)"}`);
  console.log(`    verdict: ${row.verdict.toUpperCase()}`);
  if (row.verdict === "not_measurable") {
    console.log(`    ${row.blocked.reason}`);
    return;
  }
  const b = row.blocked;
  console.log(
    `    BLOCKED  n=${b.n}  wins=${b.wins}  ungradeable=${b.ungradeable}  ` +
      `WR=${pct(b.win_rate_pct)}${b.win_rate_ci_pct ? ` (95% CI [${pct(b.win_rate_ci_pct.lo)}, ${pct(b.win_rate_ci_pct.hi)}])` : ""}  ` +
      `assumed-EV(model)=${pct(b.assumed_ev_pct)}  basis(premium=${b.by_basis.premium}, underlying=${b.by_basis.underlying})`
  );
  if (b.ungradeable_reasons?.length) {
    for (const r of b.ungradeable_reasons) console.log(`        ungradeable (${r.n}x): ${r.reason}`);
  }
  if (row.passed) {
    console.log(
      `    PASSED   n=${row.passed.graded ?? "?"}  WR=${pct(row.passed.win_rate_pct)}  ` +
        `EV(real, mechanical plan)=${pct(row.passed.avg_pnl_pct)}`
    );
  } else {
    console.log(`    PASSED   (ledger unavailable this run)`);
  }
  console.log(`    delta (Passed WR − Blocked WR): ${ptsSigned(row.delta_win_rate_pts_passed_minus_blocked)}`);
  if (row.verdict === "low_n") {
    console.log(`    [low_n] blocked n=${b.n} is under the min-meaningful-n floor (${row.min_meaningful_n}) — treat as a hint, not a verdict.`);
  }
  if (row.verdict === "no_rejections_in_window") {
    console.log(`    no rejections for this gate's codes were observed in the window — nothing to compare yet.`);
  }
  if (row.verdict === "all_ungradeable") {
    console.log(
      `    the gate DID fire (${b.ungradeable} rejection${b.ungradeable === 1 ? "" : "s"} logged) but every one graded ` +
        `ungradeable — real rejection volume with a data-availability gap, NOT an absence of blocks. See the reasons above.`
    );
  }
}

async function main() {
  let session;
  try {
    session = await mintClerkPremiumSession({ appUrl: args.base });
    if (session.skip) {
      console.log(`SKIP — ${session.reason ?? "Clerk credentials unavailable in this environment"}`);
      process.exitCode = 0;
      return;
    }
    const headers = { Cookie: session.cookieHeader, Accept: "application/json" };

    if (args.grade) {
      console.log(`[1] Backfilling counterfactual grades — POST ?grade_skips=1, window=${args.skipGradeDays}d…`);
      const gradeRes = await fetch(`${args.base}/api/market/zerodte/calibration?grade_skips=1`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ days: args.skipGradeDays }),
      });
      const gradeJson = await gradeRes.json().catch(() => ({}));
      if (!gradeRes.ok || gradeJson.ok === false) {
        console.error(`    grade_skips FAILED (HTTP ${gradeRes.status}):`, JSON.stringify(gradeJson));
      } else {
        console.log(
          `    since=${gradeJson.since ?? "?"} scanned=${gradeJson.scanned ?? 0} graded=${gradeJson.graded ?? 0} ` +
            `ungradeable=${gradeJson.ungradeable ?? 0} errors=${gradeJson.errors ?? 0}`
        );
      }
    } else {
      console.log("[1] --no-grade — skipping the counterfactual backfill, reading whatever is already graded");
    }

    console.log(`\n[2] Fetching the calibration report (days=${args.days})…`);
    const calRes = await fetch(`${args.base}/api/market/zerodte/calibration?days=${args.days}`, { headers });
    const calReport = await calRes.json().catch(() => ({}));
    if (!calRes.ok || calReport.available === false) {
      console.error(`    calibration GET FAILED (HTTP ${calRes.status}):`, JSON.stringify(calReport).slice(0, 500));
      process.exitCode = 1;
      return;
    }
    const blockedValueLines = Array.isArray(calReport.blocked_value) ? calReport.blocked_value : [];

    console.log(`[3] Fetching the committed ledger record (days=${args.days})…`);
    const recRes = await fetch(`${args.base}/api/market/zerodte/record?days=${args.days}`, { headers });
    const record = await recRes.json().catch(() => ({}));
    let passed = null;
    if (recRes.ok && record.available !== false && record.mechanical) {
      passed = {
        graded: record.mechanical.graded ?? null,
        win_rate_pct: record.mechanical.win_rate_pct ?? null,
        avg_pnl_pct: record.mechanical.avg_pnl_pct ?? null,
      };
    } else {
      console.error(`    record GET FAILED or degraded (HTTP ${recRes.status}) — Passed side will read "unavailable"`);
    }

    const rows = evaluateAllGatesPrimaryAblation({ blockedValueLines, passed, minMeaningfulN: args.minN });
    const platformHealth = platformWideSkipGradingHealth(blockedValueLines);

    if (args.json) {
      console.log("\n<<<JSON>>>");
      console.log(
        JSON.stringify(
          {
            window_days: args.days,
            skip_grade_backfill_days: args.grade ? args.skipGradeDays : null,
            passed_source: "GET /api/market/zerodte/record — mechanical (fixed -50/+100/15:50 plan grade over committed rows)",
            blocked_source: "GET /api/market/zerodte/calibration — blocked_value (skip-grading.ts counterfactual, primary gate_failed code only)",
            platform_wide_skip_grading_health: platformHealth,
            gates: rows,
          },
          null,
          2
        )
      );
      return;
    }

    console.log(`\n${line("═")}`);
    console.log("  0DTE PRIMARY-GATE-ONLY ABLATION — G-1 / G-4 / G-10 / G-12 / G-13");
    console.log(line("═"));
    console.log(`\n  window: ${calReport.window?.since ?? "?"} .. ${calReport.window?.through ?? "?"} (${calReport.window?.days ?? args.days}d)`);
    console.log(`  min-meaningful-n floor: ${args.minN} (same bar as calibration.ts's ENFORCE_MIN_BLOCK_N)`);
    console.log(
      "  CAVEAT (read this before comparing rows): a rejection is attributed to only the FIRST gate that " +
        "failed in evaluation order (G-1 evaluates before G-12/G-13/G-4) — this undercounts every later " +
        "gate's true blocked population and overcounts the earliest one's. See this script's own header."
    );

    for (const row of rows) printRow(row);

    if (platformHealth.systemic_zero_graded) {
      console.log(`\n${line("!")}`);
      console.log(
        `  WARNING: platform-wide skip-grading appears to be producing ZERO gradeable rows right now — ` +
          `not specific to these 5 gates. All ${platformHealth.total_gate_codes_observed} gate codes present ` +
          `in this window's blocked_value report show n=0 graded against ${platformHealth.total_ungradeable} ` +
          `ungradeable rows (this may be capped by the report's own fetch limit, i.e. an UNDERCOUNT of the true ` +
          `ungradeable total). If this persists, the primary-gate-only (and any future full blocks_json) ablation ` +
          `has NO usable sample for ANY gate until the underlying-bar reconstruction path is fixed — see ` +
          `docs/audit/0DTE-RESEARCH.md for this run's evidence and the follow-up this was flagged as.`
      );
      console.log(line("!"));
    }

    console.log(`\n${line("═")}`);
    console.log("  Read-only measurement. No gate/threshold was changed by this run.");
    console.log(
      "  \"assumed-EV(model)\" on the blocked side is NOT measured premium P&L — it is the measured win " +
        "rate run through the fixed -50/+100 plan payoff. \"EV(real, mechanical plan)\" on the passed side IS " +
        "real, measured option-premium P&L over the same fixed plan. Never blend the two."
    );
    console.log(line("═"));
  } finally {
    await session?.cleanup?.();
  }
}

main().catch((err) => {
  console.error("zerodte-gate-primary-ablation FAILED:", err?.stack ?? err);
  process.exitCode = 1;
});
