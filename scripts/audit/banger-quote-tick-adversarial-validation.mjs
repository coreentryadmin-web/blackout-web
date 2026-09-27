#!/usr/bin/env node
/**
 * TICK-LEVEL NBBO QUOTE ADVERSARIAL VALIDATION (operator directive 2026-09-27, phase 2). PR #5521
 * found the cleaned 100/33/70 Banger exit candidate shows a genuine, non-outlier-driven edge
 * (+26.3pp mean delta) once 101 backstop-quote-contaminated rows are excluded — but the ONE
 * independent cross-check available at the time (real Polygon TRADE-print bars) could only verify
 * ~10% of real scaled/winner positions vs ~92% of pure stop-outs, because production manages exits
 * against a continuous NBBO quote-MID, not trade prints. This script removes that gap: it replays
 * REAL historical Polygon NBBO QUOTE TICKS (not trade bars) through an exact tick-by-tick clone of
 * production's own live management loop, proven exact against the REAL `deriveScaleOutAction` as an
 * oracle (see `banger-quote-tick-replay-eval.test.mjs`).
 *
 * THIS SCRIPT CHANGES NOTHING IN PRODUCTION. Read-only. No configuration is recommended or shipped.
 *
 * WINDOW-TRUNCATION PROOF (why this script does NOT fetch every position's full committed→expiry
 * quote history): the candidate (100/33/70) and control (100/50/50) share the IDENTICAL scale
 * trigger (2.0x) and hard-stop level (0.4x) — only the runner's FRACTION and TRAIL differ, and only
 * AFTER the (identical) partial fires. A tighter trail (70% of peak) sits at a HIGHER absolute price
 * than a looser one (50% of peak); during any real retracement the mark must cross the higher
 * threshold before the lower one, so candidate's runner-exit tick can never fall LATER than
 * control's own real recorded exit tick. Consequence: for every STOP_OUT row (pre-scale behavior is
 * 100% identical between the two configs — no divergence is even possible) and every EXIT_RUNNER row
 * (candidate's exit is provably at-or-before control's real exit), fetching quotes only through
 * `closed_at + 4h` is sufficient and lossless. Only EXPIRED rows (control's own trail NEVER fired)
 * need the full window through expiry, since the tighter candidate might catch a retracement the
 * looser real trail rode through. This is what makes fetching the full clean population (n≈1209)
 * tractable instead of requiring every row's full ~10-day expiry window.
 *
 * USAGE
 *   node --import tsx scripts/audit/banger-quote-tick-adversarial-validation.mjs \
 *     [--days=365] [--base=...] [--max-positions=N] [--concurrency=12] [--csv=out.csv] [--json]
 */
import { fetchAuditJson, releaseAuditClerkSession } from "./lib/audit-auth-fetch.mjs";
import { flagBackstopQuoteContamination } from "./lib/banger-backstop-contamination-eval.mjs";
import { buildReliableMarkSeries, appendExpirySettlementTick, replayTickState, replayPairTick } from "./lib/banger-quote-tick-replay-eval.mjs";
import { buildRegimeByDateMap, classifyVolLabel, median } from "./lib/banger-regime-classify.mjs";
import { equityCurveStats, meanDeltaCi, deltaConcentration, leaveOutTopKVerdict, trimmedMeanDelta } from "./lib/banger-exit-headtohead-eval.mjs";
import { writeFileSync } from "node:fs";

if (!process.env.POLYGON_API_BASE || !/^https?:\/\//.test(process.env.POLYGON_API_BASE)) {
  process.env.POLYGON_API_BASE = "https://api.massive.com";
}
const POLY_BASE = process.env.POLYGON_API_BASE;
const POLY_KEY = process.env.POLYGON_API_KEY;
const SRC = new URL("../../src/", import.meta.url).pathname;

const args = process.argv.slice(2);
const flag = (name, def) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=").slice(1).join("=") : def;
};
const DAYS = Math.min(365, Math.max(1, Number(flag("days", "365")) || 365));
const BASE = flag("base", "https://blackouttrades.com");
const MAX_POSITIONS = Number(flag("max-positions", "0")) || 0;
const CONCURRENCY = Math.max(1, Number(flag("concurrency", "12")) || 12);
const CSV_PATH = flag("csv", null);
const JSON_OUT = args.includes("--json");
const VERIFY_TOLERANCE_PP = 2; // tighter than the trade-bar study's 3pp -- same-data-type reconstruction should be exact modulo the ~200ns JSON double-precision rounding disclosed below.

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
function toNs(ms) {
  return BigInt(Math.round(ms)) * 1_000_000n;
}
function addHours(iso, h) {
  return new Date(Date.parse(iso) + h * 3_600_000).toISOString();
}
/** Adds N calendar days to a full ISO timestamp (distinct from `addDays`, which takes a bare
 *  YYYY-MM-DD date string) -- used for widening a closed_at TIMESTAMP by whole days. */
function addDaysToIso(iso, n) {
  return new Date(Date.parse(iso) + n * 86_400_000).toISOString();
}
function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Polygon v3 quotes/trades pagination. Precision note (disclosed, immaterial): `sip_timestamp`
 *  arrives as a JSON number at ~1.8e18 ns, well past Number.MAX_SAFE_INTEGER (~9e15) -- IEEE754
 *  double rounding at that magnitude loses at most a few hundred ns, which cannot affect this
 *  study's ms-level tick ordering/merging. Converted to ms via /1e6. */
async function fetchAllPages(url, maxPages) {
  let results = [];
  let next = url;
  let pages = 0;
  let truncated = false;
  while (next) {
    if (pages >= maxPages) {
      truncated = true;
      break;
    }
    let r;
    try {
      r = await fetch(next);
    } catch {
      break;
    }
    if (!r.ok) break;
    const j = await r.json().catch(() => null);
    if (!j) break;
    results = results.concat(j.results ?? []);
    next = j.next_url ? `${j.next_url}&apiKey=${POLY_KEY}` : null;
    pages++;
  }
  return { results, truncated };
}

async function fetchQuoteTicks(occ, fromIso, toIso) {
  const gte = toNs(Date.parse(fromIso));
  const lt = toNs(Date.parse(toIso));
  const url = `${POLY_BASE}/v3/quotes/${occ}?timestamp.gte=${gte}&timestamp.lt=${lt}&order=asc&sort=timestamp&limit=50000&apiKey=${POLY_KEY}`;
  const { results, truncated } = await fetchAllPages(url, 40);
  const ticks = results
    .map((r) => ({ t: Math.round(Number(r.sip_timestamp) / 1e6), bid: finite(r.bid_price) ? r.bid_price : null, ask: finite(r.ask_price) ? r.ask_price : null }))
    .sort((a, b) => a.t - b.t);
  return { ticks, truncated, rawCount: results.length };
}

async function fetchTradeTicks(occ, fromIso, toIso) {
  const gte = toNs(Date.parse(fromIso));
  const lt = toNs(Date.parse(toIso));
  const url = `${POLY_BASE}/v3/trades/${occ}?timestamp.gte=${gte}&timestamp.lt=${lt}&order=asc&sort=timestamp&limit=50000&apiKey=${POLY_KEY}`;
  const { results } = await fetchAllPages(url, 10);
  return results
    .map((r) => ({ t: Math.round(Number(r.sip_timestamp) / 1e6), price: finite(r.price) ? r.price : null }))
    .sort((a, b) => a.t - b.t);
}

const underlyingCloseCache = new Map();
async function fetchUnderlyingClose(fetchAggBars, ticker, dateYmd) {
  const key = `${ticker}:${dateYmd}`;
  if (underlyingCloseCache.has(key)) return underlyingCloseCache.get(key);
  const p = (async () => {
    try {
      const bars = await fetchAggBars(ticker, 1, "day", dateYmd, addDays(dateYmd, 1));
      const bar = (bars ?? []).find((b) => new Date(b.t).toISOString().slice(0, 10) === dateYmd) ?? bars?.[0];
      return finite(bar?.c) ? bar.c : null;
    } catch {
      return null;
    }
  })();
  underlyingCloseCache.set(key, p);
  return p;
}

async function fetchAndBuildTicks(row, fromIso, toIso) {
  const [{ ticks: quoteTicks, truncated: qTrunc, rawCount }, tradeTicks] = await Promise.all([
    fetchQuoteTicks(row.contract_occ, fromIso, toIso),
    fetchTradeTicks(row.contract_occ, fromIso, toIso),
  ]);
  const ticks = rawCount > 0 ? buildReliableMarkSeries(quoteTicks, tradeTicks, row.entry_premium) : [];
  return { ticks, quoteTicks, tradeTicks, rawCount, qTrunc };
}

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

function spreadStatsPct(ticks) {
  const spreads = ticks
    .filter((t) => finite(t.bid) && finite(t.ask) && t.ask > 0 && t.bid >= 0 && t.ask >= t.bid && t.bid + t.ask > 0)
    .map((t) => ((t.ask - t.bid) / ((t.ask + t.bid) / 2)) * 100);
  if (spreads.length === 0) return { medianSpreadPct: null, n: 0 };
  return { medianSpreadPct: median(spreads), n: spreads.length };
}

async function main() {
  const { fetchAggBars } = await import(`${SRC}lib/providers/polygon-largo.ts`);

  const res = await fetchAuditJson(BASE, `/api/admin/banger/closed-export?days=${DAYS}`);
  if (!res.ok || !Array.isArray(res.json?.rows)) {
    console.log("INSUFFICIENT DATA", { status: res.status });
    await releaseAuditClerkSession();
    process.exitCode = 1;
    return;
  }
  let rawRows = res.json.rows;
  const fullPopulationN = rawRows.length;
  const contamination = flagBackstopQuoteContamination(rawRows);
  let cleanRows = rawRows.filter((r) => !contamination.suspectRows.some((s) => s.id === r.id));
  cleanRows = [...cleanRows].sort((a, b) => Date.parse(a.closed_at ?? a.committed_at) - Date.parse(b.closed_at ?? b.committed_at));
  if (MAX_POSITIONS > 0) cleanRows = cleanRows.slice(0, MAX_POSITIONS);

  log(`Full population n=${fullPopulationN}; contamination-flagged n=${contamination.suspectN}; CLEAN population used this run: n=${cleanRows.length}`);
  log(`Fetching real Polygon NBBO quote ticks per position (concurrency=${CONCURRENCY})...`);

  let fetchOk = 0, fetchEmpty = 0, fetchErr = 0, truncatedN = 0;

  let extendedN = 0;

  const replayed = await fetchWithConcurrency(
    cleanRows,
    async (row) => {
      if (!row.contract_occ || !finite(row.entry_premium) || row.entry_premium <= 0) {
        return { row, error: "missing_contract_or_entry" };
      }
      const isExpiredRow = row.scale_out_action === "EXPIRED";
      const from = row.committed_at;
      const expiryBound = addDays(row.contract_expiry, 1);
      // FIRST-PASS window: a generous +2 calendar days past production's own real close (or the
      // full expiry window for a real EXPIRED row, which needs it regardless). WHY THIS IS ADAPTIVE,
      // NOT A FIXED TRUNCATION: candidate can never diverge later than control given the SAME peak
      // trajectory (a tighter trail crosses a higher price level first) -- but that proof assumes
      // THIS reconstruction finds the SAME trigger production's real system did. A real, measured
      // case (AVAV, id=39) missed the hard-stop threshold by exactly $0.01 (archived NBBO min mid
      // 2.05 vs a 2.04 threshold) -- almost certainly a feed/timing granularity gap between the
      // archived SIP quote tape and whatever production's live poll actually saw at the boundary,
      // not a bug in this replay. A FIXED short window has no more data to fall back on when that
      // happens, and silently free-falls to the expiry-settlement tick -- a wrong answer with
      // nothing to catch it. So: try the narrow window first (cheap, correct for the vast majority);
      // if THIS reconstruction's own control replay does not terminate inside it, extend to the full
      // expiry window and re-run before accepting a result.
      const firstPassTo = isExpiredRow ? expiryBound : (new Date(Math.min(Date.parse(addDaysToIso(row.closed_at ?? row.committed_at, 2)), Date.parse(expiryBound))).toISOString());
      try {
        let { ticks, quoteTicks, tradeTicks, rawCount, qTrunc } = await fetchAndBuildTicks(row, from, firstPassTo);
        if (rawCount === 0) {
          fetchEmpty++;
          return { row, error: "no_quotes_in_window", quoteRawCount: 0 };
        }
        const underlyingClose = await fetchUnderlyingClose(fetchAggBars, row.ticker, row.contract_expiry);
        let withSettlement = appendExpirySettlementTick(ticks, Date.parse(`${row.contract_expiry}T21:00:00Z`), underlyingClose, row.contract_strike);
        const controlProbe = replayTickState(withSettlement, row.entry_premium, CONTROL);
        const needsExtension = !isExpiredRow && controlProbe.exitCause?.startsWith("series_end") && firstPassTo !== expiryBound;
        if (needsExtension) {
          extendedN++;
          const extended = await fetchAndBuildTicks(row, from, expiryBound);
          if (extended.rawCount > 0) {
            ticks = extended.ticks;
            quoteTicks = extended.quoteTicks;
            tradeTicks = extended.tradeTicks;
            rawCount = extended.rawCount;
            qTrunc = extended.qTrunc;
            withSettlement = appendExpirySettlementTick(ticks, Date.parse(`${row.contract_expiry}T21:00:00Z`), underlyingClose, row.contract_strike);
          }
        }
        if (qTrunc) truncatedN++;
        fetchOk++;
        const spread = spreadStatsPct(quoteTicks);
        return { row, ticks: withSettlement, quoteRawCount: rawCount, tradeCount: tradeTicks.length, spread, truncated: qTrunc, underlyingClose, extended: needsExtension };
      } catch (e) {
        fetchErr++;
        return { row, error: `fetch_error:${String(e).slice(0, 150)}` };
      }
    },
    CONCURRENCY,
  );
  log(`Fetch: ok=${fetchOk} empty=${fetchEmpty} error=${fetchErr} truncated=${truncatedN} extended-to-expiry=${extendedN}`);

  const results = replayed.map((r) => {
    if (r.error || !r.ticks) return { ...r, verified: false, unverifiedReason: r.error ?? "no_ticks" };
    const pair = replayPairTick(r.ticks, r.row.entry_premium, CONTROL, CANDIDATE);
    const realPct = finite(r.row.realized_pnl_pct) ? r.row.realized_pnl_pct : null;
    const modelMatch = realPct != null && finite(pair.control.modelPct) ? Math.abs(pair.control.modelPct - realPct) : null;
    const verified = modelMatch != null && modelMatch <= VERIFY_TOLERANCE_PP;
    const peakMatch =
      finite(r.row.peak_premium) && finite(pair.control.peakAtExit) ? Math.abs(pair.control.peakAtExit - r.row.peak_premium) / Math.max(r.row.peak_premium, 0.01) : null;
    return { ...r, pair, realPct, modelMatch, peakMatch, verified, unverifiedReason: verified ? null : modelMatch != null ? `model_mismatch:${modelMatch.toFixed(1)}pp` : "no_ground_truth" };
  });

  const verifiedRows = results.filter((r) => r.verified);
  const unverifiedRows = results.filter((r) => !r.verified);
  const stopOutVerified = verifiedRows.filter((r) => r.row.scale_out_action === "STOP_OUT").length;
  const stopOutTotal = results.filter((r) => r.row.scale_out_action === "STOP_OUT").length;
  const runnerVerified = verifiedRows.filter((r) => r.row.scale_out_action !== "STOP_OUT").length;
  const runnerTotal = results.filter((r) => r.row.scale_out_action !== "STOP_OUT").length;

  log(`\n=== VERIFICATION GATE (control MODEL replay vs. real recorded realized_pnl_pct, tolerance=${VERIFY_TOLERANCE_PP}pp) ===`);
  log(`  VERIFIED:   ${verifiedRows.length} / ${results.length} (${fmt((verifiedRows.length / results.length) * 100)}%)`);
  log(`  by real outcome type -- THE KEY FIX-CONFIRMATION CHECK (should now be roughly equal, unlike the trade-bar study's 92% vs 10% split):`);
  log(`    STOP_OUT rows:  ${stopOutVerified} / ${stopOutTotal} verified (${fmt((stopOutVerified / Math.max(1, stopOutTotal)) * 100)}%)`);
  log(`    EXIT_RUNNER/EXPIRED rows: ${runnerVerified} / ${runnerTotal} verified (${fmt((runnerVerified / Math.max(1, runnerTotal)) * 100)}%)`);
  const reasonCounts = {};
  for (const r of unverifiedRows) {
    const k = (r.unverifiedReason ?? "unknown").split(":")[0];
    reasonCounts[k] = (reasonCounts[k] ?? 0) + 1;
  }
  log(`  unverified reasons:`, reasonCounts);
  if (unverifiedRows.length) {
    const mismatches = unverifiedRows.filter((r) => r.unverifiedReason?.startsWith("model_mismatch"));
    const worst = [...mismatches].sort((a, b) => b.modelMatch - a.modelMatch).slice(0, 8);
    log(`  worst model mismatches:`);
    for (const m of worst) log(`    id=${m.row.id} ${m.row.ticker} real=${fmt(m.realPct)}% model=${fmt(m.pair?.control.modelPct)}% mismatch=${fmt(m.modelMatch)}pp action=${m.row.scale_out_action} quoteN=${m.quoteRawCount} truncated=${m.truncated}`);
  }

  function buildTradeRow(r) {
    const { row, pair } = r;
    return {
      id: row.id,
      ticker: row.ticker,
      sessionDate: row.session_date,
      closedAt: row.closed_at,
      contractExpiry: row.contract_expiry,
      dte: row.session_date && row.contract_expiry ? Math.round((Date.parse(`${row.contract_expiry}T00:00:00Z`) - Date.parse(`${row.session_date}T00:00:00Z`)) / 86_400_000) : null,
      entryPremium: row.entry_premium,
      scaleOutAction: row.scale_out_action,
      isWinner: finite(row.realized_pnl_pct) ? row.realized_pnl_pct > 0 : null,
      medianSpreadPct: r.spread?.medianSpreadPct ?? null,
      dollarVol: finite(row.discovery_dollar_vol) ? row.discovery_dollar_vol : null,
      current: pair.control.modelPct,
      currentExec: pair.control.execPct,
      cand: { realizedPnlPct: pair.candidate.modelPct, delta: pair.modelDelta, triggered: pair.candidate.scaled },
      candExec: { realizedPnlPct: pair.candidate.execPct, delta: pair.execDelta },
    };
  }
  const tradeRows = verifiedRows.map(buildTradeRow);

  const aggModel = aggregateSimple(tradeRows, "cand", "current");
  const aggExec = aggregateSimple(tradeRows.map((r) => ({ ...r, current: r.currentExec, cand: r.candExec })), "cand", "current");

  log(`\n=== VERIFIED POPULATION (n=${tradeRows.length}) — MODEL fills (production's own formula) ===`);
  printAgg(aggModel);
  log(`\n=== SAME population — EXECUTABLE fills (real bid at each decision tick, never better than model) ===`);
  printAgg(aggExec);

  // ── Winner vs loser (the operator's explicit "no easier standard for winners" check) ──
  const winners = tradeRows.filter((r) => r.isWinner === true);
  const losers = tradeRows.filter((r) => r.isWinner === false);
  log(`\n=== BY WINNER/LOSER (real recorded outcome) ===`);
  log(`  WINNERS (n=${winners.length}):`); printAgg(aggregateSimple(winners, "cand", "current"));
  log(`  LOSERS  (n=${losers.length}):`); printAgg(aggregateSimple(losers, "cand", "current"));

  // ── By ticker (min-n) ──
  const byTicker = new Map();
  for (const r of tradeRows) { if (!byTicker.has(r.ticker)) byTicker.set(r.ticker, []); byTicker.get(r.ticker).push(r); }
  const tickerAggs = [...byTicker.entries()].filter(([, rows]) => rows.length >= 6).map(([ticker, rows]) => ({ ticker, n: rows.length, agg: aggregateSimple(rows, "cand", "current") }));
  log(`\n=== BY TICKER (n>=6), ${tickerAggs.length} qualify ===`);
  for (const t of tickerAggs.sort((a, b) => b.n - a.n)) log(`  ${t.ticker}: n=${t.n} meanDelta=${fmt(t.agg.meanDelta)}pp -> ${t.agg.verdict}`);
  const totalDelta = tradeRows.reduce((a, r) => a + (r.cand.delta ?? 0), 0);
  const tickerDeltaShare = [...byTicker.entries()].map(([ticker, rows]) => ({ ticker, sum: rows.reduce((a, r) => a + (r.cand.delta ?? 0), 0) })).sort((a, b) => b.sum - a.sum);
  log(`  top-3 tickers' share of total delta: ${fmt((tickerDeltaShare.slice(0, 3).reduce((a, t) => a + t.sum, 0) / totalDelta) * 100)}%`);

  // ── By DTE ──
  const byDte = new Map();
  for (const r of tradeRows) { const k = r.dte ?? "null"; if (!byDte.has(k)) byDte.set(k, []); byDte.get(k).push(r); }
  log(`\n=== BY DTE ===`);
  for (const [dte, rows] of [...byDte.entries()].sort((a, b) => Number(a[0]) - Number(b[0]))) {
    if (rows.length < 5) { log(`  DTE=${dte}: n=${rows.length} (below min-n)`); continue; }
    const a = aggregateSimple(rows, "cand", "current");
    log(`  DTE=${dte}: n=${rows.length} meanDelta=${fmt(a.meanDelta)}pp -> ${a.verdict}`);
  }

  // ── By entry premium bucket ──
  const premBuckets = [
    { label: "<$0.25", test: (p) => p < 0.25 },
    { label: "$0.25-0.5", test: (p) => p >= 0.25 && p < 0.5 },
    { label: "$0.5-1.0", test: (p) => p >= 0.5 && p < 1.0 },
    { label: ">=$1.0", test: (p) => p >= 1.0 },
  ];
  log(`\n=== BY ENTRY PREMIUM ===`);
  for (const b of premBuckets) {
    const rows = tradeRows.filter((r) => b.test(r.entryPremium));
    if (rows.length < 5) { log(`  ${b.label}: n=${rows.length} (below min-n)`); continue; }
    const a = aggregateSimple(rows, "cand", "current");
    log(`  ${b.label}: n=${rows.length} meanDelta=${fmt(a.meanDelta)}pp -> ${a.verdict}`);
  }

  // ── By liquidity/spread (median bid-ask spread % across the position's own real quotes) ──
  const spreadVals = tradeRows.map((r) => r.medianSpreadPct).filter(finite);
  const medSpread = median(spreadVals);
  log(`\n=== BY LIQUIDITY/SPREAD (median spread=${fmt(medSpread, 1)}%) ===`);
  const tight = tradeRows.filter((r) => finite(r.medianSpreadPct) && r.medianSpreadPct < medSpread);
  const wide = tradeRows.filter((r) => finite(r.medianSpreadPct) && r.medianSpreadPct >= medSpread);
  log(`  TIGHT spread (n=${tight.length}):`); printAgg(aggregateSimple(tight, "cand", "current"));
  log(`  WIDE spread (n=${wide.length}):`); printAgg(aggregateSimple(wide, "cand", "current"));

  // ── Regime ──
  const earliestDate = tradeRows[0]?.sessionDate ?? "2026-08-01";
  const latestDate = tradeRows.at(-1)?.sessionDate ?? "2026-09-24";
  let regimeByDate = new Map(), vixByDate = new Map();
  try {
    const spyBars = await fetchAggBars("SPY", 1, "day", addDays(earliestDate, -130), addDays(latestDate, 2)).catch(() => []);
    regimeByDate = buildRegimeByDateMap(spyBars.map((b) => ({ t: b.t, c: b.c })));
    const vixBars = await fetchAggBars("I:VIX", 1, "day", addDays(earliestDate, -130), addDays(latestDate, 2)).catch(() => []);
    for (const b of vixBars ?? []) if (finite(b.c)) vixByDate.set(new Date(b.t).toISOString().slice(0, 10), b.c);
  } catch {}
  const byRegime = new Map();
  for (const r of tradeRows) { const k = regimeByDate.get(r.sessionDate) ?? "UNKNOWN"; if (!byRegime.has(k)) byRegime.set(k, []); byRegime.get(k).push(r); }
  log(`\n=== BY REGIME (SPY EMA-stack) ===`);
  for (const [label, rows] of byRegime.entries()) {
    if (rows.length < 5) { log(`  ${label}: n=${rows.length} (below min-n)`); continue; }
    const a = aggregateSimple(rows, "cand", "current");
    log(`  ${label}: n=${rows.length} meanDelta=${fmt(a.meanDelta)}pp -> ${a.verdict}`);
  }
  const vixVals = tradeRows.map((r) => vixByDate.get(r.sessionDate)).filter(finite);
  const medVix = median(vixVals);
  const byVol = new Map();
  for (const r of tradeRows) { const k = classifyVolLabel(vixByDate.get(r.sessionDate), medVix) ?? "UNKNOWN"; if (!byVol.has(k)) byVol.set(k, []); byVol.get(k).push(r); }
  log(`\n=== BY VOLATILITY (VIX median=${fmt(medVix, 1)}) ===`);
  for (const [label, rows] of byVol.entries()) {
    if (rows.length < 5) { log(`  ${label}: n=${rows.length} (below min-n)`); continue; }
    const a = aggregateSimple(rows, "cand", "current");
    log(`  ${label}: n=${rows.length} meanDelta=${fmt(a.meanDelta)}pp -> ${a.verdict}`);
  }

  // ── Adversarial: outlier concentration on the QUOTE-TICK-VERIFIED population itself ──
  log(`\n=== OUTLIER CONCENTRATION (quote-tick verified population, trying to KILL the result) ===`);
  const conc = deltaConcentration(tradeRows, "cand");
  log(`  totalDelta=${fmt(conc.totalDelta)}pp across n=${conc.n}`);
  for (const k of conc.byTopK) log(`  top${k.k}: sum=${fmt(k.sumTopK)}pp share=${fmt(k.sharePct)}%`);
  log(`  leave-out-top-10: ${leaveOutTopKVerdict(tradeRows, "cand", 10).verdict} (meanDelta=${fmt(leaveOutTopKVerdict(tradeRows, "cand", 10).meanDelta)})`);
  log(`  leave-out-top-20: ${leaveOutTopKVerdict(tradeRows, "cand", 20).verdict} (meanDelta=${fmt(leaveOutTopKVerdict(tradeRows, "cand", 20).meanDelta)})`);
  log(`  trimmed mean (5% each tail): ${fmt(trimmedMeanDelta(tradeRows, "cand", 5).trimmedMean)}pp (n=${trimmedMeanDelta(tradeRows, "cand", 5).n})`);

  // ── Early vs late half (disclosed: not a genuine holdout -- same population already used for selection) ──
  const mid = Math.floor(tradeRows.length / 2);
  log(`\n=== EARLY vs LATE HALF (chronological; NOT genuine OOS -- disclosed) ===`);
  log(`  EARLY (n=${mid}):`); printAgg(aggregateSimple(tradeRows.slice(0, mid), "cand", "current"));
  log(`  LATE  (n=${tradeRows.length - mid}):`); printAgg(aggregateSimple(tradeRows.slice(mid), "cand", "current"));

  log(`\nTotal verifiable trades: ${tradeRows.length} / ${cleanRows.length} clean rows attempted (${fullPopulationN} total closed positions, ${contamination.suspectN} contamination-excluded).`);

  if (CSV_PATH) {
    const header = ["id", "ticker", "session_date", "dte", "entry_premium", "scale_out_action", "is_winner", "median_spread_pct", "current_model_pct", "candidate_model_pct", "model_delta_pp", "current_exec_pct", "candidate_exec_pct", "exec_delta_pp"].join(",");
    const lines = tradeRows.map((r) => [r.id, r.ticker, r.sessionDate, r.dte, r.entryPremium, r.scaleOutAction, r.isWinner, r.medianSpreadPct ?? "", r.current, r.cand.realizedPnlPct, r.cand.delta, r.currentExec, r.candExec.realizedPnlPct, r.candExec.delta].join(","));
    writeFileSync(CSV_PATH, [header, ...lines].join("\n"));
    log(`\nCSV written: ${CSV_PATH} (${lines.length} verified rows)`);
  }
  if (JSON_OUT) {
    console.log(JSON.stringify({ fullPopulationN, cleanN: cleanRows.length, verifiedN: tradeRows.length, aggModel, aggExec }, null, 2));
  }

  await releaseAuditClerkSession();
}

/** Small self-contained aggregate (mirrors aggregateHeadToHead's shape) so this script doesn't need
 *  to reshape rows to match that module's exact field names -- same math, applied to this script's
 *  own trade-row shape ({current, cand:{realizedPnlPct,delta}}). */
function aggregateSimple(rows, candKey, curKey) {
  const usable = rows.filter((r) => finite(r[curKey]) && r[candKey] && finite(r[candKey].realizedPnlPct));
  const n = usable.length;
  if (n === 0) return { n: 0, verdict: "NO DATA" };
  const candVals = usable.map((r) => r[candKey].realizedPnlPct);
  const curVals = usable.map((r) => r[curKey]);
  const wins = usable.filter((r) => r[candKey].realizedPnlPct > 0);
  const losses = usable.filter((r) => r[candKey].realizedPnlPct <= 0);
  const winRate = Math.round((wins.length / n) * 10000) / 100;
  const avgWinner = wins.length ? wins.reduce((a, r) => a + r[candKey].realizedPnlPct, 0) / wins.length : null;
  const avgLoser = losses.length ? losses.reduce((a, r) => a + r[candKey].realizedPnlPct, 0) / losses.length : null;
  const expectancy = Math.round((candVals.reduce((a, b) => a + b, 0) / n) * 100) / 100;
  const sumPos = wins.reduce((a, r) => a + r[candKey].realizedPnlPct, 0);
  const sumNegAbs = Math.abs(losses.reduce((a, r) => a + r[candKey].realizedPnlPct, 0));
  const profitFactor = sumNegAbs > 0 ? Math.round((sumPos / sumNegAbs) * 100) / 100 : sumPos > 0 ? Infinity : null;
  const curve = equityCurveStats(candVals);
  const deltas = usable.map((r) => r[candKey].delta).filter(finite);
  const { meanDelta, ci, verdict } = meanDeltaCi(deltas);
  return { n, winRate, avgWinner, avgLoser, expectancy, profitFactor, maxDrawdownPts: curve.maxDrawdownPts, totalReturnPts: curve.totalReturnPts, medianCurrent: median(curVals), medianCandidate: median(candVals), meanDelta, ci, verdict };
}

function printAgg(agg) {
  if (agg.n === 0) { log("    NO DATA"); return; }
  log(`    n=${agg.n} winRate=${fmt(agg.winRate)}% expectancy=${fmt(agg.expectancy)}% PF=${fmt(agg.profitFactor)} avgWin=${fmt(agg.avgWinner)}% avgLoss=${fmt(agg.avgLoser)}%`);
  log(`    medianCurrent=${fmt(agg.medianCurrent)}% medianCandidate=${fmt(agg.medianCandidate)}% totalReturn=${fmt(agg.totalReturnPts)}pts maxDD=${fmt(agg.maxDrawdownPts)}pts`);
  log(`    meanDelta=${fmt(agg.meanDelta)}pp [${fmt(agg.ci?.lo)},${fmt(agg.ci?.hi)}] -> ${agg.verdict}`);
}

main().catch(async (e) => {
  console.error(e);
  await releaseAuditClerkSession().catch(() => {});
  process.exitCode = 1;
});
