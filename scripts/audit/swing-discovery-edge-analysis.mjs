#!/usr/bin/env node
/**
 * NIGHT HAWK SWINGS (native/organic engine) DISCOVERY-EDGE ANALYSIS (operator directive,
 * 2026-09-26, "prove NIGHTHAWK's edge" phase).
 *
 * "reconstruct what NIGHTHAWK knew at the time of selection and measure what happened afterward
 * ... prevent look-ahead bias ... identify which inputs actually separate winners from losers ...
 * I want evidence, sample sizes, and concrete examples — not assumptions. Do NOT change weights,
 * thresholds, gates, or production code simply because something looks correlated."
 *
 * THIS SCRIPT CHANGES NOTHING IN PRODUCTION. Read-only against the member-facing
 * GET /api/market/swing/record?days=N route's own closedDeck[] — no new admin route needed, that
 * route already exposes the pinned-at-commit decision record (score/cortex/archetype/subLane/
 * contract/topFlowProvenance/timestamps) plus the real outcome (peak/trough premium, exitPnlPct,
 * closedReason) per closed position. It reports; it gates, caps, and filters nothing.
 *
 * LOOK-AHEAD DISCIPLINE: identical invariant to banger-discovery-edge-eval.mjs, enforced in the
 * sibling module this script imports its swing-shaped metrics from
 * (scripts/audit/lib/swing-discovery-edge-eval.mjs) — every "predictor" comes from
 * `derivePreEntryMetrics` (fields pinned at commit only); every "outcome" comes from
 * `deriveOutcomeMetrics` (fields necessarily observed strictly after entry). Neither reads the
 * other's inputs.
 *
 * METHOD: numeric pre-entry variables are quantile-bucketed (shrinks bucket count to fit n) via
 * the REUSED `bucketByVariableQuantile`/`bucketedMetricVerdict`/`pairwiseSpearman` machinery from
 * `banger-discovery-edge-eval.mjs` (schema-agnostic — no Banger-specific assumption in that code).
 * Categorical pre-entry variables (direction/archetype/subLane/cortexDecision/cortexConviction/
 * closedReason/topFlowMatchedPick) are summarized via this study's own `groupByCategory`. The
 * unconditional population baseline is always printed FIRST.
 *
 * USAGE
 *   node --import tsx scripts/audit/swing-discovery-edge-analysis.mjs [--days=90] [--base=https://blackouttrades.com] [--min-n=5] [--json]
 */
import { fetchAuditJson, releaseAuditClerkSession } from "./lib/audit-auth-fetch.mjs";
import {
  deriveRowMetrics,
  groupByCategory,
} from "./lib/swing-discovery-edge-eval.mjs";
import {
  bucketByVariableQuantile,
  bucketedMetricVerdict,
  pairwiseSpearman,
  baselineSummary,
} from "./lib/banger-discovery-edge-eval.mjs";

const args = process.argv.slice(2);
const flag = (name, def) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=").slice(1).join("=") : def;
};
const DAYS = Math.min(90, Math.max(1, Number(flag("days", "90")) || 90));
const BASE = flag("base", "https://blackouttrades.com");
const MIN_N = Math.max(2, Number(flag("min-n", "5")) || 5);
const JSON_OUT = args.includes("--json");

const NUMERIC_VARIABLES = [
  { key: "score", label: "NIGHTHAWK score at commit" },
  { key: "cortexScore", label: "Cortex net score at commit" },
  { key: "cortexSupportCount", label: "Cortex support-signal count" },
  { key: "cortexOpposeCount", label: "Cortex oppose-signal count" },
  { key: "cortexAbsentCount", label: "Cortex absent-source count" },
  { key: "dte", label: "Contract DTE at entry (days)" },
  { key: "deltaAbs", label: "Contract |delta| at entry" },
  { key: "entryPremium", label: "Entry premium ($)" },
  { key: "watchToCommitDays", label: "WATCH-to-commit lag (days)" },
];

const CATEGORICAL_VARIABLES = [
  { key: "direction", label: "Direction (LONG/SHORT)" },
  { key: "archetype", label: "Archetype" },
  { key: "subLane", label: "Sub-lane" },
  { key: "cortexDecision", label: "Cortex decision" },
  { key: "cortexConviction", label: "Cortex conviction" },
  { key: "closedReason", label: "Closed reason" },
  { key: "topFlowMatchedPick", label: "Picked strike matched flow's magnet strike" },
  { key: "dayOfWeek", label: "Commit day-of-week (0=Sun..6=Sat)" },
];

const OUTCOME_METRICS = [
  { key: "winRate", label: "Win rate (%)" },
  { key: "hit100MfeRate", label: "100%+ MFE hit rate (%) — opportunity existed" },
  { key: "hit100RealizedRate", label: "100%+ REALIZED hit rate (%) — actually banked" },
  { key: "avgRealizedPnlPct", label: "Avg realized P&L (%)" },
  { key: "avgMfePct", label: "Avg MFE (%)" },
  { key: "avgMaePct", label: "Avg MAE (%)" },
];

function fmt(x, digits = 1) {
  return x == null ? "n/a" : Number(x).toFixed(digits);
}

async function main() {
  const res = await fetchAuditJson(BASE, `/api/market/swing/record?days=${DAYS}`);
  if (!res.ok || !Array.isArray(res.json?.closedDeck)) {
    const payload = { ok: false, insufficient_data: true, status: res.status, via: res.via, error: res.json?.error ?? null };
    if (JSON_OUT) console.log(JSON.stringify(payload, null, 2));
    else console.log(`INSUFFICIENT DATA — GET /api/market/swing/record?days=${DAYS} -> ${res.status} via=${res.via ?? "none"} ${res.json?.error ?? ""}`);
    await releaseAuditClerkSession();
    process.exitCode = 1;
    return;
  }

  const rawRows = res.json.closedDeck;
  const rows = rawRows.map(deriveRowMetrics);
  const baseline = baselineSummary(rows);

  const perNumericVariable = NUMERIC_VARIABLES.map(({ key, label }) => {
    const buckets = bucketByVariableQuantile(rows, key, "realizedPnlPct", { minPerBucket: MIN_N });
    const verdicts = OUTCOME_METRICS.map(({ key: mKey, label: mLabel }) => ({
      metricKey: mKey,
      metricLabel: mLabel,
      ...bucketedMetricVerdict(buckets, mKey, { minN: MIN_N }),
    }));
    const pairwise = OUTCOME_METRICS.filter((m) => ["avgRealizedPnlPct", "avgMfePct", "avgMaePct"].includes(m.key)).map(
      ({ key: mKey, label: mLabel }) => {
        const outcomeRowKey = mKey === "avgRealizedPnlPct" ? "realizedPnlPct" : mKey === "avgMfePct" ? "mfePct" : "maePct";
        return { metricLabel: mLabel, ...pairwiseSpearman(rows, key, outcomeRowKey) };
      },
    );
    return { key, label, buckets, verdicts, pairwise };
  });

  const perCategoricalVariable = CATEGORICAL_VARIABLES.map(({ key, label }) => ({
    key,
    label,
    groups: groupByCategory(rows, key),
  }));

  if (JSON_OUT) {
    console.log(JSON.stringify({ ok: true, days: DAYS, population: rows.length, baseline, perNumericVariable, perCategoricalVariable, rows }, null, 2));
    await releaseAuditClerkSession();
    return;
  }

  console.log(`\n=== NIGHT HAWK SWINGS (NATIVE) DISCOVERY-EDGE ANALYSIS (${DAYS}d window) ===`);
  console.log(`Closed population: ${rows.length}. Read-only — nothing here changes production.\n`);

  console.log("--- BASELINE (unconditional, no segmentation) ---");
  console.log(`n=${baseline.n}  win rate=${fmt(baseline.winRate)}%  100%+ MFE hit=${fmt(baseline.hit100MfeRate)}%  100%+ REALIZED hit=${fmt(baseline.hit100RealizedRate)}%`);
  console.log(`avg realized P&L=${fmt(baseline.avgRealizedPnlPct)}%  avg MFE=${fmt(baseline.avgMfePct)}%  avg MAE=${fmt(baseline.avgMaePct)}%\n`);

  if (baseline.n < MIN_N * 2) {
    console.log(`*** WARNING: closed population (n=${baseline.n}) is thin relative to min-n=${MIN_N} — every verdict below should be read as a FIRST LOOK, not a settled conclusion. ***\n`);
  }

  for (const v of perNumericVariable) {
    console.log(`\n### ${v.label} (${v.key}) ###`);
    console.log("Quantile buckets (low -> high):");
    for (const b of v.buckets) {
      console.log(
        `  [${b.label}] n=${b.n}  win=${fmt(b.winRate)}%  100%MFE=${fmt(b.hit100MfeRate)}%  100%REAL=${fmt(b.hit100RealizedRate)}%  avgP&L=${fmt(b.avgRealizedPnlPct)}%  avgMFE=${fmt(b.avgMfePct)}%  avgMAE=${fmt(b.avgMaePct)}%`,
      );
    }
    console.log("Bucketed verdicts (RANKS requires spread AND monotonic trend, never spread alone):");
    for (const verdict of v.verdicts) {
      const excludedNote = verdict.excluded?.length ? ` [excluded thin: ${verdict.excluded.join(", ")}]` : "";
      console.log(`  ${verdict.metricLabel}: ${verdict.verdict}${verdict.rho != null ? ` (rho=${verdict.rho}, spread=${fmt(verdict.spread)})` : ""}${excludedNote}`);
    }
    console.log("Direct (unbucketed) Spearman correlation:");
    for (const p of v.pairwise) {
      console.log(`  ${p.metricLabel}: rho=${p.rho ?? "n/a"} (n=${p.n}${p.note ? `, ${p.note}` : ""})`);
    }
  }

  for (const v of perCategoricalVariable) {
    console.log(`\n### ${v.label} (${v.key}) — categorical groups ###`);
    for (const g of v.groups) {
      console.log(
        `  [${g.label}] n=${g.n}  win=${fmt(g.winRate)}%  100%MFE=${fmt(g.hit100MfeRate)}%  100%REAL=${fmt(g.hit100RealizedRate)}%  avgP&L=${fmt(g.avgRealizedPnlPct)}%  avgMFE=${fmt(g.avgMfePct)}%  avgMAE=${fmt(g.avgMaePct)}%`,
      );
    }
  }

  console.log("\n--- CONCRETE EXAMPLES: largest winners and largest losers (by realized P&L) ---");
  const withPnl = rows.filter((r) => r.realizedPnlPct != null).sort((a, b) => b.realizedPnlPct - a.realizedPnlPct);
  const topWinners = withPnl.slice(0, 5);
  const topLosers = withPnl.slice(-5).reverse();
  console.log("Top winners:");
  for (const r of topWinners) {
    console.log(`  ${r.ticker} (pos ${r.positionId}) ${r.direction} ${r.archetype}/${r.subLane}: score=${fmt(r.score, 0)} cortex=${r.cortexDecision}/${r.cortexConviction} realizedP&L=${fmt(r.realizedPnlPct)}% MFE=${fmt(r.mfePct)}% MAE=${fmt(r.maePct)}% reason=${r.closedReason} holdDays=${fmt(r.holdDays, 1)}`);
  }
  console.log("Top losers:");
  for (const r of topLosers) {
    console.log(`  ${r.ticker} (pos ${r.positionId}) ${r.direction} ${r.archetype}/${r.subLane}: score=${fmt(r.score, 0)} cortex=${r.cortexDecision}/${r.cortexConviction} realizedP&L=${fmt(r.realizedPnlPct)}% MFE=${fmt(r.mfePct)}% MAE=${fmt(r.maePct)}% reason=${r.closedReason} holdDays=${fmt(r.holdDays, 1)}`);
  }

  console.log("\n--- MISSED/FORGONE UPSIDE: rows where MFE was large but realized P&L was not ---");
  const forgone = rows
    .filter((r) => r.mfePct != null && r.realizedPnlPct != null && r.mfePct >= 50 && (r.realizedPnlPct < r.mfePct - 30))
    .sort((a, b) => (b.mfePct - b.realizedPnlPct) - (a.mfePct - a.realizedPnlPct));
  if (!forgone.length) {
    console.log("  none found in this window at the (MFE>=50%, gap>=30pp) threshold.");
  } else {
    for (const r of forgone.slice(0, 10)) {
      console.log(`  ${r.ticker} (pos ${r.positionId}) ${r.direction}: MFE=${fmt(r.mfePct)}% but realized=${fmt(r.realizedPnlPct)}% (gap=${fmt(r.mfePct - r.realizedPnlPct)}pp) reason=${r.closedReason}`);
    }
  }

  console.log("\n=== END — this is a report, not a gate. No commit/discovery logic was touched. ===\n");
  await releaseAuditClerkSession();
}

main().catch(async (err) => {
  console.error("[swing-discovery-edge-analysis] fatal:", err);
  await releaseAuditClerkSession();
  process.exitCode = 1;
});
