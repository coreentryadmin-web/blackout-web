#!/usr/bin/env node
/**
 * BANGER EXIT CANDIDATE HEAD-TO-HEAD VALIDATION (operator directive 2026-09-27, follow-up to the
 * exit-optimization grid study). Validates the two candidates the operator named — +100% trigger /
 * 50% scale-out, and +200% trigger / 67% scale-out — against Banger's REAL production exit behavior,
 * trade by trade, with the overfitting/outlier checks the operator asked for.
 *
 * THIS SCRIPT CHANGES NOTHING IN PRODUCTION. Read-only. It reports evidence for further validation;
 * it does not ship or gate anything. Native swing is untouched — this is Banger only, per the
 * operator's explicit instruction to keep native swing on hold until its closed population grows.
 *
 * METHODOLOGY NOTE (see lib/banger-exit-headtohead-eval.mjs's header for the full derivation): for
 * the ~43% of closed Banger rows where a real partial already fired (`scaled_already: true`), the
 * exported `realized_pnl_pct` is itself a blend of that partial + the runner's fate. Both candidates
 * are evaluated against a RECONSTRUCTED single-leg return (inverting production's own known, fixed
 * blend), not against the raw exported field — verified empirically to make Candidate A (which
 * matches production's own real trigger/fraction) reproduce `current` exactly, proving the
 * reconstruction is correct rather than assuming it.
 *
 * USAGE
 *   node --import tsx scripts/audit/banger-exit-headtohead-validation.mjs [--days=270] [--base=...] [--min-n=10] [--csv=out.csv] [--json]
 */
import { fetchAuditJson, releaseAuditClerkSession } from "./lib/audit-auth-fetch.mjs";
import {
  buildTradeRow,
  candidateEqualsCurrent,
  aggregateHeadToHead,
  meanDeltaCi,
} from "./lib/banger-exit-headtohead-eval.mjs";
import { splitByDateHalves } from "./lib/swing-exit-optimization-eval.mjs";
import { chooseBucketCount } from "./lib/banger-discovery-edge-eval.mjs";
import { writeFileSync } from "node:fs";

// This sandbox ships POLYGON_API_BASE as the literal unresolved string "POLYGON_API_BASE" when
// unset -- a bare truthiness check would pass and every Polygon fetch would then 404 silently,
// reading as "no VIX data" rather than a config gap (CLAUDE.md's own documented trap).
if (!process.env.POLYGON_API_BASE || !/^https?:\/\//.test(process.env.POLYGON_API_BASE)) {
  process.env.POLYGON_API_BASE = "https://api.massive.com";
}

const SRC = new URL("../../src/", import.meta.url).pathname;

const args = process.argv.slice(2);
const flag = (name, def) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=").slice(1).join("=") : def;
};
const DAYS = Math.min(365, Math.max(1, Number(flag("days", "270")) || 270));
const BASE = flag("base", "https://blackouttrades.com");
const MIN_N = Math.max(2, Number(flag("min-n", "10")) || 10);
const CSV_PATH = flag("csv", null);
const JSON_OUT = args.includes("--json");

function finite(x) {
  return typeof x === "number" && Number.isFinite(x);
}
function fmt(x, d = 1) {
  return x == null || x === Infinity ? (x === Infinity ? "∞" : "n/a") : Number(x).toFixed(d);
}

const CANDIDATES = {
  a: { triggerPct: 100, fraction: 0.5 },
  b: { triggerPct: 200, fraction: 0.67 },
};

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

function quantileBucket(rows, keyFn, minPerBucket) {
  const usable = rows.map((r) => ({ row: r, key: keyFn(r) })).filter((x) => finite(x.key));
  const bucketCount = chooseBucketCount(usable.length, { minPerBucket });
  const sorted = [...usable].sort((a, b) => a.key - b.key);
  const buckets = Array.from({ length: bucketCount }, () => []);
  sorted.forEach((x, i) => {
    const idx = Math.min(bucketCount - 1, Math.floor((i / sorted.length) * bucketCount));
    buckets[idx].push(x);
  });
  return buckets
    .filter((b) => b.length > 0)
    .map((b) => ({ label: `${b[0].key.toFixed(1)}..${b[b.length - 1].key.toFixed(1)}`, rows: b.map((x) => x.row) }));
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

function printAgg(prefix, label, agg) {
  console.log(`${prefix}${label}: n=${agg.n} reach=${fmt(agg.reachRatePct)}% stopRate=${fmt(agg.stopRatePct)}%`);
  console.log(
    `${prefix}  win=${fmt(agg.winRate)}% medianReal=${fmt(agg.medianRealized)}% (vs medianCurrent=${fmt(agg.medianCurrent)}%) ` +
    `expectancy=${fmt(agg.expectancy)}% PF=${fmt(agg.profitFactor)}`,
  );
  console.log(
    `${prefix}  totalReturn(pts) candidate=${fmt(agg.totalReturnPtsCandidate)} current=${fmt(agg.totalReturnPtsCurrent)} | ` +
    `maxDD(pts) candidate=${fmt(agg.maxDrawdownPtsCandidate)} current=${fmt(agg.maxDrawdownPtsCurrent)}`,
  );
  console.log(`${prefix}  avgGiveback=${fmt(agg.avgGivebackPts)}pts avgMFEcap=${fmt(agg.avgMfeCapturedPct)}%`);
  console.log(`${prefix}  meanDelta=${fmt(agg.meanDelta)}pp [${fmt(agg.ci?.lo)},${fmt(agg.ci?.hi)}] -> ${agg.verdict}`);
  if (agg.concentration) {
    const c = agg.concentration;
    console.log(
      `${prefix}  outlier check: totalDelta=${fmt(c.totalDelta)}pp; top1=${fmt(c.byTopK[0]?.sharePct)}% top5=${fmt(c.byTopK.find((x) => x.k === 5)?.sharePct)}% top10=${fmt(c.byTopK.find((x) => x.k === 10)?.sharePct)}% of total delta`,
    );
    console.log(
      `${prefix}  leave-out-top-1: meanDelta=${fmt(agg.leaveOutTop1.meanDelta)} -> ${agg.leaveOutTop1.verdict} | ` +
      `leave-out-top-5: meanDelta=${fmt(agg.leaveOutTop5.meanDelta)} -> ${agg.leaveOutTop5.verdict} | ` +
      `leave-out-top-10: meanDelta=${fmt(agg.leaveOutTop10.meanDelta)} -> ${agg.leaveOutTop10.verdict}`,
    );
    console.log(`${prefix}  trimmed mean (5% each tail): ${fmt(agg.trimmedMean5pct.trimmedMean)}pp (n=${agg.trimmedMean5pct.n})`);
  }
}

function toCsvRow(r) {
  const a = r.a ?? {};
  const b = r.b ?? {};
  return [
    r.id, r.ticker, r.sessionDate, r.contractExpiry, r.contractStrike, r.dte,
    r.entryPremium, r.peakPremium, r.troughPremium ?? "",
    r.scaleOutAction, r.status, r.committedAt, r.closedAt,
    r.current, r.peakPct, r.givebackPtsCurrent,
    a.realizedPnlPct ?? "", a.triggered ?? "", a.delta ?? "",
    b.realizedPnlPct ?? "", b.triggered ?? "", b.delta ?? "", b.givebackPts ?? "",
  ].join(",");
}
const CSV_HEADER = [
  "id", "ticker", "session_date", "contract_expiry", "contract_strike", "dte",
  "entry_premium", "peak_premium", "trough_premium",
  "scale_out_action", "status", "committed_at", "closed_at",
  "current_realized_pnl_pct", "peak_pct", "giveback_pts_current",
  "candA_realized_pnl_pct", "candA_triggered", "candA_delta_pp",
  "candB_realized_pnl_pct", "candB_triggered", "candB_delta_pp", "candB_giveback_pts",
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
  // Chronological order (by closed_at, falling back to committed_at) -- required for the equity-curve figures.
  const sorted = [...rawRows].sort((a, b) => Date.parse(a.closed_at ?? a.committed_at) - Date.parse(b.closed_at ?? b.committed_at));
  const tradeRows = sorted.map((row) => buildTradeRow(row, CANDIDATES));

  // ── Proof, not assertion: Candidate A reproduces `current` exactly (see eval module header) ──
  const proofA = candidateEqualsCurrent(tradeRows, "a");

  // ── Full-population aggregates for both candidates ──
  const aggA = aggregateHeadToHead(tradeRows, "a");
  const aggB = aggregateHeadToHead(tradeRows, "b");

  // ── Segmentation of Candidate B (the genuine alternative) by ticker / DTE / VIX regime ──
  // DTE is a narrow, discrete field for Banger (weekly expiries -> mostly 4-10 days) -- quantile
  // bucketing on it collapses into overlapping/degenerate labels (e.g. "8.0..8.0"), so it is
  // segmented CATEGORICALLY by exact DTE value instead, same as ticker.
  const byTicker = categoryBucket(tradeRows, (r) => r.ticker).filter((g) => g.rows.length >= MIN_N);
  const byDte = categoryBucket(tradeRows, (r) => r.dte)
    .filter((g) => g.rows.length >= MIN_N)
    .sort((a, b) => Number(a.label) - Number(b.label))
    .map((g) => ({ label: `${g.label}d`, ...aggregateHeadToHead(g.rows, "b") }));

  const vixMap = await fetchVixByDate(
    sorted.reduce((min, r) => (r.session_date && r.session_date < min ? r.session_date : min), "9999-99-99"),
    sorted.reduce((max, r) => (r.session_date && r.session_date > max ? r.session_date : max), "0000-00-00"),
  );
  const withVix = tradeRows.map((r) => ({ ...r, __vix: vixMap.get(r.sessionDate) ?? null }));
  const byVix = quantileBucket(withVix.filter((r) => r.__vix != null), (r) => r.__vix, 100).map((g) => ({
    label: g.label, ...aggregateHeadToHead(g.rows, "b"),
  }));

  // ── Walk-forward: early vs late half, independently ──
  const split = splitByDateHalves(tradeRows, (r) => r.sessionDate);
  const earlyB = aggregateHeadToHead(split.early, "b");
  const lateB = aggregateHeadToHead(split.late, "b");
  const earlyA = aggregateHeadToHead(split.early, "a");
  const lateA = aggregateHeadToHead(split.late, "a");

  const payload = {
    ok: true,
    days: DAYS,
    population: rawRows.length,
    proofCandidateAEqualsCurrent: proofA,
    fullPopulation: { a: aggA, b: aggB },
    byTicker: byTicker.map((g) => ({ label: g.label, n: g.rows.length })),
    byDte: byDte,
    byVixRegime: byVix,
    vixCoverage: { covered: withVix.filter((r) => r.__vix != null).length, total: withVix.length },
    walkForward: { splitDate: split.splitDate, earlyN: split.early.length, lateN: split.late.length, early: { a: earlyA, b: earlyB }, late: { a: lateA, b: lateB } },
  };

  if (CSV_PATH) {
    const lines = [CSV_HEADER, ...tradeRows.map(toCsvRow)];
    writeFileSync(CSV_PATH, lines.join("\n") + "\n");
    console.error(`[csv] wrote ${tradeRows.length} trade rows to ${CSV_PATH}`);
  }

  if (JSON_OUT) {
    console.log(JSON.stringify(payload, null, 2));
    await releaseAuditClerkSession();
    return;
  }

  console.log(`\n=== BANGER EXIT CANDIDATE HEAD-TO-HEAD (n=${rawRows.length}, ${DAYS}d window) ===\n`);
  console.log(`--- PROOF: Candidate A (+100%/50%, production's own real rule) reproduces \`current\` ---`);
  console.log(`  n=${proofA.n} mismatches=${proofA.mismatchN} identical=${proofA.identical}`);
  if (!proofA.identical) console.log(`  sample mismatches: ${JSON.stringify(proofA.sampleMismatches)}`);

  console.log(`\n--- CANDIDATE A: +100% trigger / 50% scale-out (== current production rule) ---`);
  printAgg("  ", "A vs current", aggA);

  console.log(`\n--- CANDIDATE B: +200% trigger / 67% scale-out ---`);
  printAgg("  ", "B vs current", aggB);

  console.log(`\n--- Segmentation of Candidate B by ticker (n>=${MIN_N} only, top 10 by n) ---`);
  for (const g of byTicker.sort((a, b) => b.rows.length - a.rows.length).slice(0, 10)) {
    printAgg("  ", g.label, aggregateHeadToHead(g.rows, "b"));
  }

  console.log(`\n--- Segmentation of Candidate B by DTE (quantile buckets) ---`);
  for (const g of byDte) printAgg("  ", `DTE ${g.label}`, g);

  console.log(`\n--- Segmentation of Candidate B by VIX-at-entry regime (coverage ${payload.vixCoverage.covered}/${payload.vixCoverage.total}) ---`);
  for (const g of byVix) printAgg("  ", `VIX ${g.label}`, g);

  console.log(`\n--- Walk-forward: early vs late half (split ${split.splitDate}, early n=${split.early.length}, late n=${split.late.length}) ---`);
  console.log("  Candidate A:");
  printAgg("    ", "early", earlyA);
  printAgg("    ", "late", lateA);
  console.log("  Candidate B:");
  printAgg("    ", "early", earlyB);
  printAgg("    ", "late", lateB);

  console.log(`\n=== END — evidence for further validation only. No production behavior changed. ===\n`);
  await releaseAuditClerkSession();
}

main().catch(async (err) => {
  console.error("[banger-exit-headtohead-validation] fatal:", err);
  await releaseAuditClerkSession();
  process.exitCode = 1;
});
