#!/usr/bin/env node
/**
 * BANGER EXIT TRAIL-SWEEP OPTIMIZATION GRID (operator directive 2026-09-27, follow-up to PR #5517's
 * head-to-head validation). Sweeps partial trigger (100-200%, 25% steps), partial fraction
 * (33/50/67%), and runner trailing-stop (40/50/60/70% of peak) -- 60 configs total, INCLUDING the
 * exact current production configuration (trigger=100, fraction=0.5, trail=0.5) as the control in
 * every table, with incremental gain/loss vs that control computed for every metric.
 *
 * THIS SCRIPT CHANGES NOTHING IN PRODUCTION. Read-only. Data only, per the operator's explicit
 * instruction -- no recommendation, no shipping decision.
 *
 * METHODOLOGY: see lib/banger-exit-trail-grid-eval.mjs's header for the full derivation of the
 * trail-percentage reconstruction (a disclosed, tested extension of PR #5517's synthetic-return
 * reconstruction) and why the control cell is EXACT, not approximate.
 *
 * USAGE
 *   node --import tsx scripts/audit/banger-exit-trail-optimization-grid.mjs [--days=270] [--base=...] [--csv-dir=...] [--json]
 */
import { fetchAuditJson, releaseAuditClerkSession } from "./lib/audit-auth-fetch.mjs";
import { runTrailGrid, paretoFrontier, PRODUCTION_CONFIG } from "./lib/banger-exit-trail-grid-eval.mjs";
import { splitByDateHalves } from "./lib/swing-exit-optimization-eval.mjs";
import { writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const flag = (name, def) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=").slice(1).join("=") : def;
};
const DAYS = Math.min(365, Math.max(1, Number(flag("days", "270")) || 270));
const BASE = flag("base", "https://blackouttrades.com");
const CSV_DIR = flag("csv-dir", null);
const JSON_OUT = args.includes("--json");

function finite(x) {
  return typeof x === "number" && Number.isFinite(x);
}
function fmt(x, d = 1) {
  return x == null || x === Infinity ? (x === Infinity ? "∞" : "n/a") : Number(x).toFixed(d);
}

function delta(a, b) {
  return finite(a) && finite(b) ? Math.round((a - b) * 100) / 100 : null;
}

/** Builds the incremental-vs-control view for one metric bundle. */
function withControlDeltas(cell, control) {
  return {
    ...cell,
    vsControl: {
      expectancy: delta(cell.expectancy, control.expectancy),
      profitFactor: delta(cell.profitFactor === Infinity ? null : cell.profitFactor, control.profitFactor === Infinity ? null : control.profitFactor),
      maxDrawdownPts: delta(cell.maxDrawdownPts, control.maxDrawdownPts),
      medianRealized: delta(cell.medianRealized, control.medianRealized),
      winRate: delta(cell.winRate, control.winRate),
      flippedToLoserRatePct: delta(cell.flippedToLoserRatePct, control.flippedToLoserRatePct),
      degradedRatePct: delta(cell.degradedRatePct, control.degradedRatePct),
    },
  };
}

function toCsvRow(c) {
  return [
    c.key, c.triggerPct, Math.round(c.fraction * 100), Math.round(c.trailFrac * 100), c.isControl ? 1 : 0,
    c.n, fmt(c.reachRatePct), fmt(c.winRate), fmt(c.medianRealized), fmt(c.expectancy), fmt(c.profitFactor),
    fmt(c.maxDrawdownPts), fmt(c.totalReturnPts),
    c.actualWinnersN, c.flippedToLoserN, fmt(c.flippedToLoserRatePct),
    c.largeWinnersN, c.degradedN, fmt(c.degradedRatePct),
    c.early?.n ?? "", fmt(c.early?.expectancy), fmt(c.early?.winRate), fmt(c.early?.medianRealized), fmt(c.early?.profitFactor), fmt(c.early?.maxDrawdownPts), fmt(c.early?.flippedToLoserRatePct),
    c.late?.n ?? "", fmt(c.late?.expectancy), fmt(c.late?.winRate), fmt(c.late?.medianRealized), fmt(c.late?.profitFactor), fmt(c.late?.maxDrawdownPts), fmt(c.late?.flippedToLoserRatePct),
    fmt(c.vsControl?.expectancy), fmt(c.vsControl?.profitFactor), fmt(c.vsControl?.maxDrawdownPts), fmt(c.vsControl?.medianRealized), fmt(c.vsControl?.winRate), fmt(c.vsControl?.flippedToLoserRatePct), fmt(c.vsControl?.degradedRatePct),
    c.isPareto ? 1 : 0,
  ].join(",");
}
const CSV_HEADER = [
  "key", "trigger_pct", "fraction_pct", "trail_pct", "is_control",
  "n", "reach_rate_pct", "win_rate_pct", "median_return_pct", "expectancy_pct", "profit_factor",
  "max_drawdown_pts", "total_return_pts",
  "actual_winners_n", "winners_flipped_n", "winners_flipped_rate_pct",
  "large_winners_n", "large_winners_degraded_n", "large_winners_degraded_rate_pct",
  "early_n", "early_expectancy_pct", "early_win_rate_pct", "early_median_pct", "early_profit_factor", "early_max_drawdown_pts", "early_flipped_rate_pct",
  "late_n", "late_expectancy_pct", "late_win_rate_pct", "late_median_pct", "late_profit_factor", "late_max_drawdown_pts", "late_flipped_rate_pct",
  "vs_control_expectancy_pp", "vs_control_profit_factor", "vs_control_max_drawdown_pts", "vs_control_median_pp", "vs_control_win_rate_pp", "vs_control_flipped_rate_pp", "vs_control_degraded_rate_pp",
  "is_pareto_frontier",
].join(",");

async function main() {
  const res = await fetchAuditJson(BASE, `/api/admin/banger/closed-export?days=${DAYS}`);
  if (!res.ok || !Array.isArray(res.json?.rows)) {
    console.log("INSUFFICIENT DATA", { status: res.status });
    await releaseAuditClerkSession();
    process.exitCode = 1;
    return;
  }
  const rawRows = res.json.rows;
  const sorted = [...rawRows].sort((a, b) => Date.parse(a.closed_at ?? a.committed_at) - Date.parse(b.closed_at ?? b.committed_at));

  // ── Full-population grid (60 cells) ──
  const fullCells = runTrailGrid(sorted);
  const control = fullCells.find((c) => c.isControl);

  // ── Early/late walk-forward split, same 60 configs re-run independently on each half ──
  const split = splitByDateHalves(sorted, (r) => r.session_date);
  const earlyCells = runTrailGrid(split.early);
  const lateCells = runTrailGrid(split.late);
  const earlyByKey = new Map(earlyCells.map((c) => [c.key, c]));
  const lateByKey = new Map(lateCells.map((c) => [c.key, c]));

  // ── Pareto frontier (expectancy, |max drawdown|, winners-flipped rate) ──
  const frontier = paretoFrontier(fullCells);
  const frontierKeys = new Set(frontier.map((c) => c.key));

  const enriched = fullCells.map((c) => ({
    ...withControlDeltas(c, control),
    early: earlyByKey.get(c.key) ?? null,
    late: lateByKey.get(c.key) ?? null,
    isPareto: frontierKeys.has(c.key),
  }));

  if (CSV_DIR) {
    const lines = [CSV_HEADER, ...enriched.map(toCsvRow)];
    writeFileSync(`${CSV_DIR}/banger-trail-grid-full.csv`, lines.join("\n") + "\n");
    const frontierLines = [CSV_HEADER, ...enriched.filter((c) => c.isPareto).map(toCsvRow)];
    writeFileSync(`${CSV_DIR}/banger-trail-grid-pareto-frontier.csv`, frontierLines.join("\n") + "\n");
    console.error(`[csv] wrote ${enriched.length} configs to ${CSV_DIR}/banger-trail-grid-full.csv, ${frontier.length} on the frontier to banger-trail-grid-pareto-frontier.csv`);
  }

  const payload = {
    ok: true,
    days: DAYS,
    population: rawRows.length,
    controlConfig: PRODUCTION_CONFIG,
    control,
    cells: enriched,
    frontier,
    walkForwardSplit: { splitDate: split.splitDate, earlyN: split.early.length, lateN: split.late.length },
  };

  if (JSON_OUT) {
    console.log(JSON.stringify(payload, null, 2));
    await releaseAuditClerkSession();
    return;
  }

  console.log(`\n=== BANGER EXIT TRAIL-SWEEP OPTIMIZATION GRID (n=${rawRows.length}, ${DAYS}d window, 60 configs) ===\n`);
  console.log(`Control (exact production rule): trigger=100% fraction=50% trail=50%`);
  console.log(
    `  n=${control.n} expectancy=${fmt(control.expectancy)}% PF=${fmt(control.profitFactor)} medianReal=${fmt(control.medianRealized)}% ` +
    `winRate=${fmt(control.winRate)}% maxDD=${fmt(control.maxDrawdownPts)}pts flipped=${control.flippedToLoserN}/${control.actualWinnersN} (${fmt(control.flippedToLoserRatePct)}%) ` +
    `degraded=${control.degradedN}/${control.largeWinnersN} (${fmt(control.degradedRatePct)}%)`,
  );

  console.log(`\n--- All 60 configs, sorted by expectancy (vs-control delta shown as Δ) ---`);
  const rankedByExpectancy = [...enriched].sort((a, b) => (b.expectancy ?? -Infinity) - (a.expectancy ?? -Infinity));
  for (const c of rankedByExpectancy) {
    console.log(
      `  ${c.isControl ? "[CONTROL]" : c.isPareto ? "[PARETO] " : "         "} trig=${c.triggerPct}% frac=${Math.round(c.fraction * 100)}% trail=${Math.round(c.trailFrac * 100)}%  ` +
      `n=${c.n} exp=${fmt(c.expectancy)}%(Δ${fmt(c.vsControl.expectancy)}) PF=${fmt(c.profitFactor)}(Δ${fmt(c.vsControl.profitFactor)}) medianReal=${fmt(c.medianRealized)}%(Δ${fmt(c.vsControl.medianRealized)}) ` +
      `winRate=${fmt(c.winRate)}%(Δ${fmt(c.vsControl.winRate)}) maxDD=${fmt(c.maxDrawdownPts)}pts(Δ${fmt(c.vsControl.maxDrawdownPts)}) ` +
      `flipped=${fmt(c.flippedToLoserRatePct)}%(Δ${fmt(c.vsControl.flippedToLoserRatePct)}) degraded=${fmt(c.degradedRatePct)}%(Δ${fmt(c.vsControl.degradedRatePct)}) ` +
      `early_exp=${fmt(c.early?.expectancy)}% late_exp=${fmt(c.late?.expectancy)}%`,
    );
  }

  console.log(`\n--- Pareto frontier (${frontier.length} of 60 configs: maximize expectancy, minimize |maxDD|, minimize winners-flipped rate) ---`);
  for (const c of frontier.sort((a, b) => b.expectancy - a.expectancy)) {
    console.log(
      `  ${c.isControl ? "[CONTROL] " : ""}trig=${c.triggerPct}% frac=${Math.round(c.fraction * 100)}% trail=${Math.round(c.trailFrac * 100)}%  ` +
      `exp=${fmt(c.expectancy)}% maxDD=${fmt(c.maxDrawdownPts)}pts flipped=${fmt(c.flippedToLoserRatePct)}% PF=${fmt(c.profitFactor)} winRate=${fmt(c.winRate)}%`,
    );
  }

  console.log(`\n=== END — data only, no recommendation, no production behavior changed. ===\n`);
  await releaseAuditClerkSession();
}

main().catch(async (err) => {
  console.error("[banger-exit-trail-optimization-grid] fatal:", err);
  await releaseAuditClerkSession();
  process.exitCode = 1;
});
