#!/usr/bin/env node
/**
 * ADVERSARIAL REAL-BAR VALIDATION of the 100%/33%/70% Banger exit candidate (operator directive
 * 2026-09-27, the third and most demanding step in this validation chain — after the head-to-head
 * study (PR #5517) and the trail-optimization grid (PR #5519) both found 100/33/70 the standout
 * cell). The operator's explicit charge: "try to break" this configuration using data NOT used to
 * select it, and root-cause WHY its summary-tier expectancy reads +97.4% against production's own
 * +2.6% — ruling out leakage, look-ahead bias, a reconstruction bug, or a handful of outliers.
 *
 * THIS SCRIPT CHANGES NOTHING IN PRODUCTION. Read-only. It reports evidence; it does not ship or
 * gate anything. Native swing is untouched.
 *
 * METHOD — why a THIRD reconstruction layer, on top of the two already built:
 * `banger-exit-headtohead-eval.mjs` and `banger-exit-trail-grid-eval.mjs` both reconstruct a
 * candidate's outcome from SUMMARY fields (entry/peak/final realized_pnl_pct) under a disclosed
 * "single monotonic decline from the FINAL recorded peak" assumption. That assumption has a
 * specific, named failure mode for a TIGHTER trail (70%, closer to peak) than production's real,
 * looser 50%: if the real historical price path had multiple separate peak-then-retrace cycles
 * before production's own trail finally closed the position, the reconstruction wrongly credits
 * the tighter candidate with the FINAL, highest peak — one it could never have actually observed,
 * because it would have exited earlier. `banger-real-bar-replay-eval.mjs` (this run's engine)
 * removes that assumption entirely: it replays the REAL Polygon daily option bars for each real
 * closed contract, running control (100/50/50, exactly production's own rule) and candidate
 * (100/33/70) against the IDENTICAL real price path. Where control's real-bar replay reproduces the
 * row's own actual recorded `realized_pnl_pct` (ground truth — what really happened), the pipeline
 * is verified for that row; where it does not, the row is flagged UNVERIFIED and excluded from the
 * adversarial comparison rather than silently trusted.
 *
 * DATA-AVAILABILITY DISCLOSURE (carried over from PR #5517/#5519, still true): the entire closed
 * Banger population is fixed at n≈1310 regardless of `--days`, spanning session_date 2026-08-04
 * through 2026-09-24 (closed_at through 2026-09-25) — a single ~7-8 week window, one calendar year.
 * There is NO additional held-out data beyond what PR #5519's grid selection already used. The
 * "early vs late OOS" and "by year" splits below are reported honestly against this constraint, not
 * dressed up as a genuine unseen-data test.
 *
 * USAGE
 *   node --import tsx scripts/audit/banger-exit-adversarial-real-bar-validation.mjs \
 *     [--days=365] [--base=...] [--max-positions=N] [--concurrency=8] [--slippage=0.02] \
 *     [--csv=out.csv] [--json]
 */
import { fetchAuditJson, releaseAuditClerkSession } from "./lib/audit-auth-fetch.mjs";
import { replayPair } from "./lib/banger-real-bar-replay-eval.mjs";
import {
  aggregateHeadToHead,
  equityCurveStats,
  meanDeltaCi,
  deltaConcentration,
  leaveOutTopKVerdict,
  trimmedMeanDelta,
} from "./lib/banger-exit-headtohead-eval.mjs";
import { buildRegimeByDateMap, classifyVolLabel, median } from "./lib/banger-regime-classify.mjs";
import { buildGridTradeRow, aggregateGridConfig, PRODUCTION_CONFIG } from "./lib/banger-exit-trail-grid-eval.mjs";
import { flagBackstopQuoteContamination, contaminationDeltaShare } from "./lib/banger-backstop-contamination-eval.mjs";
import { writeFileSync } from "node:fs";

if (!process.env.POLYGON_API_BASE || !/^https?:\/\//.test(process.env.POLYGON_API_BASE)) {
  process.env.POLYGON_API_BASE = "https://api.massive.com";
}
const SRC = new URL("../../src/", import.meta.url).pathname;

const args = process.argv.slice(2);
const flag = (name, def) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=").slice(1).join("=") : def;
};
const DAYS = Math.min(365, Math.max(1, Number(flag("days", "365")) || 365));
const BASE = flag("base", "https://blackouttrades.com");
const MAX_POSITIONS = Number(flag("max-positions", "0")) || 0; // 0 = no cap
const CONCURRENCY = Math.max(1, Number(flag("concurrency", "8")) || 8);
const SLIPPAGE = Math.max(0, Number(flag("slippage", "0.02")) || 0);
const CSV_PATH = flag("csv", null);
const CSV_GRID_PATH = flag("csv-grid", null);
const JSON_OUT = args.includes("--json");
const VERIFY_TOLERANCE_PP = 3; // percentage points -- control-replay-vs-real-recorded tolerance

function finite(x) {
  return typeof x === "number" && Number.isFinite(x);
}
function fmt(x, d = 1) {
  return x == null || x === Infinity ? (x === Infinity ? "∞" : "n/a") : Number(x).toFixed(d);
}
function log(...a) {
  if (!JSON_OUT) console.log(...a);
}

const CONTROL = { scale_at_mult: 2.0, scale_fraction: 0.5, trail_from_peak: 0.5 };
const CANDIDATE = { scale_at_mult: 2.0, scale_fraction: 0.33, trail_from_peak: 0.7 };

async function fetchWithConcurrency(items, worker, concurrency) {
  const results = new Array(items.length);
  let next = 0;
  async function runner() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, runner));
  return results;
}

function dateOnly(d) {
  return new Date(d).toISOString().slice(0, 10);
}
function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return dateOnly(d);
}

async function main() {
  const { fetchPolygonOptionBars, fetchAggBars } = await import(`${SRC}lib/providers/polygon-largo.ts`);

  const res = await fetchAuditJson(BASE, `/api/admin/banger/closed-export?days=${DAYS}`);
  if (!res.ok || !Array.isArray(res.json?.rows)) {
    console.log("INSUFFICIENT DATA", { status: res.status });
    await releaseAuditClerkSession();
    process.exitCode = 1;
    return;
  }
  let rawRows = res.json.rows;
  rawRows = [...rawRows].sort((a, b) => Date.parse(a.closed_at ?? a.committed_at) - Date.parse(b.closed_at ?? b.committed_at));
  const fullPopulationN = rawRows.length;
  if (MAX_POSITIONS > 0) rawRows = rawRows.slice(0, MAX_POSITIONS);

  log(`Fetched ${fullPopulationN} closed rows (using ${rawRows.length} this run), fetching real Polygon option bars (concurrency=${CONCURRENCY})...`);

  // ── Fetch real bars per contract, chronological range = session_date .. min(closed_at, expiry)+2d ──
  let fetchOk = 0, fetchEmpty = 0, fetchErr = 0;
  const withBars = await fetchWithConcurrency(
    rawRows,
    async (row) => {
      if (!row.contract_occ || !finite(row.entry_premium) || row.entry_premium <= 0) return { row, bars: null, fetchReason: "missing_contract_or_entry" };
      const from = row.session_date ?? dateOnly(row.committed_at);
      const closedDate = row.closed_at ? dateOnly(row.closed_at) : null;
      const expiryDate = row.contract_expiry ?? null;
      const toCandidates = [closedDate, expiryDate].filter(Boolean);
      const to = toCandidates.length ? addDays(toCandidates.sort()[0], 2) : addDays(from, 10);
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const bars = await fetchPolygonOptionBars(row.contract_occ, 1, "day", from, to, "250");
          if (!Array.isArray(bars) || bars.length === 0) {
            if (attempt === 0) { await new Promise((r) => setTimeout(r, 300)); continue; }
            fetchEmpty++;
            return { row, bars: null, fetchReason: "empty_bars" };
          }
          fetchOk++;
          return { row, bars, fetchReason: null };
        } catch (e) {
          if (attempt === 0) { await new Promise((r) => setTimeout(r, 300)); continue; }
          fetchErr++;
          return { row, bars: null, fetchReason: `fetch_error:${String(e).slice(0, 120)}` };
        }
      }
    },
    CONCURRENCY,
  );
  log(`Bar fetch: ok=${fetchOk} empty=${fetchEmpty} error=${fetchErr} skipped=${withBars.length - fetchOk - fetchEmpty - fetchErr}`);

  // ── SUMMARY-TIER cross-check on the FULL population (n=rawRows.length) -- this is the actual
  // source of the operator-quoted "+2.6% -> +97.4%" expectancy jump (PR #5519's trail grid), which
  // had NOT yet had the outlier-concentration / leave-out-top-K / trimmed-mean checks run against
  // it specifically (those were only run for the two head-to-head candidates in PR #5517, at
  // different trigger/fraction values). Runs FIRST, before the real-bar section below, because it
  // answers the outlier-concentration question directly and completely on the population that
  // actually produced the headline number -- independent of the real-bar section's own, separate
  // (and much narrower, liquidity-biased) verified subset. ──
  const gridConfigs = { control: PRODUCTION_CONFIG, cand: { triggerPct: 100, fraction: 0.33, trailFrac: 0.7 } };
  const gridTradeRows = rawRows.map((row) => buildGridTradeRow(row, gridConfigs));
  const gridAggControl = aggregateGridConfig(gridTradeRows, "control");
  const gridAggCand = aggregateGridConfig(gridTradeRows, "cand");
  const gridConcentration = deltaConcentration(gridTradeRows, "cand");
  const gridLeaveOut1 = leaveOutTopKVerdict(gridTradeRows, "cand", 1);
  const gridLeaveOut5 = leaveOutTopKVerdict(gridTradeRows, "cand", 5);
  const gridLeaveOut10 = leaveOutTopKVerdict(gridTradeRows, "cand", 10);
  const gridLeaveOut20 = leaveOutTopKVerdict(gridTradeRows, "cand", 20);
  const gridTrimmed = trimmedMeanDelta(gridTradeRows, "cand", 5);

  log(`\n=== SUMMARY-TIER (full population, n=${gridTradeRows.length}) — the population that produced the quoted +2.6%->+97.4% jump ===`);
  log(`  CONTROL (100/50/50, production): n=${gridAggControl.n} expectancy=${fmt(gridAggControl.expectancy)}% winRate=${fmt(gridAggControl.winRate)}% PF=${fmt(gridAggControl.profitFactor)} medianReal=${fmt(gridAggControl.medianRealized)}%`);
  log(`  CANDIDATE (100/33/70): n=${gridAggCand.n} expectancy=${fmt(gridAggCand.expectancy)}% winRate=${fmt(gridAggCand.winRate)}% PF=${fmt(gridAggCand.profitFactor)} medianReal=${fmt(gridAggCand.medianRealized)}%`);
  log(`  flippedToLoserN=${gridAggCand.flippedToLoserN} (${fmt(gridAggCand.flippedToLoserRatePct)}% of ${gridAggCand.actualWinnersN} real winners) largeWinnerDegradedN=${gridAggCand.degradedN} (${fmt(gridAggCand.degradedRatePct)}% of ${gridAggCand.largeWinnersN} large winners)`);
  log(`  meanDelta=${fmt(gridAggCand.meanDelta)}pp [${fmt(gridAggCand.ci?.lo)},${fmt(gridAggCand.ci?.hi)}] -> ${gridAggCand.verdict}`);
  log(`\n  OUTLIER CONCENTRATION (does the expectancy jump survive removing its own biggest movers?):`);
  log(`  totalDelta=${fmt(gridConcentration.totalDelta)}pp across n=${gridConcentration.n}`);
  for (const k of gridConcentration.byTopK) log(`  top${k.k}: sum=${fmt(k.sumTopK)}pp share=${fmt(k.sharePct)}% of total delta`);
  log(`  leave-out-top-1:  meanDelta=${fmt(gridLeaveOut1.meanDelta)}pp -> ${gridLeaveOut1.verdict}`);
  log(`  leave-out-top-5:  meanDelta=${fmt(gridLeaveOut5.meanDelta)}pp -> ${gridLeaveOut5.verdict}`);
  log(`  leave-out-top-10: meanDelta=${fmt(gridLeaveOut10.meanDelta)}pp -> ${gridLeaveOut10.verdict}`);
  log(`  leave-out-top-20: meanDelta=${fmt(gridLeaveOut20.meanDelta)}pp -> ${gridLeaveOut20.verdict}`);
  log(`  trimmed mean (5% each tail): ${fmt(gridTrimmed.trimmedMean)}pp (n=${gridTrimmed.n})`);
  const top10ByDelta = [...gridTradeRows].filter((r) => finite(r.cand?.delta)).sort((a, b) => b.cand.delta - a.cand.delta).slice(0, 10);
  log(`  top 10 individual deltas driving the jump:`);
  for (const r of top10ByDelta) log(`    id=${r.id} ${r.ticker} current=${fmt(r.current)}% candidate=${fmt(r.cand.realizedPnlPct)}% delta=+${fmt(r.cand.delta)}pp scaleOutAction=${r.scaleOutAction} peakPct=${fmt(r.peakPct)}%`);

  // ── ROOT CAUSE: backstop-quote peak contamination (PR #4969, 2026-09-14) -- see
  // banger-backstop-contamination-eval.mjs's header for the full derivation. `peak_premium` is a
  // monotonic running max; a market-maker backstop ask on an untraded contract can produce a
  // bid=0/ask=$15 mid=$7.50 that gets permanently ratcheted in as "peak" for any CLOSED position
  // committed before the fix -- and a TIGHTER trail candidate captures a larger fraction of that
  // same inflated peak than production's own looser 50% trail does. ──
  const contamination = flagBackstopQuoteContamination(rawRows);
  const suspectIds = new Set(contamination.suspectRows.map((r) => r.id));
  const contamShare = contaminationDeltaShare(gridTradeRows, "cand", suspectIds);
  log(`\n  ROOT CAUSE -- BACKSTOP-QUOTE PEAK CONTAMINATION (PR #4969, fixed live-forward ${contamination.fixDate}; peak_premium's GREATEST ratchet cannot retroactively repair a pre-fix contaminated value):`);
  log(`  SUSPECT rows (peak_premium shared by >=${contamination.minSharedTickers} distinct tickers AND peakPct>=${contamination.minPeakPct}%): ${contamination.suspectN} / ${contamination.n} (${fmt(contamination.suspectRatePct)}%)`);
  log(`  ${contamination.beforeFixN} of ${contamination.suspectN} suspect rows are dated BEFORE the fix (${contamination.onOrAfterFixN} on/after -- residual gap, see report)`);
  log(`  suspect rows explain ${fmt(contamShare.sharePct)}% of the entire summed delta (${fmt(contamShare.suspectDelta)}pp of ${fmt(contamShare.totalDelta)}pp total)`);
  const meanSuspectCurrent = contamination.suspectRows.length
    ? contamination.suspectRows.reduce((a, r) => a + (finite(r.realized_pnl_pct) ? r.realized_pnl_pct : 0), 0) / contamination.suspectRows.length
    : null;
  log(`  mean production-REAL realized_pnl_pct on suspect rows: ${fmt(meanSuspectCurrent)}% (production's own real recorded outcome is ALSO inflated on these rows, not just the reconstruction)`);

  // ── CLEAN population re-run: exclude suspect rows entirely, re-check outlier concentration ──
  const cleanGridRows = gridTradeRows.filter((r) => !suspectIds.has(r.id));
  const cleanAggControl = aggregateGridConfig(cleanGridRows, "control");
  const cleanAggCand = aggregateGridConfig(cleanGridRows, "cand");
  const cleanConcentration = deltaConcentration(cleanGridRows, "cand");
  const cleanLeaveOut10 = leaveOutTopKVerdict(cleanGridRows, "cand", 10);
  const cleanLeaveOut20 = leaveOutTopKVerdict(cleanGridRows, "cand", 20);
  const cleanTrimmed = trimmedMeanDelta(cleanGridRows, "cand", 5);
  log(`\n  CLEAN POPULATION (suspect rows excluded, n=${cleanGridRows.length}, ${fmt((cleanGridRows.length / gridTradeRows.length) * 100)}% of full population):`);
  log(`  control: expectancy=${fmt(cleanAggControl.expectancy)}% winRate=${fmt(cleanAggControl.winRate)}% PF=${fmt(cleanAggControl.profitFactor)}`);
  log(`  candidate: expectancy=${fmt(cleanAggCand.expectancy)}% winRate=${fmt(cleanAggCand.winRate)}% PF=${fmt(cleanAggCand.profitFactor)}`);
  log(`  meanDelta=${fmt(cleanAggCand.meanDelta)}pp [${fmt(cleanAggCand.ci?.lo)},${fmt(cleanAggCand.ci?.hi)}] -> ${cleanAggCand.verdict}`);
  log(`  outlier concentration on the CLEAN population: top1=${fmt(cleanConcentration.byTopK[0]?.sharePct)}% top20=${fmt(cleanConcentration.byTopK.find((k) => k.k === 20)?.sharePct)}% of total delta (vs ${fmt(gridConcentration.byTopK[0]?.sharePct)}%/${fmt(gridConcentration.byTopK.find((k) => k.k === 20)?.sharePct)}% on the full/contaminated population)`);
  log(`  leave-out-top-10: meanDelta=${fmt(cleanLeaveOut10.meanDelta)}pp -> ${cleanLeaveOut10.verdict}`);
  log(`  leave-out-top-20: meanDelta=${fmt(cleanLeaveOut20.meanDelta)}pp -> ${cleanLeaveOut20.verdict}`);
  log(`  trimmed mean (5% each tail): ${fmt(cleanTrimmed.trimmedMean)}pp (n=${cleanTrimmed.n})`);

  // ── Replay control vs candidate against the SAME real bars; verify control against ground truth ──
  const replayed = withBars.map(({ row, bars, fetchReason }) => {
    if (!bars) return { row, fetchReason, verified: false, unverifiedReason: fetchReason };
    const pair = replayPair(bars, row.entry_premium, CONTROL, CANDIDATE);
    const real = finite(row.realized_pnl_pct) ? row.realized_pnl_pct : null;
    const controlMatch = real != null && finite(pair.control.realizedPnlPct) ? Math.abs(pair.control.realizedPnlPct - real) : null;
    const verified = controlMatch != null && controlMatch <= VERIFY_TOLERANCE_PP;
    return {
      row,
      pair,
      real,
      controlMatch,
      verified,
      unverifiedReason: verified ? null : controlMatch != null ? `control_replay_mismatch:${controlMatch.toFixed(1)}pp` : "no_ground_truth",
    };
  });

  const verifiedRows = replayed.filter((r) => r.verified);
  const unverifiedRows = replayed.filter((r) => !r.verified);
  log(`\nVERIFICATION GATE (control real-bar replay vs. row's own real recorded realized_pnl_pct, tolerance=${VERIFY_TOLERANCE_PP}pp):`);
  log(`  VERIFIED:   ${verifiedRows.length} / ${replayed.length}`);
  log(`  UNVERIFIED: ${unverifiedRows.length} / ${replayed.length}`);
  const reasonCounts = {};
  for (const r of unverifiedRows) reasonCounts[r.unverifiedReason?.split(":")[0] ?? "unknown"] = (reasonCounts[r.unverifiedReason?.split(":")[0] ?? "unknown"] ?? 0) + 1;
  log(`  unverified reasons:`, reasonCounts);
  if (unverifiedRows.length) {
    const mismatches = unverifiedRows.filter((r) => r.unverifiedReason?.startsWith("control_replay_mismatch"));
    if (mismatches.length) {
      const worst = [...mismatches].sort((a, b) => b.controlMatch - a.controlMatch).slice(0, 5);
      log(`  worst control-replay mismatches (top 5 by |delta|):`);
      for (const m of worst) log(`    id=${m.row.id} ${m.row.ticker} real=${fmt(m.real)}% replayControl=${fmt(m.pair?.control.realizedPnlPct)}% mismatch=${fmt(m.controlMatch)}pp exitCause=${m.pair?.control.exitCause}`);
    }
  }

  // ── Liquidity bias check: is verification failure concentrated in illiquid names, or spread
  // randomly? Production's live marks are NBBO quote-MID (marks-math.ts/live-marks.ts), never
  // trade prints -- a thin weekly option's quote-mid can move (and peak) on days with ZERO trade
  // prints, which Polygon's day-aggregate TRADE bars structurally cannot see. If verification
  // failure concentrates in low-$-volume names, the VERIFIED subset below is a real, disclosed
  // LIQUID-NAME BIAS, not a random sample -- must be reported, never silently assumed away. ──
  const dvolOf = (r) => (finite(r.row.discovery_dollar_vol) ? r.row.discovery_dollar_vol : null);
  const verifiedDvols = verifiedRows.map(dvolOf).filter(finite);
  const unverifiedDvols = unverifiedRows.map(dvolOf).filter(finite);
  const medianDvol = (arr) => {
    const s = [...arr].sort((a, b) => a - b);
    return s.length ? s[Math.floor(s.length / 2)] : null;
  };
  log(`\nLIQUIDITY BIAS CHECK (discovery $-volume as a liquidity proxy):`);
  log(`  median $-vol, VERIFIED (n=${verifiedDvols.length}): ${fmt(medianDvol(verifiedDvols) / 1e6, 1)}M`);
  log(`  median $-vol, UNVERIFIED (n=${unverifiedDvols.length}): ${fmt(medianDvol(unverifiedDvols) / 1e6, 1)}M`);

  // ── Build aggregateHeadToHead-compatible trade rows from the VERIFIED population only ──
  const barsByRowId = new Map(withBars.map((w) => [w.row.id, w.bars]));

  function buildTradeRowsForSlippage(slippagePct) {
    return verifiedRows.map((r) => {
      const { row } = r;
      const bars = barsByRowId.get(row.id);
      const pair = replayPair(bars, row.entry_premium, { ...CONTROL, slippagePctOfPremium: slippagePct }, { ...CANDIDATE, slippagePctOfPremium: slippagePct });
      const peakPct = row.entry_premium > 0 && finite(row.peak_premium) ? Math.round((row.peak_premium / row.entry_premium - 1) * 10000) / 100 : null;
      return {
        id: row.id,
        ticker: row.ticker,
        sessionDate: row.session_date,
        closedAt: row.closed_at,
        current: pair.control.realizedPnlPct,
        peakPct,
        cand: {
          realizedPnlPct: pair.candidate.realizedPnlPct,
          triggered: pair.candidate.scaled || pair.candidate.exitCause === "trail_stop",
          delta: pair.delta,
          givebackPts: peakPct != null && finite(pair.candidate.realizedPnlPct) ? Math.round((peakPct - pair.candidate.realizedPnlPct) * 100) / 100 : null,
        },
        scaleOutAction: row.scale_out_action,
        exitCauseControl: pair.control.exitCause,
        exitCauseCandidate: pair.candidate.exitCause,
      };
    });
  }

  const tradeRows = buildTradeRowsForSlippage(0);
  const tradeRowsSlipped = buildTradeRowsForSlippage(SLIPPAGE);

  // ── Full-population aggregate (real-bar ground truth, no slippage) ──
  const agg = aggregateHeadToHead(tradeRows, "cand");
  const aggSlipped = aggregateHeadToHead(tradeRowsSlipped, "cand");

  log(`\n=== REAL-BAR-REPLAY GROUND TRUTH: 100/33/70 vs production 100/50/50 (n=${agg.n} verified) ===`);
  printAgg(agg);
  log(`\n=== SAME, with ${(SLIPPAGE * 100).toFixed(1)}% slippage applied identically to both legs ===`);
  printAgg(aggSlipped);

  // ── Early vs late half (chronological; disclosed as NOT a genuine held-out test -- see header) ──
  const mid = Math.floor(tradeRows.length / 2);
  const early = tradeRows.slice(0, mid);
  const late = tradeRows.slice(mid);
  const aggEarly = aggregateHeadToHead(early, "cand");
  const aggLate = aggregateHeadToHead(late, "cand");
  log(`\n=== EARLY HALF (n=${aggEarly.n}, ${early[0]?.sessionDate}..${early.at(-1)?.sessionDate}) ===`);
  printAgg(aggEarly);
  log(`\n=== LATE HALF (n=${aggLate.n}, ${late[0]?.sessionDate}..${late.at(-1)?.sessionDate}) ===`);
  printAgg(aggLate);

  // ── By year (disclosed: expected to be degenerate given the ~7-8 week window) ──
  const years = [...new Set(tradeRows.map((r) => (r.sessionDate ?? "").slice(0, 4)))].filter(Boolean);
  log(`\n=== BY YEAR: ${years.join(", ")} (${years.length === 1 ? "single-year population -- no cross-year comparison possible, disclosed honestly" : ""}) ===`);

  // ── By ticker (min-n gate) ──
  const byTicker = new Map();
  for (const r of tradeRows) {
    if (!byTicker.has(r.ticker)) byTicker.set(r.ticker, []);
    byTicker.get(r.ticker).push(r);
  }
  const tickerAggs = [...byTicker.entries()]
    .filter(([, rows]) => rows.length >= 8)
    .map(([ticker, rows]) => ({ ticker, agg: aggregateHeadToHead(rows, "cand") }))
    .sort((a, b) => b.agg.n - a.agg.n);
  log(`\n=== BY TICKER (n>=8), ${tickerAggs.length} tickers qualify ===`);
  for (const { ticker, agg: a } of tickerAggs) {
    log(`  ${ticker}: n=${a.n} winRate=${fmt(a.winRate)}% expectancy=${fmt(a.expectancy)}% meanDelta=${fmt(a.meanDelta)}pp -> ${a.verdict}`);
  }

  // ── Regime: SPY EMA-stack bull/bear/sideways (real SPY daily bars, extended lookback for EMA-50) ──
  const earliestDate = tradeRows[0]?.sessionDate ?? "2026-08-01";
  const spyFrom = addDays(earliestDate, -130);
  const latestDate = tradeRows.at(-1)?.sessionDate ?? "2026-09-24";
  const spyTo = addDays(latestDate, 2);
  let regimeByDate = new Map();
  let vixByDate = new Map();
  try {
    const spyBars = await fetchAggBars("SPY", 1, "day", spyFrom, spyTo).catch(() => []);
    regimeByDate = buildRegimeByDateMap(spyBars.map((b) => ({ t: b.t, c: b.c })));
    const vixBars = await fetchAggBars("I:VIX", 1, "day", spyFrom, spyTo).catch(() => []);
    for (const b of vixBars ?? []) {
      if (finite(b.c)) vixByDate.set(dateOnly(b.t), b.c);
    }
  } catch {
    // absent, never fabricated -- segmentation below reports INSUFFICIENT DATA if empty.
  }

  const byRegime = new Map();
  for (const r of tradeRows) {
    const label = regimeByDate.get(r.sessionDate) ?? null;
    const key = label ?? "UNKNOWN";
    if (!byRegime.has(key)) byRegime.set(key, []);
    byRegime.get(key).push(r);
  }
  log(`\n=== BY REGIME (SPY EMA-stack, real bars) ===`);
  for (const [label, rows] of byRegime.entries()) {
    if (rows.length < 5) {
      log(`  ${label}: n=${rows.length} (below min-n=5, not reported as a verdict)`);
      continue;
    }
    const a = aggregateHeadToHead(rows, "cand");
    log(`  ${label}: n=${a.n} winRate=${fmt(a.winRate)}% expectancy=${fmt(a.expectancy)}% meanDelta=${fmt(a.meanDelta)}pp -> ${a.verdict}`);
  }

  // ── Vol regime: VIX median split over the observed window ──
  const vixVals = tradeRows.map((r) => vixByDate.get(r.sessionDate)).filter(finite);
  const medVix = median(vixVals);
  const byVol = new Map();
  for (const r of tradeRows) {
    const vix = vixByDate.get(r.sessionDate);
    const label = classifyVolLabel(vix, medVix) ?? "UNKNOWN";
    if (!byVol.has(label)) byVol.set(label, []);
    byVol.get(label).push(r);
  }
  log(`\n=== BY VOLATILITY REGIME (VIX median split, median=${fmt(medVix, 1)}) ===`);
  for (const [label, rows] of byVol.entries()) {
    if (rows.length < 5) {
      log(`  ${label}: n=${rows.length} (below min-n=5)`);
      continue;
    }
    const a = aggregateHeadToHead(rows, "cand");
    log(`  ${label}: n=${a.n} winRate=${fmt(a.winRate)}% expectancy=${fmt(a.expectancy)}% meanDelta=${fmt(a.meanDelta)}pp -> ${a.verdict}`);
  }

  // ── Tail losses, large-winner capture, winner-to-loser flips (verified population) ──
  const sorted = [...tradeRows].sort((a, b) => a.cand.realizedPnlPct - b.cand.realizedPnlPct);
  const tailN = Math.max(1, Math.round(sorted.length * 0.05));
  const tailLosses = sorted.slice(0, tailN);
  const controlTailAtSameIds = tailLosses.map((r) => r.current);
  log(`\n=== TAIL LOSSES (worst 5%, n=${tailLosses.length}) ===`);
  log(`  candidate mean: ${fmt(tailLosses.reduce((a, r) => a + r.cand.realizedPnlPct, 0) / tailLosses.length)}%  ` +
      `control mean: ${fmt(controlTailAtSameIds.reduce((a, b) => a + b, 0) / controlTailAtSameIds.length)}%`);
  log(`  worst 5 candidate trades:`);
  for (const r of sorted.slice(0, 5)) log(`    id=${r.id} ${r.ticker} candidate=${fmt(r.cand.realizedPnlPct)}% control=${fmt(r.current)}% exit=${r.exitCauseCandidate}`);

  const bigWinnersControl = [...tradeRows].sort((a, b) => b.current - a.current).slice(0, Math.max(1, Math.round(tradeRows.length * 0.1)));
  const bigWinnerCaptureRatios = bigWinnersControl.filter((r) => finite(r.current) && r.current > 0).map((r) => r.cand.realizedPnlPct / r.current);
  log(`\n=== LARGE-WINNER CAPTURE (top decile of control's real winners, n=${bigWinnersControl.length}) ===`);
  log(`  mean candidate/control capture ratio: ${fmt((bigWinnerCaptureRatios.reduce((a, b) => a + b, 0) / bigWinnerCaptureRatios.length) * 100)}%`);
  for (const r of bigWinnersControl.slice(0, 5)) log(`    id=${r.id} ${r.ticker} control=${fmt(r.current)}% candidate=${fmt(r.cand.realizedPnlPct)}%`);

  const flips = tradeRows.filter((r) => r.current > 0 && r.cand.realizedPnlPct <= 0);
  log(`\n=== WINNER-TO-LOSER FLIPS (real-bar ground truth): ${flips.length} / ${tradeRows.filter((r) => r.current > 0).length} real winners (${fmt((flips.length / Math.max(1, tradeRows.filter((r) => r.current > 0).length)) * 100)}%) ===`);
  for (const r of flips.slice(0, 10)) log(`    id=${r.id} ${r.ticker} control=${fmt(r.current)}% candidate=${fmt(r.cand.realizedPnlPct)}% exit=${r.exitCauseCandidate}`);

  // ── Overfitting / outlier check on the REAL-BAR ground truth (not the summary-tier reconstruction) ──
  log(`\n=== OUTLIER CONCENTRATION (real-bar ground truth) ===`);
  log(`  totalDelta=${fmt(agg.concentration?.totalDelta)}pp`);
  for (const k of agg.concentration?.byTopK ?? []) log(`  top${k.k}: sum=${fmt(k.sumTopK)}pp share=${fmt(k.sharePct)}%`);
  log(`  leave-out-top-1: ${agg.leaveOutTop1.verdict} (meanDelta=${fmt(agg.leaveOutTop1.meanDelta)})`);
  log(`  leave-out-top-5: ${agg.leaveOutTop5.verdict} (meanDelta=${fmt(agg.leaveOutTop5.meanDelta)})`);
  log(`  leave-out-top-10: ${agg.leaveOutTop10.verdict} (meanDelta=${fmt(agg.leaveOutTop10.meanDelta)})`);
  log(`  trimmed mean (5% each tail): ${fmt(agg.trimmedMean5pct.trimmedMean)}pp (n=${agg.trimmedMean5pct.n})`);

  if (CSV_GRID_PATH) {
    const header = ["id", "ticker", "session_date", "entry_premium", "peak_premium", "peak_pct", "scale_out_action", "current_realized_pnl_pct", "candidate_100_33_70_realized_pnl_pct", "delta_pp", "suspect_backstop_peak"].join(",");
    const lines = gridTradeRows.map((r) => [r.id, r.ticker, r.sessionDate, r.entryPremium, r.peakPremium, r.peakPct, r.scaleOutAction, r.current, r.cand?.realizedPnlPct ?? "", r.cand?.delta ?? "", suspectIds.has(r.id) ? "true" : "false"].join(","));
    writeFileSync(CSV_GRID_PATH, [header, ...lines].join("\n"));
    log(`Grid CSV written: ${CSV_GRID_PATH} (${lines.length} rows, ${suspectIds.size} flagged suspect)`);
  }

  if (CSV_PATH) {
    const header = ["id", "ticker", "session_date", "closed_at", "control_realized_pnl_pct", "candidate_realized_pnl_pct", "delta_pp", "exit_cause_control", "exit_cause_candidate", "scale_out_action", "verified"].join(",");
    const lines = tradeRows.map((r) => [r.id, r.ticker, r.sessionDate, r.closedAt, r.current, r.cand.realizedPnlPct, r.cand.delta, r.exitCauseControl, r.exitCauseCandidate, r.scaleOutAction, "true"].join(","));
    const unverifiedLines = unverifiedRows.map((r) => [r.row.id, r.row.ticker, r.row.session_date, r.row.closed_at, r.real ?? "", r.pair?.candidate.realizedPnlPct ?? "", "", "", "", r.row.scale_out_action, "false"].join(","));
    writeFileSync(CSV_PATH, [header, ...lines, ...unverifiedLines].join("\n"));
    log(`\nCSV written: ${CSV_PATH} (${lines.length} verified + ${unverifiedLines.length} unverified rows)`);
  }

  if (JSON_OUT) {
    console.log(JSON.stringify({
      fullPopulationN, usedN: rawRows.length, fetchOk, fetchEmpty, fetchErr,
      verifiedN: verifiedRows.length, unverifiedN: unverifiedRows.length,
      groundTruth: agg, groundTruthSlipped: aggSlipped,
      early: aggEarly, late: aggLate,
      byTicker: Object.fromEntries(tickerAggs.map((t) => [t.ticker, t.agg])),
      flipsN: flips.length,
    }, null, 2));
  }

  await releaseAuditClerkSession();
}

function printAgg(agg) {
  if (agg.n === 0) { log("  NO DATA"); return; }
  log(`  n=${agg.n} reach=${fmt(agg.reachRatePct)}% stopRate=${fmt(agg.stopRatePct)}%`);
  log(`  win=${fmt(agg.winRate)}% medianReal=${fmt(agg.medianRealized)}% (vs medianControl=${fmt(agg.medianCurrent)}%) expectancy=${fmt(agg.expectancy)}% PF=${fmt(agg.profitFactor)}`);
  log(`  totalReturn(pts) candidate=${fmt(agg.totalReturnPtsCandidate)} control=${fmt(agg.totalReturnPtsCurrent)} | maxDD(pts) candidate=${fmt(agg.maxDrawdownPtsCandidate)} control=${fmt(agg.maxDrawdownPtsCurrent)}`);
  log(`  meanDelta=${fmt(agg.meanDelta)}pp [${fmt(agg.ci?.lo)},${fmt(agg.ci?.hi)}] -> ${agg.verdict}`);
}

main().catch(async (e) => {
  console.error(e);
  await releaseAuditClerkSession().catch(() => {});
  process.exitCode = 1;
});
