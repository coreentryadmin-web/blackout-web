#!/usr/bin/env node
/**
 * SWING LOSS-TAXONOMY SEGMENTATION — v6 item 1 (Night Hawk Swings outcome-driven improvement
 * mandate). Does the aggregate loss taxonomy this lane already built by hand (5 BAD_EXIT / 3
 * BAD_ENTRY / 3 VARIANCE, n=31, journaled 2026-09-10) conceal a Simpson's-paradox-shaped
 * concentration once split by ARCHETYPE, SUB-LANE, or broad-market REGIME — or is the loss shape
 * genuinely uniform across the book?
 *
 * WHAT'S REAL. `archetype`/`subLane` come straight off each closed chain (`GET
 * /api/market/swing/record`'s `closedDeck`, already the source every other tool in this lane's
 * toolkit reads). REGIME is not exposed on that route (it lives in each row's server-side
 * `feature_vector.pil_regime`, pinned at commit but never surfaced to the member-facing record
 * route) — so it is independently RECONSTRUCTED the same way `swing-gate-compound-funnel.mjs`
 * already does for live candidates: `regimeFromSpyTrend` (swing-ingest.ts, the REAL production
 * function) fed REAL Polygon SPY daily closes, sliced to the bars available as of each chain's own
 * `committedAt` date (never "today" — that would leak the future into a historical read) and
 * direction-aligned exactly as production does. `emaStackFromCloses` needs >=55 daily bars before a
 * trend stack exists at all, so a chain committed too early in the fetched window reads UNKNOWN
 * regime honestly rather than guessing.
 *
 * Loss-taxonomy classification is MECHANICAL (peak-vs-entry MFE vs exit P&L), not a re-run of the
 * hand-curated journal list — see `lib/swing-loss-taxonomy-segment-eval.mjs`'s header for the exact
 * rule and why it's disclosed as a fresh classifier, not a byte-for-byte match.
 *
 * USAGE
 *   env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY \
 *   node --import tsx scripts/audit/swing-loss-taxonomy-segment.mjs [--days=90] [--min-n=5] [--base=https://blackouttrades.com] [--json]
 */
import { fetchAuditJson, releaseAuditClerkSession } from "./lib/audit-auth-fetch.mjs";
import { classifyLossBucket, segmentTaxonomy, flagDivergentSegments } from "./lib/swing-loss-taxonomy-segment-eval.mjs";

if (!process.env.POLYGON_API_BASE || !/^https?:\/\//.test(process.env.POLYGON_API_BASE)) {
  process.env.POLYGON_API_BASE = "https://api.massive.com";
}

const args = process.argv.slice(2);
const flag = (name, def) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=").slice(1).join("=") : def;
};
const DAYS = Math.min(90, Math.max(1, Number(flag("days", "90")) || 90));
const MIN_N = Math.max(1, Number(flag("min-n", "5")) || 5);
const BASE = flag("base", "https://blackouttrades.com");
const JSON_OUT = args.includes("--json");
const SRC = new URL("../../src/", import.meta.url).href;

async function main() {
  const res = await fetchAuditJson(BASE, `/api/market/swing/record?days=${DAYS}`);
  if (!res.ok || !res.json?.closedDeck) {
    if (JSON_OUT) console.log(JSON.stringify({ ok: false, insufficient_data: true, status: res.status, via: res.via }, null, 2));
    else console.log(`INSUFFICIENT DATA — GET /api/market/swing/record?days=${DAYS} -> ${res.status} via=${res.via ?? "none"}`);
    await releaseAuditClerkSession();
    process.exitCode = 1;
    return;
  }

  const rows = (res.json.closedDeck ?? []).map((c) => ({
    ticker: c.ticker,
    direction: c.direction === "SHORT" ? "SHORT" : "LONG",
    archetype: c.archetype ?? null,
    subLane: c.subLane ?? null,
    committedAt: c.committedAt ?? null,
    entryPremium: typeof c.entryPremium === "number" ? c.entryPremium : null,
    peakPremium: typeof c.peakPremium === "number" ? c.peakPremium : null,
    exitPnlPct: typeof c.exitPnlPct === "number" ? c.exitPnlPct : null,
  }));

  if (!rows.length) {
    if (JSON_OUT) console.log(JSON.stringify({ ok: true, population: 0, insufficient_data: true }, null, 2));
    else console.log("INSUFFICIENT DATA — closedDeck is empty for this window.");
    await releaseAuditClerkSession();
    return;
  }

  // Real production functions — never reimplemented.
  const { regimeFromSpyTrend } = await import(`${SRC}lib/swing/swing-ingest.ts`);
  const { regimeBandFor01 } = await import(`${SRC}lib/swing/v2/regime.ts`);
  const { fetchStockDailyBars } = await import(`${SRC}lib/providers/polygon.ts`);

  // Wide SPY window: earliest committedAt in this population, minus a buffer for the 55-bar EMA
  // stack requirement, through today.
  const committedMs = rows.map((r) => (r.committedAt ? Date.parse(r.committedAt) : NaN)).filter(Number.isFinite);
  const earliestMs = committedMs.length ? Math.min(...committedMs) : Date.now() - DAYS * 86_400_000;
  const fromYmd = new Date(earliestMs - 120 * 86_400_000).toISOString().slice(0, 10);
  const toYmd = new Date().toISOString().slice(0, 10);
  const spyBars = await fetchStockDailyBars("SPY", fromYmd, toYmd).catch(() => []);
  const spyBarsSorted = [...(spyBars ?? [])].filter((b) => Number.isFinite(b?.t) && Number.isFinite(b?.c)).sort((a, b) => a.t - b.t);

  const classified = rows.map((r) => {
    const bucket = classifyLossBucket(r);
    let regimeBand = "UNKNOWN";
    if (r.committedAt) {
      const cutMs = Date.parse(r.committedAt);
      if (Number.isFinite(cutMs)) {
        const closesAsOf = spyBarsSorted.filter((b) => b.t <= cutMs).map((b) => b.c);
        const regime01 = regimeFromSpyTrend(closesAsOf, r.direction);
        regimeBand = regimeBandFor01(regime01);
      }
    }
    return { ...r, bucket, regimeBand };
  });

  const byArchetype = segmentTaxonomy(
    classified.map((r) => ({ key: r.archetype, bucket: r.bucket })),
    { minN: MIN_N }
  );
  const bySubLane = segmentTaxonomy(
    classified.map((r) => ({ key: r.subLane, bucket: r.bucket })),
    { minN: MIN_N }
  );
  const byRegime = segmentTaxonomy(
    classified.map((r) => ({ key: r.regimeBand, bucket: r.bucket })),
    { minN: MIN_N }
  );
  const divergent = {
    archetype: flagDivergentSegments(byArchetype, { deltaPp: 20, minN: MIN_N }),
    subLane: flagDivergentSegments(bySubLane, { deltaPp: 20, minN: MIN_N }),
    regime: flagDivergentSegments(byRegime, { deltaPp: 20, minN: MIN_N }),
  };

  if (JSON_OUT) {
    console.log(JSON.stringify({ ok: true, days: DAYS, minN: MIN_N, population: rows.length, byArchetype, bySubLane, byRegime, divergent }, null, 2));
    await releaseAuditClerkSession();
    return;
  }

  console.log(`\n=== SWING LOSS-TAXONOMY SEGMENTATION (${DAYS}d window, ${rows.length} closed chains, min-n=${MIN_N}) ===`);
  console.log(`Aggregate: n=${byArchetype.totalN}, loss rate ${byArchetype.aggregateLossRatePct}% (${JSON.stringify(byArchetype.aggregate)}), ${byArchetype.droppedUnclassifiable} dropped as unclassifiable.\n`);

  const printSegments = (label, result) => {
    console.log(`--- by ${label} ---`);
    for (const s of result.segments) {
      console.log(`  ${String(s.key).padEnd(22)} n=${String(s.n).padEnd(3)} loss_rate=${String(s.lossRatePct).padEnd(6)}% ${JSON.stringify(s.counts)}${s.thin ? "  [THIN, n<" + MIN_N + "]" : ""}`);
    }
  };
  printSegments("ARCHETYPE", byArchetype);
  printSegments("SUB-LANE", bySubLane);
  printSegments("REGIME (reconstructed, direction-aligned)", byRegime);

  console.log(`\n--- Simpson's-paradox check: non-thin segments diverging >=20pp from the aggregate loss rate ---`);
  for (const [dim, list] of Object.entries(divergent)) {
    if (!list.length) {
      console.log(`  ${dim}: none (no segment with n>=${MIN_N} diverges >=20pp from aggregate)`);
    } else {
      for (const s of list) console.log(`  ${dim}: ${s.key} — n=${s.n}, loss_rate=${s.lossRatePct}%, delta=${s.deltaFromAggregatePp >= 0 ? "+" : ""}${s.deltaFromAggregatePp}pp vs aggregate`);
    }
  }
  console.log(`\nNo gate/calibration changed by this script — evidence only.`);
  await releaseAuditClerkSession();
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
