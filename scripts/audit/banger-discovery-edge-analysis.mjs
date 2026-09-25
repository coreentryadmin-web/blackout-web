#!/usr/bin/env node
/**
 * ENGINE B (BANGER) DISCOVERY-EDGE ANALYSIS (Ask Largo standing mandate, 2026-09-25, operator
 * directive).
 *
 * Banger's discovery/commit path (src/lib/banger/discovery.ts, commit.ts) is deliberately
 * uncapped — "ZERO CAPS ... no top-N slice, no daily-commit cap, no position-count cap" (both
 * files' own headers, 2026-08-04 operator instruction) — which is why the live open book reached
 * 78-168 concurrent positions. The operator wants that cut to a curated 10-20 slots, but gated on
 * MEASURED historical edge, not an arbitrary tightening of the existing 4 screen thresholds:
 * "report the relationship between discovery gain, volume, close strength, price, and any other
 * already-captured pre-entry variables versus MAE, MFE, final return, 100%+ hit rate, and loss
 * rate... avoid look-ahead bias and do not optimize against information unavailable when the trade
 * was opened."
 *
 * THIS SCRIPT CHANGES NOTHING IN PRODUCTION. Read-only against GET /api/admin/banger/closed-export
 * (admin-gated, added this same session). It reports; it does not gate, cap, or filter anything.
 *
 * LOOK-AHEAD DISCIPLINE: every "predictor" reported here comes from `derivePreEntryMetrics`
 * (scripts/audit/lib/banger-discovery-edge-eval.mjs) — fields that existed at commit time only
 * (the discovery screen's own gain/vol/dollar-vol/close-strength/price, the contract's OTM% and
 * DTE chosen at commit, and the calendar day of week). Every "outcome" comes from
 * `deriveOutcomeMetrics` — fields necessarily observed strictly after entry (peak/trough premium,
 * realized P&L). Neither function reads the other's inputs; see that module's own header for the
 * full invariant this script relies on.
 *
 * METHOD: for each pre-entry variable, quantile-bucket the closed population (shrinks bucket count
 * to fit n — never forces a 5-way split on a thin sample) and report win rate / 100%+-hit rate
 * (both MFE-based "did the opportunity exist" and realized-based "did we actually bank it") / avg
 * realized P&L / avg MFE / avg MAE per bucket, plus a RANKS/SPREAD-WITHOUT-ORDER/INVERTED/FLAT/
 * INSUFFICIENT-DATA verdict requiring BOTH a real spread and a monotonic (Spearman) trend before
 * calling anything a ranking — never a spread alone. Also reports a direct (unbucketed) pairwise
 * Spearman correlation per variable/outcome pair as a complementary view, since bucketing can mask
 * or manufacture structure at small n. The unconditional population baseline is always printed
 * FIRST so every bucketed number can be read against it.
 *
 * USAGE
 *   node --import tsx scripts/audit/banger-discovery-edge-analysis.mjs [--days=180] [--base=https://blackouttrades.com] [--min-n=5] [--json]
 */
import { fetchAuditJson, releaseAuditClerkSession } from "./lib/audit-auth-fetch.mjs";
import {
  deriveRowMetrics,
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
const DAYS = Math.min(365, Math.max(1, Number(flag("days", "180")) || 180));
const BASE = flag("base", "https://blackouttrades.com");
const MIN_N = Math.max(2, Number(flag("min-n", "5")) || 5);
const JSON_OUT = args.includes("--json");

const PRE_ENTRY_VARIABLES = [
  { key: "discoveryGainPct", label: "Discovery gain (%)" },
  { key: "discoveryVol", label: "Discovery volume (shares)" },
  { key: "discoveryDollarVol", label: "Discovery dollar-volume ($)" },
  { key: "discoveryCloseStrength", label: "Discovery close-strength (0-1)" },
  { key: "priceAtDiscovery", label: "Price at discovery ($)" },
  { key: "otmPct", label: "Contract OTM at entry (%)" },
  { key: "dteAtEntry", label: "DTE at entry (days)" },
  { key: "entryPremium", label: "Entry premium ($)" },
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
  const res = await fetchAuditJson(BASE, `/api/admin/banger/closed-export?days=${DAYS}`);
  if (!res.ok || !Array.isArray(res.json?.rows)) {
    const payload = { ok: false, insufficient_data: true, status: res.status, via: res.via, error: res.json?.error ?? null };
    if (JSON_OUT) console.log(JSON.stringify(payload, null, 2));
    else console.log(`INSUFFICIENT DATA — GET /api/admin/banger/closed-export?days=${DAYS} -> ${res.status} via=${res.via ?? "none"} ${res.json?.error ?? ""}`);
    await releaseAuditClerkSession();
    process.exitCode = 1;
    return;
  }

  const rawRows = res.json.rows;
  const rows = rawRows.map(deriveRowMetrics);
  const baseline = baselineSummary(rows);

  const perVariable = PRE_ENTRY_VARIABLES.map(({ key, label }) => {
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

  if (JSON_OUT) {
    console.log(JSON.stringify({ ok: true, days: DAYS, population: rows.length, since: res.json.since, baseline, perVariable }, null, 2));
    await releaseAuditClerkSession();
    return;
  }

  console.log(`\n=== ENGINE B (BANGER) DISCOVERY-EDGE ANALYSIS (${DAYS}d window, since ${res.json.since}) ===`);
  console.log(`Closed population: ${rows.length} (CLOSED_RUNNER + STOPPED). Read-only — nothing here changes production.\n`);

  console.log("--- BASELINE (unconditional, no segmentation) ---");
  console.log(`n=${baseline.n}  win rate=${fmt(baseline.winRate)}%  100%+ MFE hit=${fmt(baseline.hit100MfeRate)}%  100%+ REALIZED hit=${fmt(baseline.hit100RealizedRate)}%`);
  console.log(`avg realized P&L=${fmt(baseline.avgRealizedPnlPct)}%  avg MFE=${fmt(baseline.avgMfePct)}%  avg MAE=${fmt(baseline.avgMaePct)}%\n`);

  if (baseline.n < MIN_N * 2) {
    console.log(`*** WARNING: closed population (n=${baseline.n}) is thin relative to min-n=${MIN_N} — every verdict below should be read as a FIRST LOOK, not a settled conclusion. ***\n`);
  }

  for (const v of perVariable) {
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

  console.log("\n=== END — this is a report, not a gate. No commit/discovery logic was touched. ===\n");
  await releaseAuditClerkSession();
}

main().catch(async (err) => {
  console.error("[banger-discovery-edge-analysis] fatal:", err);
  await releaseAuditClerkSession();
  process.exitCode = 1;
});
