#!/usr/bin/env node
/**
 * SWING REPEAT-ENTRY OUTCOME — research question raised on PR #4076 (2026-10-26, Ask Largo
 * standing mandate). Live repro that prompted this: GOOG stopped out 3 times in a 10-day window
 * (positionId 55 PULLBACK_CONTINUATION 10-12, 59 SECTOR_ROTATION 10-15, 64 EVENT_DRIVEN 10-21),
 * each new entry trigger sitting BELOW the previous position's own invalidation level — three
 * INDEPENDENT archetype classifiers each called a LONG bottom on a declining name. One ticker's
 * 3-instance anecdote is not evidence a gate is warranted; this measures the real question on the
 * full closed population instead: does win rate actually degrade on the 2nd/3rd same-ticker-
 * same-direction attempt within a short window, or is that just how a busy, high-count book looks?
 *
 * WHAT'S REAL. Reads the real closed population (`GET /api/market/swing/record`'s `closedDeck`,
 * the same source every sibling tool in this toolkit reads), derives each row's ATTEMPT NUMBER via
 * `withAttemptSequence` (lib/swing-repeat-entry-eval.mjs — groups by ticker+direction, resets the
 * sequence whenever the gap since the prior exit exceeds `--window-days`), classifies WIN/LOSS via
 * the SAME mechanical `classifyLossBucket` rule `swing-loss-taxonomy-segment.mjs` already uses (no
 * second, independently-drifting taxonomy), then segments by attempt label with the SAME
 * `segmentTaxonomy`/`flagDivergentSegments` helpers that tool's Simpson's-paradox check uses.
 *
 * USAGE
 *   env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY \
 *   node --import tsx scripts/audit/swing-repeat-entry-outcome.mjs [--days=90] [--window-days=14] [--min-n=5] [--base=https://blackouttrades.com] [--json]
 */
import { fetchAuditJson, releaseAuditClerkSession } from "./lib/audit-auth-fetch.mjs";
import { withAttemptSequence } from "./lib/swing-repeat-entry-eval.mjs";
import { classifyLossBucket, segmentTaxonomy, flagDivergentSegments } from "./lib/swing-loss-taxonomy-segment-eval.mjs";

const args = process.argv.slice(2);
const flag = (name, def) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=").slice(1).join("=") : def;
};
const DAYS = Math.min(90, Math.max(1, Number(flag("days", "90")) || 90));
const WINDOW_DAYS = Math.max(1, Number(flag("window-days", "14")) || 14);
const MIN_N = Math.max(1, Number(flag("min-n", "5")) || 5);
const BASE = flag("base", "https://blackouttrades.com");
const JSON_OUT = args.includes("--json");

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
    committedAt: c.committedAt ?? null,
    exitAt: c.exitAt ?? null,
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

  const sequenced = withAttemptSequence(rows, { windowDays: WINDOW_DAYS });
  const classified = sequenced.map((r) => ({ ...r, bucket: classifyLossBucket(r) }));
  const notSequenced = classified.filter((r) => r.attemptLabel == null).length;

  const byAttempt = segmentTaxonomy(
    classified.map((r) => ({ key: r.attemptLabel, bucket: r.bucket })),
    { minN: MIN_N }
  );
  const divergent = flagDivergentSegments(byAttempt, { deltaPp: 20, minN: MIN_N });

  // Name the real repeat-entry clusters (attemptNumber >= 2) so a reader can see which tickers are
  // actually driving the 2nd/3rd+ buckets, not just the aggregate numbers.
  const repeatClusters = classified
    .filter((r) => (r.attemptNumber ?? 0) >= 2)
    .map((r) => `${r.ticker} ${r.direction} (${r.attemptLabel}, ${r.committedAt?.slice(0, 10)}, bucket=${r.bucket ?? "unclassifiable"})`);

  if (JSON_OUT) {
    console.log(JSON.stringify({ ok: true, days: DAYS, windowDays: WINDOW_DAYS, minN: MIN_N, population: rows.length, notSequenced, byAttempt, divergent, repeatClusters }, null, 2));
    await releaseAuditClerkSession();
    return;
  }

  console.log(`\n=== SWING REPEAT-ENTRY OUTCOME (${DAYS}d window, ${rows.length} closed chains, ${WINDOW_DAYS}-day repeat window, min-n=${MIN_N}) ===`);
  console.log(`Aggregate: n=${byAttempt.totalN}, loss rate ${byAttempt.aggregateLossRatePct}%, ${notSequenced} dropped (missing ticker/direction/committedAt), ${byAttempt.droppedUnclassifiable} unclassifiable.\n`);

  console.log(`--- by ATTEMPT (same ticker+direction, gap <= ${WINDOW_DAYS}d since the prior exit) ---`);
  for (const s of byAttempt.segments) {
    console.log(`  ${String(s.key).padEnd(8)} n=${String(s.n).padEnd(3)} loss_rate=${String(s.lossRatePct).padEnd(6)}% ${JSON.stringify(s.counts)}${s.thin ? "  [THIN, n<" + MIN_N + "]" : ""}`);
  }

  console.log(`\n--- real repeat-entry clusters this run actually found (attempt >= 2) ---`);
  if (!repeatClusters.length) console.log("  none — no same-ticker-same-direction row re-entered within the window in this population.");
  else for (const line of repeatClusters) console.log(`  ${line}`);

  console.log(`\n--- Simpson's-paradox check: non-thin attempt-buckets diverging >=20pp from the aggregate loss rate ---`);
  if (!divergent.length) console.log(`  none (no bucket with n>=${MIN_N} diverges >=20pp from aggregate)`);
  else for (const s of divergent) console.log(`  ${s.key} — n=${s.n}, loss_rate=${s.lossRatePct}%, delta=${s.deltaFromAggregatePp >= 0 ? "+" : ""}${s.deltaFromAggregatePp}pp vs aggregate`);

  console.log(`\nNo gate/calibration changed by this script — evidence only, per #4076.`);
  await releaseAuditClerkSession();
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
