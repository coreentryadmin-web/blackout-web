#!/usr/bin/env node
/**
 * BANGER LIVE-TICK-LOG VALIDATION FRAMEWORK (operator directive 2026-09-27, phase 3). Continuation
 * of the tick-level adversarial validation (#5521/#5522): that work found the cleaned 100/33/70
 * exit candidate's headline edge does not survive tick-level NBBO verification (+0.3pp, CI spans
 * zero) once Polygon's ARCHIVED quote tape is used as ground truth — but also found that archived
 * tape can genuinely disagree with what production's own live poll saw at the exact decision
 * instant (AVAV id=39, docs/audit/BANGER-EXIT-QUOTE-TICK-VALIDATION-2026-09-27.md). PR #5522 closed
 * that gap prospectively: `banger_quote_tick_log` now persists the EXACT snapshot data
 * `banger-live-sync`'s real cron already fetches, every tick, going forward.
 *
 * THIS SCRIPT is the framework that will evaluate an exit-rule candidate against that live log ONCE
 * ENOUGH REAL OBSERVATIONS HAVE ACCUMULATED. It is deliberately NOT a one-shot verdict:
 *   1. READINESS (always computed): for every closed banger position since the log's own discovered
 *      start date, does its logged tick coverage actually SPAN its real committed→closed lifecycle
 *      with no gap large enough to have missed the exact tick that decided its outcome
 *      (`banger-live-tick-coverage-eval.mjs`)? Reports the population by coverage bucket and, if
 *      short of the n=30 floor this toolkit uses elsewhere (helix-score-signal.mjs,
 *      swing-score-calibration.mjs), projects an ETA from the OBSERVED rate of new full-coverage
 *      closes -- never a guessed one.
 *   2. VERDICT (only computed once population >= the floor): replays the SAME CONTROL (100/50/50,
 *      production's real rule) vs CANDIDATE (100/33/70) configuration studied in #5521/#5522 --
 *      UNCHANGED, not re-tuned against whatever thin data exists today -- through the SAME oracle-
 *      tested tick-by-tick replay engine (`banger-quote-tick-replay-eval.mjs`), sourced from REAL
 *      captured ticks instead of a reconstruction.
 *
 * NO TUNING AGAINST THIN/HISTORICAL DATA, NO PRODUCTION DECISION-PATH CHANGE. Read-only against two
 * admin-gated export routes (closed-export, quote-tick-export). If population is short, this script
 * says so plainly and exits 0 -- an honest "not yet" is the correct output of an early run, not a
 * failure.
 *
 * USAGE
 *   node --import tsx scripts/audit/banger-live-tick-validation.mjs \
 *     [--days=180] [--lookback-days=400] [--base=https://blackouttrades.com] [--min-n=30] \
 *     [--cadence-minutes=5] [--concurrency=12] [--json]
 *
 * SECONDARY TOOL as of the 2026-09-27 phase-4 audit: `GET /api/admin/banger/quote-tick-
 * validation-status` (src/lib/banger/quote-tick-readiness.ts + quote-tick-verdict.ts) is now the
 * AUTHORITATIVE, always-live, in-process computation this framework runs on -- no manual run
 * required to check readiness. This script remains a useful independent, offline re-verification
 * path, but its own RTH-gap handling (banger-live-tick-coverage-eval.mjs's
 * `isLegitimateWeekendOrOvernightGap`) is a deliberately narrower, non-holiday-aware approximation
 * of the TS port's real `isTradingDayEt` -- see that function's own header.
 */
import { fetchAuditJson, releaseAuditClerkSession } from "./lib/audit-auth-fetch.mjs";
import { replayPairTick } from "./lib/banger-quote-tick-replay-eval.mjs";
import {
  ticksToReplaySeries,
  assessPositionCoverage,
  coverageEnvelopeOverlaps,
  buildReadinessReport,
  projectDaysToReadiness,
} from "./lib/banger-live-tick-coverage-eval.mjs";
import { aggregateVerdict } from "./lib/banger-tick-verdict-agg.mjs";

const args = process.argv.slice(2);
const flag = (name, def) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=").slice(1).join("=") : def;
};
const DAYS = Math.min(365, Math.max(1, Number(flag("days", "180")) || 180));
const LOOKBACK_DAYS = Math.max(1, Number(flag("lookback-days", "400")) || 400);
const BASE = flag("base", "https://blackouttrades.com");
const MIN_N = Math.max(1, Number(flag("min-n", "30")) || 30);
// Confirmed via cron-registry.ts's schedule_cron_utc (2026-09-27 phase-4 audit): banger-live-sync
// fires every 5 minutes, market hours only. The prior default of 20 was an unverified guess.
const CADENCE_MINUTES = Math.max(1, Number(flag("cadence-minutes", "5")) || 5);
const CONCURRENCY = Math.max(1, Number(flag("concurrency", "12")) || 12);
const JSON_OUT = args.includes("--json");
const VERIFY_TOLERANCE_PP = 0.5; // tight: these are the EXACT ticks production computed, not a reconstruction.

// UNCHANGED from #5521/#5522 -- this framework never re-tunes the candidate against thin data.
const CONTROL = { scale_at_mult: 2.0, scale_fraction: 0.5, trail_from_peak: 0.5, hard_stop_mult: 0.4 };
const CANDIDATE = { scale_at_mult: 2.0, scale_fraction: 0.33, trail_from_peak: 0.7, hard_stop_mult: 0.4 };

function finite(x) {
  return typeof x === "number" && Number.isFinite(x);
}
function fmt(x, d = 1) {
  return x == null || x === Infinity ? (x === Infinity ? "∞" : "n/a") : Number(x).toFixed(d);
}
function log(...a) {
  if (!JSON_OUT) console.log(...a);
}

async function fetchWithConcurrency(items, worker, concurrency) {
  const results = new Array(items.length);
  let next = 0;
  async function runner() {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i]); // the sole caller's worker takes one destructured arg -- passing `i` too was superfluous (CodeQL)
    }
  }
  // `() => runner()` (not bare `runner`): Array.from's map callback invokes with (element, index),
  // which `runner` ignores by design (it pulls work via its own closured `next` counter, not the
  // index Array.from would pass) -- CodeQL's superfluous-arguments check flags the bare form as a
  // likely mistake, so we call explicitly with zero args to match runner's real, zero-arg signature.
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => runner()));
  return results;
}

function printAgg(agg) {
  if (agg.n === 0) {
    log("    NO DATA");
    return;
  }
  log(`    n=${agg.n} winRate=${fmt(agg.winRate)}% expectancy=${fmt(agg.expectancy)}% PF=${fmt(agg.profitFactor)} avgWin=${fmt(agg.avgWinner)}% avgLoss=${fmt(agg.avgLoser)}%`);
  log(`    medianCurrent=${fmt(agg.medianCurrent)}% medianCandidate=${fmt(agg.medianCandidate)}% totalReturn=${fmt(agg.totalReturnPts)}pts maxDD=${fmt(agg.maxDrawdownPts)}pts`);
  log(`    meanDelta=${fmt(agg.meanDelta)}pp [${fmt(agg.ci?.lo)},${fmt(agg.ci?.hi)}] -> ${agg.verdict}`);
}

async function main() {
  log(`Control (production's real rule): ${JSON.stringify(CONTROL)}`);
  log(`Candidate (100/33/70, UNCHANGED from #5521/#5522 -- not re-tuned): ${JSON.stringify(CANDIDATE)}`);

  const closedRes = await fetchAuditJson(BASE, `/api/admin/banger/closed-export?days=${DAYS}`);
  if (!closedRes.ok || !Array.isArray(closedRes.json?.rows)) {
    console.log("INSUFFICIENT DATA -- could not load closed-export", { status: closedRes.status });
    await releaseAuditClerkSession();
    process.exitCode = 1;
    return;
  }
  const closedRows = closedRes.json.rows.filter((r) => r.contract_occ && r.closed_at && (r.committed_at || r.session_date));

  const sinceIso = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const coverageRes = await fetchAuditJson(BASE, `/api/admin/banger/quote-tick-export?since=${encodeURIComponent(sinceIso)}`);
  if (!coverageRes.ok || !Array.isArray(coverageRes.json?.coverage)) {
    console.log("INSUFFICIENT DATA -- could not load quote-tick-export coverage", { status: coverageRes.status });
    await releaseAuditClerkSession();
    process.exitCode = 1;
    return;
  }
  const coverageRows = coverageRes.json.coverage;
  const coverageByOcc = new Map(coverageRows.map((c) => [c.contract_occ, c]));
  const logDiscoveredStartMs = coverageRows.length
    ? Math.min(...coverageRows.map((c) => Date.parse(c.first_tick_at)).filter(Number.isFinite))
    : null;

  log(`\nClosed positions in window (days=${DAYS}): ${closedRows.length}`);
  log(`Contracts with ANY logged tick coverage (lookback-days=${LOOKBACK_DAYS}): ${coverageRows.length}`);
  log(
    logDiscoveredStartMs
      ? `Log's own discovered start (earliest tick across every covered contract): ${new Date(logDiscoveredStartMs).toISOString()}`
      : `Log's own discovered start: NONE -- no ticks logged at all yet in this lookback window.`,
  );

  // Cheap pre-filter: does this position's contract have ANY aggregate coverage overlapping its
  // lifecycle at all? A position that fails this is provably NONE -- skip the per-tick fetch.
  const positionsWithLifecycle = closedRows.map((row) => ({
    row,
    committedAtMs: Date.parse(row.committed_at ?? `${row.session_date}T00:00:00Z`),
    closedAtMs: Date.parse(row.closed_at),
  }));
  const candidates = positionsWithLifecycle.filter(({ row, committedAtMs, closedAtMs }) =>
    coverageEnvelopeOverlaps({ committedAtMs, closedAtMs }, coverageByOcc.get(row.contract_occ), { edgeToleranceMinutes: 25 }),
  );
  log(`Positions whose coverage envelope overlaps their lifecycle (candidates for detail fetch): ${candidates.length}`);

  const detailed = await fetchWithConcurrency(
    candidates,
    async ({ row, committedAtMs, closedAtMs }) => {
      const since = new Date(committedAtMs).toISOString();
      const until = new Date(closedAtMs + 60 * 60_000).toISOString(); // +1h buffer past close
      const res = await fetchAuditJson(BASE, `/api/admin/banger/quote-tick-export?occ=${encodeURIComponent(row.contract_occ)}&since=${encodeURIComponent(since)}&until=${encodeURIComponent(until)}`);
      if (!res.ok || !Array.isArray(res.json?.ticks)) return { row, committedAtMs, closedAtMs, error: `detail_fetch_failed:${res.status}` };
      const ticks = ticksToReplaySeries(res.json.ticks);
      const coverage = assessPositionCoverage({ committedAtMs, closedAtMs, ticks }, { cadenceMinutes: CADENCE_MINUTES });
      return { row, committedAtMs, closedAtMs, ticks, coverage };
    },
    CONCURRENCY,
  );

  // Every closed position in the window gets a coverage entry -- non-overlapping ones are NONE
  // by construction (never fetched, but that IS the correct verdict for them).
  const noneOnly = positionsWithLifecycle
    .filter(({ row }) => !candidates.some((c) => c.row.id === row.id))
    .map(({ row, committedAtMs, closedAtMs }) => ({
      row,
      committedAtMs,
      closedAtMs,
      coverage: assessPositionCoverage({ committedAtMs, closedAtMs, ticks: [] }),
    }));
  const assessed = [...detailed, ...noneOnly];

  const readiness = buildReadinessReport(assessed, { minVerifiedN: MIN_N });
  log(`\n=== READINESS ===`);
  log(`  Coverage buckets: ${JSON.stringify(readiness.byBucket)}`);
  log(`  FULL coverage (usable for a verdict): ${readiness.fullCoverageN} / ${readiness.totalClosedPositionsInWindow}`);
  log(`  Floor for a verdict (matches this toolkit's own n>=30 convention): ${readiness.minVerifiedN}`);
  log(`  readyForVerdict: ${readiness.readyForVerdict}${readiness.readyForVerdict ? "" : ` (shortfall: ${readiness.shortfall})`}`);

  let dailyFullCoverageRate = null;
  if (logDiscoveredStartMs != null && readiness.fullCoverageN > 0) {
    const elapsedDays = Math.max(1 / 24, (Date.now() - logDiscoveredStartMs) / 86_400_000);
    dailyFullCoverageRate = readiness.fullCoverageN / elapsedDays;
  }
  if (!readiness.readyForVerdict) {
    const etaDays = projectDaysToReadiness(readiness.fullCoverageN, readiness.minVerifiedN, dailyFullCoverageRate);
    log(
      etaDays == null
        ? `  ETA to readiness: UNKNOWN -- not enough full-coverage closes yet to measure a rate. Re-run this script periodically; no verdict is computable until then.`
        : `  ETA to readiness at the observed rate (${fmt(dailyFullCoverageRate, 2)} full-coverage closes/day): ~${etaDays} more day(s). Re-run this script after that.`,
    );
  }

  if (JSON_OUT && !readiness.readyForVerdict) {
    console.log(JSON.stringify({ readiness, logDiscoveredStartMs, dailyFullCoverageRate }, null, 2));
    await releaseAuditClerkSession();
    return;
  }
  if (!readiness.readyForVerdict) {
    await releaseAuditClerkSession();
    return;
  }

  // ── VERDICT (only reached once population clears the floor) ──────────────────────────────────
  // Optional chaining on `r.coverage` matters here: a candidate whose detail fetch itself failed
  // (network/5xx) carries no `coverage` field at all (only `error`) -- it was already correctly
  // bucketed as NONE by buildReadinessReport's own `p.coverage?.coverage ?? "NONE"`, and must be
  // excluded here the same safe way rather than throwing on `.coverage` of undefined.
  const fullRows = assessed.filter((r) => r.coverage?.coverage === "FULL" && r.ticks && finite(r.row.entry_premium) && r.row.entry_premium > 0);

  let verifiedN = 0;
  let modelMismatchN = 0;
  const tradeRows = [];
  for (const r of fullRows) {
    const pair = replayPairTick(r.ticks, r.row.entry_premium, CONTROL, CANDIDATE);
    const realPct = finite(r.row.realized_pnl_pct) ? r.row.realized_pnl_pct : null;
    const modelMatch = realPct != null && finite(pair.control.modelPct) ? Math.abs(pair.control.modelPct - realPct) : null;
    const verified = modelMatch != null && modelMatch <= VERIFY_TOLERANCE_PP;
    if (verified) verifiedN++;
    else if (modelMatch != null) modelMismatchN++;
    if (!verified) continue; // a full-coverage row whose replay doesn't reproduce the real recorded outcome is a framework-correctness signal, not a usable trade row -- excluded, never forced in.
    tradeRows.push({
      id: r.row.id,
      ticker: r.row.ticker,
      current: pair.control.modelPct,
      currentExec: pair.control.execPct,
      cand: { realizedPnlPct: pair.candidate.modelPct, delta: pair.modelDelta },
      candExec: { realizedPnlPct: pair.candidate.execPct, delta: pair.execDelta },
    });
  }

  log(`\n=== VERIFICATION (control MODEL replay vs. real recorded realized_pnl_pct, tolerance=${VERIFY_TOLERANCE_PP}pp -- tight, since these ARE the exact ticks production saw) ===`);
  log(`  VERIFIED: ${verifiedN} / ${fullRows.length}${fullRows.length ? ` (${fmt((verifiedN / fullRows.length) * 100)}%)` : ""}`);
  if (modelMismatchN > 0) {
    log(`  ${modelMismatchN} full-coverage row(s) did NOT reproduce the real recorded outcome within tolerance -- excluded from the verdict below; this is worth investigating as a possible framework bug, since these ARE production's own captured ticks.`);
  }

  const aggModel = aggregateVerdict(tradeRows, "cand", "current");
  const aggExec = aggregateVerdict(tradeRows.map((r) => ({ ...r, current: r.currentExec, cand: r.candExec })), "cand", "current");

  log(`\n=== VERDICT: 100/33/70 vs production's real 100/50/50 (live-tick-log-sourced, n=${aggModel.n}) ===`);
  log(`  MODEL fills:`);
  printAgg(aggModel);
  log(`  EXEC (realistic executable) fills:`);
  printAgg(aggExec);

  if (JSON_OUT) {
    console.log(JSON.stringify({ readiness, verifiedN, modelMismatchN, aggModel, aggExec }, null, 2));
  }

  await releaseAuditClerkSession();
}

main().catch(async (e) => {
  console.error(e);
  await releaseAuditClerkSession().catch(() => {});
  process.exitCode = 1;
});
