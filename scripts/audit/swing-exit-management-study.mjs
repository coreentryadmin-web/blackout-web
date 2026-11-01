#!/usr/bin/env node
/**
 * EXIT-MANAGEMENT SIMULATION STUDY (Ask Largo standing mandate, operator directive 2026-09-26):
 * "determine exactly where those gains are being lost" between the MFE opportunity the
 * NIGHTHAWK-EDGE-STUDY-2026-09-26.md discovery-edge study found (43.2% of Banger closes reached a
 * 100%+ premium gain at some point) and what was actually realized (9.2%).
 *
 * THIS SCRIPT CHANGES NOTHING IN PRODUCTION. Read-only. It reports; it does not change any exit
 * policy, weight, threshold, or gate.
 *
 * TWO TIERS, BY DATA AVAILABILITY (see docs/audit/NIGHTHAWK-EXIT-MANAGEMENT-STUDY-2026-09-26.md
 * for the full data-availability trace this split rests on):
 *
 * NATIVE SWING — full chronological replay. `GET /api/admin/swing/closed-position-snapshots`
 * exposes each closed position's REAL ~15-min-cadence tick history (option_mark + the real,
 * already-computed production management verdict per tick). `swing-exit-simulation-eval.mjs`
 * chronologically walks that REAL path for 9 named exit rules, respecting a shared real "gate
 * floor" (a genuine capital-preservation/thesis-invalidation signal production itself computed at
 * that exact past tick — never fabricated, never borrowed from the future). See that module's own
 * header for the full look-ahead-safety argument.
 *
 * BANGER — summary-tier only, explicitly narrower. No per-tick history exists or has ever existed
 * for Banger positions (pure update-in-place running max/min — see the data-availability doc). Only
 * rules computable from entry/peak/exit SUMMARY values under the single-peaked-path assumption
 * already used by swing-early-trim-ab.mjs are reported (current/no-early-trim/two trim-ladder
 * configs) — trailing-stop-after-MFE, breakeven-stop timing, time-based exits, and a standalone
 * thesis-invalidation rule are reported as N/A for Banger, not guessed.
 *
 * USAGE
 *   node --import tsx scripts/audit/swing-exit-management-study.mjs [--days=90] [--base=...] [--min-n=5] [--json]
 */
import { fetchAuditJson, releaseAuditClerkSession } from "./lib/audit-auth-fetch.mjs";
import {
  simulateRowAcrossRules,
  aggregateRule,
  aggregateRuleByCategory,
  baselineStats,
  EXIT_RULES,
} from "./lib/swing-exit-simulation-eval.mjs";
import { chooseBucketCount } from "./lib/banger-discovery-edge-eval.mjs";

const args = process.argv.slice(2);
const flag = (name, def) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=").slice(1).join("=") : def;
};
const DAYS = Math.min(120, Math.max(1, Number(flag("days", "90")) || 90));
const BASE = flag("base", "https://blackouttrades.com");
const MIN_N = Math.max(2, Number(flag("min-n", "5")) || 5);
const JSON_OUT = args.includes("--json");

function fmt(x, digits = 1) {
  return x == null ? "n/a" : Number(x).toFixed(digits);
}

/** Quantile-bucket rows by a numeric key, then aggregate a rule within each bucket. Rows missing
 *  the key are excluded from bucketing (never coerced into a bucket). */
function bucketAndAggregate(simRows, keyFn, ruleId, opts) {
  const usable = simRows
    .map((r) => ({ row: r, key: keyFn(r) }))
    .filter((x) => typeof x.key === "number" && Number.isFinite(x.key));
  const bucketCount = chooseBucketCount(usable.length, { minPerBucket: MIN_N });
  const sorted = [...usable].sort((a, b) => a.key - b.key);
  const buckets = Array.from({ length: bucketCount }, () => []);
  sorted.forEach((x, i) => {
    const idx = Math.min(bucketCount - 1, Math.floor((i / sorted.length) * bucketCount));
    buckets[idx].push(x.row);
  });
  return buckets.map((rowsInBucket, i) => {
    const keys = rowsInBucket.map((r) => keyFn(r)).filter((k) => typeof k === "number" && Number.isFinite(k));
    const lo = keys.length ? Math.min(...keys) : null;
    const hi = keys.length ? Math.max(...keys) : null;
    return { label: keys.length ? `${lo}..${hi}` : `bucket ${i}`, ...aggregateRule(rowsInBucket, ruleId, opts) };
  });
}

function printRuleTable(label, aggregates) {
  console.log(`\n  ${label}`);
  for (const a of aggregates) {
    if (a.n === 0) {
      console.log(`    n=0 — NO DATA`);
      continue;
    }
    console.log(
      `    n=${a.n}  win=${fmt(a.winRate)}%  avgWinner=${fmt(a.avgWinner)}%  avgLoser=${fmt(a.avgLoser)}%  expectancy=${fmt(a.expectancy)}%  ` +
      `meanCurrent=${fmt(a.meanCurrent)}%  meanCandidate=${fmt(a.meanCandidate)}%  meanDelta=${fmt(a.meanDelta)}pp [${fmt(a.ci?.lo)}, ${fmt(a.ci?.hi)}] -> ${a.verdict}`,
    );
    console.log(
      `      winner->loser: ${a.turnedWinnerIntoLoser}/${a.n} (${fmt(a.turnedWinnerIntoLoserRate)}% of actual winners)  ` +
      `premature-killed-large-winner: ${a.prematurelyKilledLargeWinners}/${a.largeWinnerN} (${fmt(a.prematurelyKilledRate)}%)`,
    );
  }
}

async function runNativeSwing() {
  const res = await fetchAuditJson(BASE, `/api/admin/swing/closed-position-snapshots?days=${DAYS}`);
  if (!res.ok || !Array.isArray(res.json?.rows)) {
    return { ok: false, status: res.status, via: res.via, error: res.json?.error ?? null };
  }
  const rawRows = res.json.rows;
  const simRows = rawRows.map((row) => ({
    ...simulateRowAcrossRules(row),
    direction: row.direction ?? null,
    archetype: row.archetype ?? null,
    subLane: row.subLane ?? null,
    score: typeof row.score === "number" ? row.score : null,
    dte: typeof row.contract?.dte === "number" ? row.contract.dte : null,
  }));
  const withChron = simRows.filter((r) => r.hasChronology);
  const baseline = baselineStats(simRows);

  if (!JSON_OUT) {
    console.log(`\n=== NATIVE SWING — CHRONOLOGICAL EXIT-MANAGEMENT SIMULATION (${DAYS}d window) ===`);
    console.log(`Closed population: ${simRows.length}. With real tick history usable (>=2 ticks): ${withChron.length}.`);
    if (withChron.length) {
      const avgTicks = round1(withChron.reduce((a, r) => a + r.tickCount, 0) / withChron.length);
      console.log(`Avg ticks per position: ${avgTicks} (~15-min RTH cadence).`);
    }
    console.log(`\n--- BASELINE (current, real recorded outcome) ---`);
    console.log(`  n=${baseline.n}  win=${fmt(baseline.winRate)}%  avgWinner=${fmt(baseline.avgWinner)}%  avgLoser=${fmt(baseline.avgLoser)}%  expectancy=${fmt(baseline.expectancy)}%`);
  }

  const ruleResults = {};
  for (const rule of EXIT_RULES) {
    const agg = aggregateRule(withChron, rule.id, {});
    ruleResults[rule.id] = { label: rule.label, overall: agg };
    if (!JSON_OUT) printRuleTable(`### ${rule.label} (${rule.id}) ###`, [agg]);
  }

  // Segmentation — only where n permits (guarded by MIN_N inside bucketAndAggregate/aggregateRuleByCategory).
  const segmentation = {};
  for (const rule of EXIT_RULES) {
    segmentation[rule.id] = {
      byDirection: aggregateRuleByCategory(withChron, rule.id, (r) => r.direction),
      byArchetype: aggregateRuleByCategory(withChron, rule.id, (r) => r.archetype),
      bySubLane: aggregateRuleByCategory(withChron, rule.id, (r) => r.subLane),
      byScoreQuantile: bucketAndAggregate(withChron, (r) => r.score, rule.id, {}),
      byDteQuantile: bucketAndAggregate(withChron, (r) => r.dte, rule.id, {}),
    };
  }

  if (!JSON_OUT) {
    console.log(`\n--- SEGMENTATION (rules with the clearest overall signal only, full detail in --json) ---`);
    const notable = ["current_replica", "trim_50_runner_no_trail", "thesis_invalidation_only"];
    for (const ruleId of notable) {
      const seg = segmentation[ruleId];
      console.log(`\n  ## ${ruleId} by direction ##`);
      for (const g of seg.byDirection) console.log(`    [${g.label}] n=${g.n} win=${fmt(g.winRate)}% expectancy=${fmt(g.expectancy)}% meanDelta=${fmt(g.meanDelta)}pp`);
      console.log(`  ## ${ruleId} by sub-lane ##`);
      for (const g of seg.bySubLane) console.log(`    [${g.label}] n=${g.n} win=${fmt(g.winRate)}% expectancy=${fmt(g.expectancy)}% meanDelta=${fmt(g.meanDelta)}pp`);
    }
  }

  return { ok: true, population: simRows.length, withChronology: withChron.length, baseline, ruleResults, segmentation, simRows: JSON_OUT ? simRows : undefined };
}

function round1(x) {
  return x == null ? null : Math.round(x * 10) / 10;
}

/** Banger summary-tier: entry/peak/exit values only, single-peaked-path assumption (same as
 *  swing-early-trim-ab.mjs), for the subset of rules that don't need chronology. */
function blendedPnlUnderLadder(row, rungs) {
  const entry = row.entry_premium;
  if (!(entry > 0) || row.peak_premium == null || !Number.isFinite(row.peak_premium)) return null;
  if (row.realized_pnl_pct == null || !Number.isFinite(row.realized_pnl_pct)) return null;
  const ordered = [...rungs].sort((a, b) => a.triggerPct - b.triggerPct);
  let remaining = 1;
  let realized = 0;
  for (const t of ordered) {
    const level = entry * (1 + t.triggerPct / 100);
    if (row.peak_premium >= level) {
      realized += t.fraction * t.triggerPct;
      remaining -= t.fraction;
    }
  }
  realized += remaining * row.realized_pnl_pct;
  return Math.round(realized * 100) / 100;
}

const BANGER_SUMMARY_RULES = [
  { id: "no_early_trim", label: "No early trim (ride 100% to real close)", rungs: [] },
  { id: "current_replica", label: "Current-shaped: 50%@+100% / 50% runner (no trail, summary-tier)", rungs: [{ triggerPct: 100, fraction: 0.5 }] },
  { id: "trim_30_50_runner", label: "30%@+50% / 50%@+100% / 20% runner (summary-tier)", rungs: [{ triggerPct: 50, fraction: 0.3 }, { triggerPct: 100, fraction: 0.5 }] },
];

async function runBanger() {
  const res = await fetchAuditJson(BASE, `/api/admin/banger/closed-export?days=${DAYS}`);
  if (!res.ok || !Array.isArray(res.json?.rows)) {
    return { ok: false, status: res.status, via: res.via, error: res.json?.error ?? null };
  }
  const rows = res.json.rows;
  const baseline = {
    n: rows.length,
    winRate: round1((rows.filter((r) => r.realized_pnl_pct > 0).length / rows.length) * 100),
  };

  if (!JSON_OUT) {
    console.log(`\n\n=== BANGER — SUMMARY-TIER EXIT COMPARISON (${DAYS}d window, n=${rows.length}) ===`);
    console.log(`No per-tick history exists for Banger (confirmed: peak/trough are pure running max/min,`);
    console.log(`no historical log) — trailing-stop/breakeven-timing/time-based/thesis-invalidation-only`);
    console.log(`rules are N/A here, not guessed. Only entry/peak/exit summary-value rules follow, under`);
    console.log(`the same single-peaked-path assumption swing-early-trim-ab.mjs already discloses.`);
  }

  const ruleResults = {};
  for (const rule of BANGER_SUMMARY_RULES) {
    const paired = rows
      .map((row) => {
        const current = row.realized_pnl_pct;
        const candidate = rule.rungs.length ? blendedPnlUnderLadder(row, rule.rungs) : current;
        if (current == null || candidate == null) return null;
        return { ticker: row.ticker, current: { realizedPnlPct: current }, results: { [rule.id]: { realizedPnlPct: candidate } } };
      })
      .filter(Boolean);
    const agg = aggregateRule(paired, rule.id, {});
    ruleResults[rule.id] = { label: rule.label, overall: agg };
    if (!JSON_OUT) printRuleTable(`### ${rule.label} (${rule.id}) ###`, [agg]);
  }
  const naRules = ["trailing_stop_after_mfe", "breakeven_stop", "time_based_5", "time_based_10", "thesis_invalidation_only"];
  if (!JSON_OUT) {
    console.log(`\n  N/A for Banger (no chronology exists): ${naRules.join(", ")}`);
  }
  for (const id of naRules) ruleResults[id] = { label: "N/A — no per-tick history for Banger", overall: { n: 0, verdict: "N/A — NO CHRONOLOGY" } };

  return { ok: true, population: rows.length, baseline, ruleResults };
}

async function main() {
  const swing = await runNativeSwing();
  const banger = await runBanger();

  if (JSON_OUT) {
    console.log(JSON.stringify({ ok: true, days: DAYS, swing, banger }, null, 2));
  } else {
    console.log(`\n=== END — this is a report, not a change. No exit policy/gate/threshold was touched. ===\n`);
  }
  await releaseAuditClerkSession();
}

main().catch(async (err) => {
  console.error("[swing-exit-management-study] fatal:", err);
  await releaseAuditClerkSession();
  process.exitCode = 1;
});
