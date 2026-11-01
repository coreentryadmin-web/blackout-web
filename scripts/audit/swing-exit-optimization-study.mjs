#!/usr/bin/env node
/**
 * EXIT-MANAGEMENT OPTIMIZATION STUDY (Ask Largo standing mandate, operator directive 2026-09-26,
 * follow-up to NIGHTHAWK-EXIT-MANAGEMENT-STUDY-2026-09-26.md). That study found a Banger-shaped
 * "50% at +100%, ride the runner on the existing thesis/risk exit" policy beats real historical
 * management by +3.3pp (n=1310). This script runs a deeper grid around that result — see the
 * operator's own directive for the exact ask: 6 trigger levels x 4 scale-out fractions, 4 runner
 * exit styles, segmentation by engine/ticker/DTE/option-type/score/vol-regime/MFE, walk-forward
 * validation, and an investigation of why `profit_ladder`'s +100% trigger barely fires.
 *
 * THIS SCRIPT CHANGES NOTHING IN PRODUCTION. Read-only. It reports; it recommends candidate
 * configurations for FURTHER validation — it does not ship or gate anything.
 *
 * LOOK-AHEAD DISCIPLINE: see swing-exit-optimization-eval.mjs's own header — every rule decides at
 * tick i using only ticks[0..i], sharing one real gate floor. The one thing THIS script adds beyond
 * that module's own guarantee is walk-forward validation (Part E): the grid is independently
 * re-run on an early half and a late half of the same population, so a config's ranking is checked
 * for whether it generalizes across time, not just fitted to the one sample it was measured on.
 *
 * USAGE
 *   node --import tsx scripts/audit/swing-exit-optimization-study.mjs [--days=120] [--banger-days=180] [--base=...] [--min-n=8] [--json]
 */
import { fetchAuditJson, releaseAuditClerkSession } from "./lib/audit-auth-fetch.mjs";
import {
  evaluateGridCellForRow,
  evaluateSummaryTierGridCell,
  aggregateGridCell,
  runGrid,
  splitByDateHalves,
  TRIGGER_LEVELS_PCT,
} from "./lib/swing-exit-optimization-eval.mjs";
import { chooseBucketCount } from "./lib/banger-discovery-edge-eval.mjs";

const SRC = new URL("../../src/", import.meta.url).pathname;

const args = process.argv.slice(2);
const flag = (name, def) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=").slice(1).join("=") : def;
};
const DAYS = Math.min(120, Math.max(1, Number(flag("days", "120")) || 120));
const BANGER_DAYS = Math.min(365, Math.max(1, Number(flag("banger-days", "180")) || 180));
const BASE = flag("base", "https://blackouttrades.com");
const MIN_N = Math.max(2, Number(flag("min-n", "8")) || 8);
const JSON_OUT = args.includes("--json");

function finite(x) {
  return typeof x === "number" && Number.isFinite(x);
}
function round1(x) {
  return x == null ? null : Math.round(x * 10) / 10;
}
function fmt(x, d = 1) {
  return x == null || x === Infinity ? (x === Infinity ? "∞" : "n/a") : Number(x).toFixed(d);
}

// ── Real VIX daily closes for Banger's vol-regime segmentation (no per-position IV field exists
//    for Banger; native swing uses its own real iv_rank instead — see Part D). ──
async function fetchVixByDate(fromDate, toDate) {
  try {
    const { fetchAggBars } = await import(`${SRC}lib/providers/polygon-largo.ts`);
    const bars = await fetchAggBars("I:VIX", 1, "day", fromDate, toDate).catch(() => []);
    const map = new Map();
    for (const b of bars ?? []) {
      if (b.t == null || !finite(b.c)) continue;
      map.set(new Date(b.t).toISOString().slice(0, 10), b.c);
    }
    return map;
  } catch {
    return new Map();
  }
}

function reachRateCurve(rows, entryOf, peakOf) {
  const usable = rows.map((r) => ({ entry: entryOf(r), peak: peakOf(r) })).filter((x) => finite(x.entry) && x.entry > 0 && finite(x.peak));
  return TRIGGER_LEVELS_PCT.map((pct) => {
    const reached = usable.filter((x) => x.peak >= x.entry * (1 + pct / 100));
    return { triggerPct: pct, n: usable.length, reachedN: reached.length, reachRatePct: usable.length ? round1((reached.length / usable.length) * 100) : null };
  });
}

function quantileBucket(rows, keyFn, minPerBucket) {
  const usable = rows.map((r) => ({ row: r, key: keyFn(r) })).filter((x) => finite(x.key));
  const bucketCount = chooseBucketCount(usable.length, { minPerBucket });
  const sorted = [...usable].sort((a, b) => a.key - b.key);
  const buckets = Array.from({ length: bucketCount }, () => []);
  sorted.forEach((x, i) => {
    const idx = Math.min(bucketCount - 1, Math.floor((i / sorted.length) * bucketCount));
    buckets[idx].push(x);
  });
  return buckets.map((b) => ({
    label: b.length ? `${round1(Math.min(...b.map((x) => x.key)))}..${round1(Math.max(...b.map((x) => x.key)))}` : "empty",
    rows: b.map((x) => x.row),
  }));
}

function categoryBucket(rows, keyFn) {
  const groups = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    if (k == null) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  return [...groups.entries()].map(([label, groupRows]) => ({ label: String(label), rows: groupRows }));
}

function printCell(prefix, c) {
  console.log(
    `${prefix}trigger=+${c.triggerPct}% frac=${Math.round(c.fraction * 100)}%  n=${c.n} reach=${fmt(c.reachRatePct)}%  ` +
    `win=${fmt(c.winRate)}%  medianReal=${fmt(c.medianRealized)}%  expectancy=${fmt(c.expectancy)}%  PF=${fmt(c.profitFactor)}  ` +
    `avgDD=${fmt(c.avgDrawdownAfterProfit)}%  avgMFEcap=${fmt(c.avgMfeCapturedPct)}%  meanDelta=${fmt(c.meanDelta)}pp [${fmt(c.ci?.lo)},${fmt(c.ci?.hi)}] -> ${c.verdict}  ` +
    `winner→loser=${c.turnedWinnerIntoLoser}/${c.n}  large-killed=${c.prematurelyKilledLargeWinners}/${c.largeWinnerN}`,
  );
}

async function main() {
  const swingRes = await fetchAuditJson(BASE, `/api/admin/swing/closed-position-snapshots?days=${DAYS}`);
  const bangerRes = await fetchAuditJson(BASE, `/api/admin/banger/closed-export?days=${BANGER_DAYS}`);
  if (!swingRes.ok || !Array.isArray(swingRes.json?.rows) || !bangerRes.ok || !Array.isArray(bangerRes.json?.rows)) {
    console.log("INSUFFICIENT DATA", { swing: swingRes.status, banger: bangerRes.status });
    await releaseAuditClerkSession();
    process.exitCode = 1;
    return;
  }
  const swingRows = swingRes.json.rows;
  const bangerRows = bangerRes.json.rows;
  const swingChron = swingRows.filter((r) => Array.isArray(r.snapshots) && r.snapshots.length >= 2);

  const swingCurrentOf = (row) => (finite(row.exitPnlPct) ? row.exitPnlPct : null);
  const swingEvalOf = (row, cfg) => evaluateGridCellForRow(row, cfg);
  const bangerCurrentOf = (row) => (finite(row.realized_pnl_pct) ? row.realized_pnl_pct : null);
  const bangerEvalOf = (row, cfg) => evaluateSummaryTierGridCell(row, cfg);

  // ── Part A: profit_ladder trigger-appropriateness — real MFE reach-rate curve ──
  const swingReach = reachRateCurve(swingRows, (r) => r.entryPremium, (r) => r.peakPremium);
  const bangerReach = reachRateCurve(bangerRows, (r) => r.entry_premium, (r) => r.peak_premium);

  // ── Part B: main grid, thesis_risk runner (native swing chronological + Banger summary-tier) ──
  const swingGrid = runGrid(swingChron, { currentOf: swingCurrentOf, evalOf: swingEvalOf, runnerStyle: "thesis_risk" }, { });
  const bangerGrid = runGrid(bangerRows, { currentOf: bangerCurrentOf, evalOf: bangerEvalOf, runnerStyle: "thesis_risk" }, { });
  const rank = (cells) => [...cells].filter((c) => c.n >= MIN_N).sort((a, b) => (b.expectancy ?? -Infinity) - (a.expectancy ?? -Infinity));
  const rankedSwing = rank(swingGrid);
  const rankedBanger = rank(bangerGrid);

  // ── Part C: runner-style comparison at the leading swing config(s) ──
  const RUNNER_STYLES = [
    { id: "thesis_risk", extraParams: {} },
    { id: "trailing_stop@20%", runnerStyle: "trailing_stop", extraParams: { trailBackPct: 20 } },
    { id: "trailing_stop@30%", runnerStyle: "trailing_stop", extraParams: { trailBackPct: 30 } },
    { id: "trailing_stop@40%", runnerStyle: "trailing_stop", extraParams: { trailBackPct: 40 } },
    { id: "breakeven_stop", runnerStyle: "breakeven_stop", extraParams: {} },
    { id: "time_exit@5ticks", runnerStyle: "time_exit", extraParams: { holdTicksAfterTrim: 5 } },
    { id: "time_exit@10ticks", runnerStyle: "time_exit", extraParams: { holdTicksAfterTrim: 10 } },
  ];
  const topSwingConfigs = rankedSwing.slice(0, 3);
  const runnerStyleComparisons = topSwingConfigs.map((topCfg) => ({
    base: { triggerPct: topCfg.triggerPct, fraction: topCfg.fraction },
    styles: RUNNER_STYLES.map((s) => {
      const cfg = { triggerPct: topCfg.triggerPct, fraction: topCfg.fraction, runnerStyle: s.runnerStyle ?? "thesis_risk", ...s.extraParams };
      const paired = swingChron.map((row) => ({ current: swingCurrentOf(row), candidate: evaluateGridCellForRow(row, cfg) }));
      return { id: s.id, ...aggregateGridCell(paired) };
    }),
  }));

  // ── Part D: segmentation of the SINGLE best config per engine ──
  const bestSwing = rankedSwing[0] ?? null;
  const bestBanger = rankedBanger[0] ?? null;
  let swingSeg = null;
  let bangerSeg = null;

  if (bestSwing) {
    const cfg = { triggerPct: bestSwing.triggerPct, fraction: bestSwing.fraction, runnerStyle: "thesis_risk" };
    const evalRows = (rows) => rows.map((row) => ({ current: swingCurrentOf(row), candidate: evaluateGridCellForRow(row, cfg) }));
    swingSeg = {
      byDirection: categoryBucket(swingChron, (r) => r.direction).map((g) => ({ label: g.label, ...aggregateGridCell(evalRows(g.rows)) })),
      byOptionType: categoryBucket(swingChron, (r) => r.contract?.right).map((g) => ({ label: g.label === "C" ? "CALL" : g.label === "P" ? "PUT" : g.label, ...aggregateGridCell(evalRows(g.rows)) })),
      byArchetype: categoryBucket(swingChron, (r) => r.archetype).map((g) => ({ label: g.label, ...aggregateGridCell(evalRows(g.rows)) })),
      bySubLane: categoryBucket(swingChron, (r) => r.subLane).map((g) => ({ label: g.label, ...aggregateGridCell(evalRows(g.rows)) })),
      byDte: quantileBucket(swingChron, (r) => r.contract?.dte, 5).map((g) => ({ label: g.label, ...aggregateGridCell(evalRows(g.rows)) })),
      byScore: quantileBucket(swingChron, (r) => r.score, 5).map((g) => ({ label: g.label, ...aggregateGridCell(evalRows(g.rows)) })),
      byIvRank: quantileBucket(
        swingChron.filter((r) => r.snapshots?.[0]?.feature_vector?.iv_rank != null),
        (r) => r.snapshots[0].feature_vector.iv_rank,
        5,
      ).map((g) => ({ label: g.label, ...aggregateGridCell(evalRows(g.rows)) })),
      byMfe: quantileBucket(swingChron, (r) => (finite(r.entryPremium) && r.entryPremium > 0 && finite(r.peakPremium) ? (r.peakPremium / r.entryPremium - 1) * 100 : null), 5).map((g) => ({ label: g.label, ...aggregateGridCell(evalRows(g.rows)) })),
      byTicker: categoryBucket(swingChron, (r) => r.ticker).filter((g) => g.rows.length >= 2).map((g) => ({ label: g.label, n: g.rows.length })),
    };
  }

  if (bestBanger) {
    const cfg = { triggerPct: bestBanger.triggerPct, fraction: bestBanger.fraction };
    const evalRows = (rows) => rows.map((row) => ({ current: bangerCurrentOf(row), candidate: evaluateSummaryTierGridCell(row, cfg) }));
    const vixMap = await fetchVixByDate(
      bangerRows.reduce((min, r) => (r.session_date && r.session_date < min ? r.session_date : min), "9999-99-99"),
      bangerRows.reduce((max, r) => (r.session_date && r.session_date > max ? r.session_date : max), "0000-00-00"),
    );
    const withVix = bangerRows.map((r) => ({ ...r, __vix: vixMap.get(r.session_date) ?? null }));
    bangerSeg = {
      byDte: quantileBucket(bangerRows, (r) => {
        if (!r.session_date || !r.contract_expiry) return null;
        const d = (Date.parse(`${r.contract_expiry}T00:00:00Z`) - Date.parse(`${r.session_date}T00:00:00Z`)) / 86_400_000;
        return Number.isFinite(d) ? d : null;
      }, 100).map((g) => ({ label: g.label, ...aggregateGridCell(evalRows(g.rows)) })),
      byVixRegime: quantileBucket(withVix.filter((r) => r.__vix != null), (r) => r.__vix, 100).map((g) => ({ label: g.label, ...aggregateGridCell(evalRows(g.rows)) })),
      byMfe: quantileBucket(bangerRows, (r) => (finite(r.entry_premium) && r.entry_premium > 0 && finite(r.peak_premium) ? (r.peak_premium / r.entry_premium - 1) * 100 : null), 100).map((g) => ({ label: g.label, ...aggregateGridCell(evalRows(g.rows)) })),
      byTicker: categoryBucket(bangerRows, (r) => r.ticker).filter((g) => g.rows.length >= 5).map((g) => ({ label: g.label, n: g.rows.length })),
      vixCoverage: withVix.filter((r) => r.__vix != null).length,
      vixTotal: withVix.length,
    };
  }

  // ── Part E: walk-forward split (early vs late half) ──
  const swingSplit = splitByDateHalves(swingChron, (r) => r.committedAt);
  const swingGridEarly = rank(runGrid(swingSplit.early, { currentOf: swingCurrentOf, evalOf: swingEvalOf, runnerStyle: "thesis_risk" }, { }));
  const swingGridLate = rank(runGrid(swingSplit.late, { currentOf: swingCurrentOf, evalOf: swingEvalOf, runnerStyle: "thesis_risk" }, { }));

  const bangerSplit = splitByDateHalves(bangerRows, (r) => r.session_date);
  const bangerGridEarly = rank(runGrid(bangerSplit.early, { currentOf: bangerCurrentOf, evalOf: bangerEvalOf, runnerStyle: "thesis_risk" }, { }));
  const bangerGridLate = rank(runGrid(bangerSplit.late, { currentOf: bangerCurrentOf, evalOf: bangerEvalOf, runnerStyle: "thesis_risk" }, { }));

  const payload = {
    ok: true,
    days: DAYS,
    bangerDays: BANGER_DAYS,
    population: { swingTotal: swingRows.length, swingChron: swingChron.length, banger: bangerRows.length },
    reach: { swing: swingReach, banger: bangerReach },
    grid: { swing: swingGrid, banger: bangerGrid },
    ranked: { swing: rankedSwing.slice(0, 5), banger: rankedBanger.slice(0, 5) },
    runnerStyleComparisons,
    segmentation: { swing: swingSeg, banger: bangerSeg },
    walkForward: {
      swing: { splitDate: swingSplit.splitDate, earlyN: swingSplit.early.length, lateN: swingSplit.late.length, early: swingGridEarly.slice(0, 5), late: swingGridLate.slice(0, 5) },
      banger: { splitDate: bangerSplit.splitDate, earlyN: bangerSplit.early.length, lateN: bangerSplit.late.length, early: bangerGridEarly.slice(0, 5), late: bangerGridLate.slice(0, 5) },
    },
  };

  if (JSON_OUT) {
    console.log(JSON.stringify(payload, null, 2));
    await releaseAuditClerkSession();
    return;
  }

  console.log(`\n=== EXIT-MANAGEMENT OPTIMIZATION STUDY ===`);
  console.log(`Native swing: ${swingRows.length} closed (${swingChron.length} chronological). Banger: ${bangerRows.length} closed.\n`);

  console.log(`--- PART A: profit_ladder trigger-appropriateness (real MFE reach-rate curve) ---`);
  console.log("Native swing:");
  for (const r of swingReach) console.log(`  +${r.triggerPct}%: ${r.reachedN}/${r.n} reached (${fmt(r.reachRatePct)}%)`);
  console.log("Banger:");
  for (const r of bangerReach) console.log(`  +${r.triggerPct}%: ${r.reachedN}/${r.n} reached (${fmt(r.reachRatePct)}%)`);

  console.log(`\n--- PART B: full grid (thesis_risk runner), ranked by expectancy (min n=${MIN_N}) ---`);
  console.log("\nNative swing — top 5:");
  for (const c of rankedSwing.slice(0, 5)) printCell("  ", c);
  console.log("\nBanger — top 5:");
  for (const c of rankedBanger.slice(0, 5)) printCell("  ", c);

  console.log(`\n--- PART C: runner-style comparison at the top 3 native-swing configs ---`);
  for (const comp of runnerStyleComparisons) {
    console.log(`\n  base config: trigger=+${comp.base.triggerPct}% frac=${Math.round(comp.base.fraction * 100)}%`);
    for (const s of comp.styles) {
      console.log(`    [${s.id}] n=${s.n} win=${fmt(s.winRate)}% median=${fmt(s.medianRealized)}% expectancy=${fmt(s.expectancy)}% PF=${fmt(s.profitFactor)} winner→loser=${s.turnedWinnerIntoLoser}/${s.n} large-killed=${s.prematurelyKilledLargeWinners}/${s.largeWinnerN}`);
    }
  }

  console.log(`\n--- PART D: segmentation of the single best config per engine ---`);
  if (bestSwing) {
    console.log(`\nNative swing best: trigger=+${bestSwing.triggerPct}% frac=${Math.round(bestSwing.fraction * 100)}%`);
    for (const [dim, groups] of Object.entries(swingSeg)) {
      if (dim === "byTicker") {
        console.log(`  byTicker (n>=2 only, top 8 by n): ${groups.slice(0, 8).map((g) => `${g.label}:${g.n}`).join(", ")}`);
        continue;
      }
      console.log(`  ${dim}:`);
      for (const g of groups) console.log(`    [${g.label}] n=${g.n} win=${fmt(g.winRate)}% expectancy=${fmt(g.expectancy)}% meanDelta=${fmt(g.meanDelta)}pp`);
    }
  }
  if (bestBanger) {
    console.log(`\nBanger best: trigger=+${bestBanger.triggerPct}% frac=${Math.round(bestBanger.fraction * 100)}%`);
    console.log(`  VIX coverage: ${bangerSeg.vixCoverage}/${bangerSeg.vixTotal}`);
    for (const dim of ["byDte", "byVixRegime", "byMfe"]) {
      console.log(`  ${dim}:`);
      for (const g of bangerSeg[dim]) console.log(`    [${g.label}] n=${g.n} win=${fmt(g.winRate)}% expectancy=${fmt(g.expectancy)}% meanDelta=${fmt(g.meanDelta)}pp`);
    }
    console.log(`  byTicker (n>=5 only, top 8 by n): ${bangerSeg.byTicker.slice(0, 8).map((g) => `${g.label}:${g.n}`).join(", ")}`);
  }

  console.log(`\n--- PART E: walk-forward split (early vs late half) ---`);
  console.log(`Native swing split at ${payload.walkForward.swing.splitDate} (early n=${payload.walkForward.swing.earlyN}, late n=${payload.walkForward.swing.lateN})`);
  console.log("  Early top 3:");
  for (const c of swingGridEarly.slice(0, 3)) printCell("    ", c);
  console.log("  Late top 3:");
  for (const c of swingGridLate.slice(0, 3)) printCell("    ", c);

  console.log(`\nBanger split at ${payload.walkForward.banger.splitDate} (early n=${payload.walkForward.banger.earlyN}, late n=${payload.walkForward.banger.lateN})`);
  console.log("  Early top 3:");
  for (const c of bangerGridEarly.slice(0, 3)) printCell("    ", c);
  console.log("  Late top 3:");
  for (const c of bangerGridLate.slice(0, 3)) printCell("    ", c);

  console.log(`\n=== END — this is a report of candidate configurations for further validation, not a change. ===\n`);
  await releaseAuditClerkSession();
}

main().catch(async (err) => {
  console.error("[swing-exit-optimization-study] fatal:", err);
  await releaseAuditClerkSession();
  process.exitCode = 1;
});
