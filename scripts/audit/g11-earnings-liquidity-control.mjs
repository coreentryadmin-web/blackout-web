/**
 * G-11 LIQUIDITY/CAP-MATCHED SINGLE-STOCK CONTROL — the stated next step from
 * INTENTIONAL-DESIGN.md §5 / g11-print-window-outcome.mjs's own caveat.
 *
 * WHY THIS EXISTS. `g11-print-window-outcome.mjs` measured that EXEMPTIBLE earnings rows (a
 * confirmed after-close or pre-open-landed print — zero direct same-day gap risk to a 0DTE) still
 * carry median realized RTH range ~5.6x a SPY/QQQ/IWM baseline (4.06% vs 0.73%, 2026-08-28,
 * 4-week window). That script's own header said plainly: "the baseline is index ETFs, not
 * liquidity/cap-matched non-earnings single stocks, so part of the gap may just be ordinary
 * single-name-vs-index vol rather than an earnings-specific effect — a matched single-stock
 * control ... is the natural next step before any gate change is even drafted." This is that
 * control.
 *
 * METHODOLOGY (same classifier, same realized-range metric, different comparison group):
 *   1. Reuse `assessPrintWindow` (lib/print-window-eval.mjs, IDENTICAL to the original tool) over
 *      the same importance-floor/lookback-window shape to get the same EXEMPTIBLE row set.
 *   2. For EVERY unique exemptible ticker, find a NON-EARNINGS single stock matched on market cap
 *      AND average dollar volume (log-space nearest-neighbor — see lib/liquidity-cap-match.mjs),
 *      drawn from a candidate pool that:
 *        - reported NO earnings (confirmed or projected, any importance) anywhere in a BUFFERED
 *          window around the study window (buffer on both sides — a name that reports right before
 *          or after the study window can still carry pre/post-earnings vol bleed on nearby days,
 *          which would contaminate it as a "clean" control);
 *        - is not a broad-market ETF/index product (KNOWN_ETF_INDEX_DENYLIST);
 *        - passes a per-ticker Polygon `/v3/reference/tickers/{t}` detail check requiring
 *          `type === "CS"` (ordinary common stock) — the SAME call that supplies market cap, so
 *          this costs nothing extra;
 *        - clears a liquidity floor (avg price, avg dollar volume over a trailing window) so a
 *          micro-cap/illiquid name can never be "the closest cap match" by default.
 *   3. Measure the SAME realized-RTH-range metric (`sessionMoveStats`, byte-identical formula to
 *      the original script) on the matched control ticker, on the SAME calendar date as the
 *      exemptible row — controlling for market-wide conditions that specific day, the same
 *      principle the original script's same-day SPY/QQQ/IWM baseline already uses.
 *   4. Report median realized range: exemptible vs. liquidity/cap-matched control, on the matched
 *      PAIRED subset only (both sides have real bars) — never against the original tool's index
 *      baseline, which is a different, already-published, comparison.
 *
 * WHAT THIS DOES NOT DO (stated, not hidden — same discipline as every other A/B harness here):
 *   - Does not match on SECTOR, BETA, or historical realized volatility — only cap + dollar volume,
 *     which is what the task asked for and what the original tool's own next-step note named.
 *     A name can be "cap/liquidity-matched" and still be structurally more volatile (e.g. a biotech
 *     vs a utility of the same size) — the per-row `cap_ratio`/`dvol_ratio` are reported so a reader
 *     can see HOW close each match actually was, not just trust a single aggregate number.
 *   - The candidate pool's average-dollar-volume figure comes from grouped-daily aggregates over a
 *     trailing window (`--liquidity-days`, default 10 trading days) ending at the study window's
 *     last day — a real multi-day average, not a single-day snapshot, but still a SHORT window;
 *     it does not track a name's cap/volume drifting across the whole study period.
 *   - Same-ticker reuse across multiple exemptible names IS allowed (no artificial dedup) — exactly
 *     like the original tool reusing SPY/QQQ/IWM across every date; the median over many dates is
 *     what makes a single reused name's own idiosyncratic days wash out.
 *   - Not a graded P&L backtest (needs the full discovery+contract-pick+exit pipeline —
 *     zerodte-sim.mjs is that instrument). This still only answers the narrower realized-vol
 *     question, now against a sharper baseline.
 *
 * No gate touched. Evidence-gathering only, per INTENTIONAL-DESIGN.md §5's own explicit discipline.
 *
 * Read-only. No Clerk session needed — Benzinga/Polygon only, both via the Polygon-proxied key.
 * Self-defaults POLYGON_API_BASE like every other script here.
 *
 * Run:
 *   env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY node --import tsx \
 *     scripts/audit/g11-earnings-liquidity-control.mjs [--days=20] [--importance=4] \
 *     [--candidates=300] [--liquidity-days=10] [--buffer-days=10] [--concurrency=10] [--json]
 */
import { assessPrintWindow } from "./lib/print-window-eval.mjs";
import {
  accumulateLiquidityDay,
  finalizeLiquidityMap,
  buildCandidatePool,
  nearestCandidateMatch,
  median,
} from "./lib/liquidity-cap-match.mjs";

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const flag = (name, def) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=")[1] : def;
};

const LOOKBACK_DAYS = Math.max(5, Math.min(90, Number(flag("days", "20"))));
const IMPORTANCE_MIN = Number(flag("importance", "4"));
const CANDIDATE_POOL_SIZE = Math.max(20, Math.min(2000, Number(flag("candidates", "300"))));
const LIQUIDITY_LOOKBACK_TRADING_DAYS = Math.max(3, Math.min(40, Number(flag("liquidity-days", "10"))));
const BUFFER_DAYS = Math.max(0, Math.min(30, Number(flag("buffer-days", "10"))));
const CONCURRENCY = Math.max(1, Math.min(24, Number(flag("concurrency", "10"))));
const MIN_DOLLAR_VOL = Number(flag("min-dollar-vol", "20000000"));
const MIN_PRICE = Number(flag("min-price", "5"));
const MAX_PRICE = Number(flag("max-price", "2000"));
const NOW_MIN = 9 * 60 + 35; // 09:35 ET — same "once the session opens" evidence window as the original.

const POLYGON_KEY = process.env.POLYGON_API_KEY;
const RAW_POLY_BASE = process.env.POLYGON_API_BASE;
const POLYGON_BASE = /^https?:/.test(RAW_POLY_BASE ?? "") ? RAW_POLY_BASE : "https://api.massive.com";

function ymd(d) {
  return d.toISOString().slice(0, 10);
}

/** Concurrency-limited async map — keeps hundreds of Polygon calls from either serializing (slow)
 * or all firing at once (provider throttling risk). */
async function pooledMap(items, worker, concurrency) {
  const results = new Array(items.length);
  let idx = 0;
  async function runner() {
    while (idx < items.length) {
      const current = idx++;
      results[current] = await worker(items[current], current);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, runner));
  return results;
}

/** Generalized Benzinga earnings fetch: `dateStatus` optional (omit to pull confirmed+projected —
 * used for the exclusion window, where a not-yet-confirmed upcoming print still disqualifies a
 * candidate as a "clean" control), `pageLimit` bounds pagination for a wide date range. */
async function fetchEarnings({ dateGte, dateLte, importanceMin, dateStatus, pageLimit }) {
  const rows = [];
  let path = "/benzinga/v1/earnings";
  const base = {
    "date.gte": dateGte,
    "date.lte": dateLte,
    "importance.gte": String(importanceMin),
    limit: "200",
    sort: "date.asc",
    apiKey: POLYGON_KEY,
  };
  if (dateStatus) base.date_status = dateStatus;
  let params = new URLSearchParams(base);
  for (let page = 0; page < pageLimit; page++) {
    const url = `${POLYGON_BASE}${path}?${params.toString()}`;
    const res = await fetch(url);
    if (!res.ok) {
      if (res.status === 403) return { rows, entitled: false };
      throw new Error(`benzinga earnings ${res.status}`);
    }
    const data = await res.json().catch(() => null);
    for (const r of data?.results ?? []) {
      const ticker = String(r.ticker ?? "").trim().toUpperCase();
      const date = String(r.date ?? "").slice(0, 10);
      if (!ticker || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      rows.push({ ticker, date, time: r.time ?? null, dateStatus: r.date_status ?? null });
    }
    if (!data?.next_url) break;
    const nextUrl = new URL(data.next_url, POLYGON_BASE);
    path = nextUrl.pathname;
    params = new URLSearchParams(nextUrl.searchParams);
    params.delete("apiKey");
    params.set("apiKey", POLYGON_KEY);
  }
  return { rows, entitled: true };
}

/** RTH-only (09:30-16:00 ET) 1-minute bar stats for one ticker/day. Byte-identical formula to
 * g11-print-window-outcome.mjs's own `sessionMoveStats` — duplicated rather than imported so this
 * script has no import-path dependency on that one; keep the two in lockstep if either changes. */
async function sessionMoveStats(ticker, day) {
  const url =
    `${POLYGON_BASE}/v2/aggs/ticker/${encodeURIComponent(ticker)}/range/1/minute/${day}/${day}` +
    `?adjusted=true&sort=asc&limit=1000&apiKey=${POLYGON_KEY}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  const rows = (data?.results ?? []).filter((r) => {
    const t = new Date(r.t);
    const etHour = t.getUTCHours() - 5; // EST/EDT both land inside the 09:30-16:00 filter margin
    return etHour >= 9 && etHour < 17;
  });
  if (rows.length === 0) return null;
  const open = rows[0].o;
  if (!(open > 0)) return null;
  const close = rows[rows.length - 1].c;
  const high = Math.max(...rows.map((r) => r.h));
  const low = Math.min(...rows.map((r) => r.l));
  return {
    range_pct: Number((((high - low) / open) * 100).toFixed(2)),
    move_pct: Number((((close - open) / open) * 100).toFixed(2)),
    bars: rows.length,
  };
}

async function fetchGroupedDaily(day) {
  const url = `${POLYGON_BASE}/v2/aggs/grouped/locale/us/market/stocks/${day}?adjusted=true&apiKey=${POLYGON_KEY}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  return Array.isArray(data?.results) ? data.results : null;
}

/** Market cap + security type via the same per-ticker detail call. Returns null on any failure —
 * never a fabricated cap — so a ticker without real data can never win a match. */
async function fetchTickerDetail(ticker) {
  const url = `${POLYGON_BASE}/v3/reference/tickers/${encodeURIComponent(ticker)}?apiKey=${POLYGON_KEY}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  const cap = Number(data?.results?.market_cap);
  const type = data?.results?.type ?? null;
  if (!Number.isFinite(cap) || !(cap > 0)) return null;
  return { cap, type };
}

function addDays(d, n) {
  const out = new Date(d);
  out.setUTCDate(out.getUTCDate() + n);
  return out;
}

async function main() {
  if (!POLYGON_KEY) {
    console.error("POLYGON_API_KEY not set");
    process.exit(1);
  }

  const end = new Date();
  end.setUTCDate(end.getUTCDate() - 1); // exclude today — classification is time-dependent/live
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - LOOKBACK_DAYS);

  console.error(`[1/7] Fetching study-window earnings (${ymd(start)}..${ymd(end)}, importance>=${IMPORTANCE_MIN})...`);
  const { rows: earnRows, entitled } = await fetchEarnings({
    dateGte: ymd(start),
    dateLte: ymd(end),
    importanceMin: IMPORTANCE_MIN,
    dateStatus: "confirmed",
    pageLimit: 6,
  });
  if (!entitled) {
    console.error("SKIP: Benzinga structured earnings not entitled on this Polygon plan");
    process.exit(0);
  }

  const tally = { after_close: 0, pre_open_landed: 0, pre_open_pending: 0, intraday: 0, unknown: 0, total: earnRows.length };
  const exemptible = [];
  for (const r of earnRows) {
    const v = assessPrintWindow(r, r.date, NOW_MIN);
    tally[v.verdict]++;
    if (!v.threatensToday) exemptible.push({ ...r, verdict: v.verdict });
  }
  if (exemptible.length === 0) {
    const out = { insufficient_data: true, tally, note: "No exemptible rows in window — widen --days." };
    console.log(asJson ? JSON.stringify(out, null, 2) : `INSUFFICIENT DATA — ${out.note}`);
    return;
  }
  console.error(`      ${exemptible.length}/${earnRows.length} rows exemptible.`);

  console.error(`[2/7] Fetching same-day minute bars for ${exemptible.length} exemptible rows (concurrency=${CONCURRENCY})...`);
  const measuredRaw = await pooledMap(
    exemptible,
    async (r) => {
      const s = await sessionMoveStats(r.ticker, r.date);
      return s ? { ...r, ...s } : null;
    },
    CONCURRENCY
  );
  const measured = measuredRaw.filter(Boolean);
  if (measured.length === 0) {
    const out = { insufficient_data: true, tally, note: "No bars found for any exemptible row." };
    console.log(asJson ? JSON.stringify(out, null, 2) : `INSUFFICIENT DATA — ${out.note}`);
    return;
  }
  console.error(`      ${measured.length}/${exemptible.length} exemptible rows have real bars.`);

  const exemptibleTickers = [...new Set(measured.map((m) => m.ticker))];

  // --- Build the exclusion set: every ticker that reported (confirmed OR projected, ANY
  // importance) anywhere in a buffered window around the study window. A control candidate that
  // reports just before or after the study window can still carry pre/post-earnings vol bleed.
  const bufStart = addDays(start, -BUFFER_DAYS);
  const bufEnd = addDays(end, BUFFER_DAYS);
  console.error(`[3/7] Fetching exclusion-window earnings (${ymd(bufStart)}..${ymd(bufEnd)}, importance>=1, all statuses)...`);
  const { rows: exclRows } = await fetchEarnings({
    dateGte: ymd(bufStart),
    dateLte: ymd(bufEnd),
    importanceMin: 1,
    dateStatus: undefined,
    pageLimit: 25,
  });
  const excludeTickers = new Set(exclRows.map((r) => r.ticker));
  for (const t of exemptibleTickers) excludeTickers.add(t); // defensive — they reported by definition
  console.error(`      ${excludeTickers.size} tickers excluded from the control pool as earnings reporters.`);

  // --- Build the liquidity map from real grouped-daily aggregates over a trailing trading-day
  // window ending at the study window's last day. ONE whole-market call per day — cheap, and
  // covers both the candidate universe AND the exemptible tickers' own liquidity stats.
  console.error(`[4/7] Averaging liquidity over trailing ${LIQUIDITY_LOOKBACK_TRADING_DAYS} trading days ending ${ymd(end)}...`);
  const liquidityAcc = new Map();
  let tradingDaysCollected = 0;
  let cursor = new Date(end);
  let calendarDaysScanned = 0;
  while (tradingDaysCollected < LIQUIDITY_LOOKBACK_TRADING_DAYS && calendarDaysScanned < LIQUIDITY_LOOKBACK_TRADING_DAYS * 3) {
    const day = ymd(cursor);
    const rows = await fetchGroupedDaily(day);
    if (rows && rows.length > 0) {
      accumulateLiquidityDay(liquidityAcc, rows);
      tradingDaysCollected++;
    }
    cursor = addDays(cursor, -1);
    calendarDaysScanned++;
  }
  const liquidityMap = finalizeLiquidityMap(liquidityAcc);
  console.error(`      ${tradingDaysCollected} trading days collected, ${liquidityMap.size} tickers with liquidity data.`);

  // --- Candidate pool: liquid, ordinary-shaped, non-ETF, non-earnings names by $-volume.
  const minDays = Math.max(1, tradingDaysCollected - 2); // tolerate one holiday/miscount, not a thin listing
  const shapeFilteredPool = buildCandidatePool({
    liquidityMap,
    excludeTickers,
    minPrice: MIN_PRICE,
    maxPrice: MAX_PRICE,
    minDollarVol: MIN_DOLLAR_VOL,
    minDays,
    poolSize: CANDIDATE_POOL_SIZE,
  });
  console.error(`[5/7] ${shapeFilteredPool.length} shape/liquidity-eligible candidates before market-cap+type check.`);

  // --- Market cap + type (single detail call also gates on real "CS" common-stock type).
  const capTargets = [...new Set([...exemptibleTickers, ...shapeFilteredPool.map((c) => c.ticker)])];
  console.error(`[6/7] Fetching market cap/type for ${capTargets.length} unique tickers (concurrency=${CONCURRENCY})...`);
  const capResults = await pooledMap(capTargets, async (t) => [t, await fetchTickerDetail(t)], CONCURRENCY);
  const capMap = new Map(capResults);

  const candidatePool = shapeFilteredPool
    .map((c) => ({ ...c, detail: capMap.get(c.ticker) }))
    .filter((c) => c.detail && c.detail.cap > 0 && c.detail.type === "CS")
    .map((c) => ({ ticker: c.ticker, cap: c.detail.cap, dvol: c.avgDollarVol, avgPrice: c.avgPrice }));
  console.error(`      ${candidatePool.length}/${shapeFilteredPool.length} candidates confirmed real market cap + type=CS.`);

  if (candidatePool.length === 0) {
    const out = { insufficient_data: true, tally, note: "No eligible control candidates survived cap/type filtering." };
    console.log(asJson ? JSON.stringify(out, null, 2) : `INSUFFICIENT DATA — ${out.note}`);
    return;
  }

  // --- Match every unique exemptible ticker to its nearest cap+dollar-volume control.
  const matchByTicker = new Map();
  const unmatchedReasons = { no_liquidity_data: 0, no_market_cap: 0, no_candidate_found: 0 };
  for (const t of exemptibleTickers) {
    const stats = liquidityMap.get(t);
    const detail = capMap.get(t);
    if (!stats) {
      unmatchedReasons.no_liquidity_data++;
      continue;
    }
    if (!detail || !(detail.cap > 0)) {
      unmatchedReasons.no_market_cap++;
      continue;
    }
    const match = nearestCandidateMatch({ cap: detail.cap, dvol: stats.avgDollarVol }, candidatePool, t);
    if (!match) {
      unmatchedReasons.no_candidate_found++;
      continue;
    }
    matchByTicker.set(t, {
      control_ticker: match.ticker,
      exemptible_cap: detail.cap,
      exemptible_dvol: stats.avgDollarVol,
      control_cap: match.cap,
      control_dvol: match.dvol,
      cap_ratio: Number((detail.cap / match.cap).toFixed(3)),
      dvol_ratio: Number((stats.avgDollarVol / match.dvol).toFixed(3)),
      distance: Number(match.distance.toFixed(3)),
    });
  }
  console.error(`      ${matchByTicker.size}/${exemptibleTickers.length} exemptible tickers matched to a control.`);

  // --- Measure the control's realized range on the SAME calendar date as each exemptible row.
  console.error(`[7/7] Fetching same-day minute bars for matched controls (concurrency=${CONCURRENCY})...`);
  const pairedRaw = await pooledMap(
    measured.filter((m) => matchByTicker.has(m.ticker)),
    async (m) => {
      const match = matchByTicker.get(m.ticker);
      const s = await sessionMoveStats(match.control_ticker, m.date);
      if (!s) return null;
      return {
        ticker: m.ticker,
        date: m.date,
        verdict: m.verdict,
        range_pct: m.range_pct,
        move_pct: m.move_pct,
        control_ticker: match.control_ticker,
        control_range_pct: s.range_pct,
        control_move_pct: s.move_pct,
        cap_ratio: match.cap_ratio,
        dvol_ratio: match.dvol_ratio,
      };
    },
    CONCURRENCY
  );
  const paired = pairedRaw.filter(Boolean);
  const noControlBars = measured.filter((m) => matchByTicker.has(m.ticker)).length - paired.length;

  const exemptibleRanges = paired.map((p) => p.range_pct);
  const controlRanges = paired.map((p) => p.control_range_pct);
  const capRatios = paired.map((p) => p.cap_ratio);
  const dvolRatios = paired.map((p) => p.dvol_ratio);

  const summary = {
    window: { from: ymd(start), to: ymd(end), lookback_days: LOOKBACK_DAYS, importance_min: IMPORTANCE_MIN },
    params: {
      candidate_pool_size: CANDIDATE_POOL_SIZE,
      liquidity_lookback_trading_days: LIQUIDITY_LOOKBACK_TRADING_DAYS,
      buffer_days: BUFFER_DAYS,
      min_dollar_vol: MIN_DOLLAR_VOL,
      min_price: MIN_PRICE,
      max_price: MAX_PRICE,
    },
    tally,
    exemptible_count: exemptible.length,
    exemptible_with_bars: measured.length,
    unique_exemptible_tickers: exemptibleTickers.length,
    candidate_pool_size_final: candidatePool.length,
    matched_tickers: matchByTicker.size,
    unmatched_ticker_reasons: unmatchedReasons,
    paired_rows: paired.length,
    paired_rows_dropped_no_control_bars: noControlBars,
    median_range_pct: {
      exemptible: median(exemptibleRanges),
      liquidity_cap_matched_control: median(controlRanges),
    },
    median_cap_ratio: median(capRatios),
    median_dvol_ratio: median(dvolRatios),
    rows: paired,
  };

  if (asJson) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  console.log(`G-11 liquidity/cap-matched single-stock control — ${summary.window.from}..${summary.window.to} (importance>=${IMPORTANCE_MIN})`);
  console.log(`Exemptible rows: ${exemptible.length}, with bars: ${measured.length}, unique tickers: ${exemptibleTickers.length}`);
  console.log(`Candidate pool: ${shapeFilteredPool.length} shape/liquidity-eligible -> ${candidatePool.length} confirmed cap+type=CS`);
  console.log(`Matched: ${matchByTicker.size}/${exemptibleTickers.length} tickers (unmatched: ${JSON.stringify(unmatchedReasons)})`);
  console.log(`Paired rows (both sides have real bars): ${paired.length} (dropped for missing control bars: ${noControlBars})`);
  console.log("");
  console.log(`Median realized RTH range%:  exemptible=${summary.median_range_pct.exemptible ?? "n/a"}  liquidity/cap-matched control=${summary.median_range_pct.liquidity_cap_matched_control ?? "n/a"}`);
  console.log(`Median match quality:  cap_ratio=${summary.median_cap_ratio ?? "n/a"}x  dvol_ratio=${summary.median_dvol_ratio ?? "n/a"}x  (1.0 = perfect match, further from 1.0 = looser match)`);
  console.log("");
  console.log("ticker   date        control   range%(e)  range%(c)  cap_ratio  dvol_ratio");
  for (const r of paired.slice(0, 60)) {
    console.log(
      `${r.ticker.padEnd(8)} ${r.date}  ${r.control_ticker.padEnd(8)}  ${String(r.range_pct).padStart(7)}  ${String(r.control_range_pct).padStart(8)}  ${String(r.cap_ratio).padStart(8)}  ${String(r.dvol_ratio).padStart(9)}`
    );
  }
  if (paired.length > 60) console.log(`... (${paired.length - 60} more rows omitted from console output — pass --json for the full set)`);
  console.log("");
  console.log("NOTE: matched on market cap + average dollar volume only (not sector/beta/historical vol).");
  console.log("Not a graded P&L backtest — see zerodte-sim.mjs for that. No gate touched.");
}

main().catch((err) => {
  console.error("FATAL:", err?.stack || err);
  process.exit(1);
});
