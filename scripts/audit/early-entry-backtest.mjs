/**
 * EARLY-ENTRY BACKTEST — real historical validation of the WATCH/ENTRY $1.00-$3.00 pipeline
 * (operator directive, 2026-10-25, 2nd iteration: "catch the setup BEFORE the major move...
 * Validate using historical option quotes where available, realistic spreads, slippage, and
 * fees. Measure alert timing, achievable entry prices, maximum favorable/adverse excursion, and
 * how often contracts actually reached the money. Prevent look-ahead bias. Report missing data
 * and losing setups honestly.")
 * ============================================================================================
 *
 * WHAT THIS MEASURES
 * -------------------
 * Replays the REAL, SHIPPED pipeline — `classifySetup` (early-entry-state.ts, which itself
 * composes `detectDevelopingPressure`), `selectEarlyEntryContract`
 * (early-entry-contract-select.ts), and `buildEarlyEntryAlert` (early-entry-alert.ts) — against
 * REAL historical Polygon data, over the operator's fixed 10-name universe
 * (ticker-universe.ts / momentum-signal-discovery.ts's `momentumScanUniverse`).
 *
 * NO-LOOKAHEAD: `classifySetup`'s own internal walk (see its own file header) only ever reads
 * bars up to the index it is currently evaluating — calling it ONCE with a full real session's
 * bars therefore gives the IDENTICAL watch/entry transition a live, incremental per-minute call
 * would have found in real time. This script relies on that proven property rather than
 * re-implementing a second walk loop (see early-entry-state.test.ts for the unit proof).
 *
 * REAL vs. APPROXIMATED (disclosed every run):
 * REAL:
 *   - `classifySetup` / `detectDevelopingPressure` / `selectEarlyEntryContract` /
 *     `buildEarlyEntryAlert` / `rateByRvol` — imported unmodified from production code.
 *   - The underlying's own REAL Polygon minute bars (equity/index-aware via `polygonSpotTicker`).
 *   - A REAL trailing avg-daily-volume (same real `fetchStockMinuteBars` data, 20 trailing
 *     calendar days ending the day BEFORE the test day — never the test day itself or later).
 *   - The REAL listed same-day strikes for that historical date (Polygon
 *     `/v3/reference/options/contracts`, `expired=true` — works for any real past date).
 *   - REAL point-in-time NBBO quotes at the entry instant (+ a disclosed realistic entry delay)
 *     for every listed same-day strike on the confirmed side.
 *   - The entered contract's OWN real minute bars for the rest of the session (walked forward to
 *     the SAME PLAN_RULES time-stop the live board uses) for MFE/MAE/reached-the-money/exit P&L.
 *   - Fees: the same disclosed flat $0.65/contract/leg this toolkit's sibling scripts already use.
 * APPROXIMATED / NOT MEASURED:
 *   - Point-in-time IMPLIED VOLATILITY is unavailable from this historical data source, so every
 *     chain row's `iv` is null — `selectEarlyEntryContract`'s own reachability term then reads 0
 *     (never fabricated), and ranking among several qualifying strikes falls back to spread
 *     quality + room-to-run alone. Live production, with a real IV feed, ranks differently.
 *   - "Reached the money" uses the underlying's own bar HIGH/LOW crossing the strike — a touch,
 *     not a guaranteed option fill at that instant (same disclosed convention as this toolkit's
 *     other touch-based grading, e.g. strike-reachability.ts's own PROXY header).
 *   - The mechanical exit rule (-50% hard stop else hold to the 15:50 ET time-stop) is a simple
 *     proxy for "a loss," not the live board's full scale-out/trim machinery.
 *   - A single-stock universe member without a true daily 0DTE listing on a given day (confirmed
 *     live before writing this: Mon/Wed/Fri-only for several Mag-7 names) correctly produces zero
 *     graded rows that day — never fabricated.
 *
 * THIS SCRIPT NEVER CHANGES A GATE, FLAG, OR THRESHOLD — evidence-gathering only.
 *
 * USAGE
 *   env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY \
 *   node --import tsx scripts/audit/early-entry-backtest.mjs [options]
 *
 * OPTIONS
 *   --days=N            real trading sessions to walk back (default 20)
 *   --entry-delay=SEC   realistic fill delay after the entry-trigger minute (default 90)
 *   --fee-per-leg=USD   disclosed flat per-contract commission (default 0.65)
 *   --concurrency=N     parallel (ticker,day) detection passes (default 2 -- this sandbox's
 *                       network proxy hard-kills the process above ~4-6 concurrent large Polygon
 *                       fetches; measured live, see the companion momentum-signal-backtest.mjs)
 *   --quote-concurrency=N  parallel per-strike quote fetches within one signal (default 6)
 *   --json
 */

if (!process.env.POLYGON_API_BASE || !/^https?:\/\//.test(process.env.POLYGON_API_BASE)) {
  process.env.POLYGON_API_BASE = "https://api.massive.com";
}

const SRC = new URL("../../src/", import.meta.url).pathname;
const argv = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    return m ? [m[1], m[2] ?? "true"] : [a, "true"];
  })
);
const DAYS = Math.max(1, Number(argv.days ?? 20));
const ENTRY_DELAY_SEC = Math.max(0, Number(argv["entry-delay"] ?? 90));
const FEE_PER_LEG = Math.max(0, Number(argv["fee-per-leg"] ?? 0.65));
const CONCURRENCY = Math.max(1, Number(argv.concurrency ?? 2));
const QUOTE_CONCURRENCY = Math.max(1, Number(argv["quote-concurrency"] ?? 6));
const EMIT_JSON = Boolean(argv.json);

const { polygonSpotTicker } = await import(`${SRC}lib/zerodte/board.ts`);
const { momentumScanUniverse, rateByRvol } = await import(`${SRC}lib/zerodte/momentum-signal-discovery.ts`);
const { classifySetup } = await import(`${SRC}lib/zerodte/early-entry-state.ts`);
const { selectEarlyEntryContract } = await import(`${SRC}lib/zerodte/early-entry-contract-select.ts`);
const { buildEarlyEntryAlert } = await import(`${SRC}lib/zerodte/early-entry-alert.ts`);
const { fetchStockMinuteBars, fetchIndexMinuteBars, fetchDailyMarketSummary, fetchOptionMinuteBars } =
  await import(`${SRC}lib/providers/polygon.ts`);
const { PLAN_RULES } = await import(`${SRC}lib/zerodte/plan.ts`);
const { etWallClockToUtcMs } = await import("./lib/swing-cadence-gap-eval.mjs");

const POLYGON_BASE = process.env.POLYGON_API_BASE;
const POLYGON_KEY = process.env.POLYGON_API_KEY;

const line = (c = "─", w = 112) => c.repeat(w);
const fmtPct = (n) => (n == null ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`);
const ymd = (d) => d.toISOString().slice(0, 10);
function etYmd(ms) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(ms));
}

async function mapPool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length || 1) }, () => worker()));
  return out;
}

async function realMinuteBars(ticker, from, to) {
  const sym = polygonSpotTicker(ticker);
  const bars = sym.startsWith("I:")
    ? await fetchIndexMinuteBars(sym, from, to).catch(() => [])
    : await fetchStockMinuteBars(sym, from, to).catch(() => []);
  return bars
    .filter((b) => Number.isFinite(b.t) && Number.isFinite(b.h) && Number.isFinite(b.l) && Number.isFinite(b.c))
    .map((b) => ({ t: b.t, h: b.h, l: b.l, c: b.c, v: Number.isFinite(b.v) ? b.v : undefined }));
}

/** Real trailing avg daily volume ONLY from days strictly before `dayYmd` -- no look-ahead. */
async function trailingAvgDailyVolume(ticker, dayYmd) {
  const dayOpenMs = etWallClockToUtcMs(dayYmd, 9 * 60 + 30);
  const toExclusive = etYmd(dayOpenMs - 86_400_000);
  const from = etYmd(dayOpenMs - 20 * 86_400_000);
  const bars = await realMinuteBars(ticker, from, toExclusive);
  const byDate = new Map();
  for (const b of bars) {
    const d = etYmd(b.t);
    byDate.set(d, (byDate.get(d) ?? 0) + (b.v ?? 0));
  }
  const days = [...byDate.values()];
  if (days.length === 0) return null;
  return days.reduce((a, b) => a + b, 0) / days.length;
}

async function todaySameDayStrikes(ticker, dayYmd) {
  const underlying = polygonSpotTicker(ticker).startsWith("I:") ? "SPX" : ticker;
  async function side(contractType) {
    const qs = new URLSearchParams({
      underlying_ticker: underlying, contract_type: contractType, expired: "true",
      "expiration_date.gte": dayYmd, "expiration_date.lte": dayYmd,
      sort: "strike_price", order: "asc", limit: "250", apiKey: POLYGON_KEY,
    });
    const res = await fetch(`${POLYGON_BASE}/v3/reference/options/contracts?${qs}`);
    const j = await res.json().catch(() => null);
    return (j?.results ?? []).map((r) => ({ occ: r.ticker, strike: Number(r.strike_price), side: contractType }));
  }
  const [calls, puts] = await Promise.all([side("call"), side("put")]);
  return [...calls, ...puts];
}

async function fetchQuoteNear(occ, atMs, windowMs = 120_000) {
  const qs = new URLSearchParams({
    "timestamp.gte": String((atMs - windowMs) * 1e6), "timestamp.lte": String((atMs + windowMs) * 1e6),
    order: "asc", limit: "50000", apiKey: POLYGON_KEY,
  });
  try {
    const res = await fetch(`${POLYGON_BASE}/v3/quotes/${encodeURIComponent(occ)}?${qs}`);
    const j = await res.json().catch(() => null);
    if (!j?.results?.length) return null;
    let best = null, bestDiff = Infinity;
    for (const q of j.results) {
      const t = Math.floor(q.sip_timestamp / 1e6);
      const diff = Math.abs(t - atMs);
      if (diff < bestDiff) { bestDiff = diff; best = q; }
    }
    return best ? { bid: best.bid_price, ask: best.ask_price } : null;
  } catch {
    return null;
  }
}

async function resolveSessions(n) {
  const out = [];
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1); // never today -- its bars aren't final
  const MAX_ATTEMPTS = n * 3 + 10;
  for (let i = 0; i < MAX_ATTEMPTS && out.length < n; i++) {
    const day = ymd(d);
    const g = await fetchDailyMarketSummary(day).catch(() => null);
    if (g?.results?.length) out.push(day);
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return out.reverse(); // oldest first -- chronological TRAIN/VALIDATION split
}

/** Grade the entered contract's forward path: MFE/MAE (option premium, %), whether the
 *  underlying ever reached the money (crossed the strike), and a simple mechanical
 *  -50%-stop-else-hold P&L with a real exit NBBO quote on a non-touch. */
async function gradeEnteredContract({ occ, day, entryAtMs, entryAsk, strike, side, underlyingBars }) {
  const timeStopMs = etWallClockToUtcMs(day, PLAN_RULES.time_stop_et_minutes);
  const optionBars = await fetchOptionMinuteBars(occ, day, day).catch(() => []);
  const walk = optionBars.filter((b) => Number.isFinite(b.t) && b.t > entryAtMs && b.t <= timeStopMs).sort((a, b) => a.t - b.t);

  let peak = entryAsk, trough = entryAsk;
  for (const b of walk) {
    if (b.h > peak) peak = b.h;
    if (b.l < trough) trough = b.l;
  }
  const mfePct = entryAsk > 0 ? ((peak - entryAsk) / entryAsk) * 100 : null;
  const maePct = entryAsk > 0 ? ((trough - entryAsk) / entryAsk) * 100 : null;

  const underlyingAfterEntry = underlyingBars.filter((b) => b.t > entryAtMs && b.t <= timeStopMs);
  const reachedTheMoney = underlyingAfterEntry.some((b) => (side === "call" ? b.h >= strike : b.l <= strike));

  const stopPx = entryAsk * (1 + PLAN_RULES.stop_pct / 100);
  let exitPx = null, exitReason = "time_stop";
  for (const b of walk) {
    if (b.l <= stopPx) { exitPx = stopPx; exitReason = "stopped"; break; }
  }
  if (exitPx == null) {
    const q = await fetchQuoteNear(occ, timeStopMs);
    exitPx = q && q.bid > 0 ? q.bid : walk.length ? walk[walk.length - 1].c : 0;
  }
  const dollarPnl = (exitPx - entryAsk) * 100 - 2 * FEE_PER_LEG;
  const dollarCost = entryAsk * 100;
  const pnlPct = dollarCost > 0 ? (dollarPnl / dollarCost) * 100 : null;

  return {
    mfePct: mfePct != null ? Math.round(mfePct * 100) / 100 : null,
    maePct: maePct != null ? Math.round(maePct * 100) / 100 : null,
    reachedTheMoney,
    exitReason,
    exitPx: Math.round(exitPx * 100) / 100,
    pnlPct: pnlPct != null ? Math.round(pnlPct * 100) / 100 : null,
    outcome: pnlPct == null ? "NO_DATA" : pnlPct > 0 ? "WIN" : "LOSS",
    barsWalked: walk.length,
  };
}

async function processTickerDayInner(ticker, day) {
  const [bars, avgDailyVolume] = await Promise.all([
    realMinuteBars(ticker, day, day),
    trailingAvgDailyVolume(ticker, day),
  ]);
  if (bars.length < 75) return { ticker, day, status: "NO_BARS" };

  const rated = rateByRvol(bars, avgDailyVolume);
  const long = classifySetup({ rated, direction: "long" });
  const short = classifySetup({ rated, direction: "short" });
  const rank = (s) => (s === "ENTRY" ? 2 : s === "WATCH" ? 1 : 0);
  const best = rank(long.state) >= rank(short.state) ? long : short;

  if (best.state === "NO_SETUP") return { ticker, day, status: "NO_SETUP" };
  if (best.state === "WATCH") return { ticker, day, status: "WATCH", level: best.level };
  if (best.state === "EXPIRED") return { ticker, day, status: "EXPIRED" };
  if (best.state === "INVALIDATED") return { ticker, day, status: "INVALIDATED" };

  // state === "ENTRY"
  const entryAtMs = best.entry_triggered_at_ms + ENTRY_DELAY_SEC * 1000;
  const strikes = await todaySameDayStrikes(ticker, day).catch(() => []);
  const side = best.direction === "long" ? "call" : "put";
  const sideStrikes = strikes.filter((s) => s.side === side);
  if (sideStrikes.length === 0) return { ticker, day, status: "NO_SAME_DAY_LISTING" };

  const quotes = await mapPool(sideStrikes, QUOTE_CONCURRENCY, async (s) => {
    const q = await fetchQuoteNear(s.occ, entryAtMs);
    return { ...s, bid: q?.bid ?? null, ask: q?.ask ?? null };
  });
  const chain = quotes.map((q) => ({ strike: q.strike, side: q.side, bid: q.bid, ask: q.ask, oi: null, iv: null }));

  const spotAtEntryIdx = rated.findIndex((r) => r.bar.t === best.entry_triggered_at_ms);
  const spotNow = spotAtEntryIdx >= 0 ? rated[spotAtEntryIdx].bar.c : rated[rated.length - 1].bar.c;
  const watchBar = rated.find((r) => r.bar.t === best.watch_detected_at_ms);
  const spotAtWatch = watchBar?.bar.c ?? spotNow;

  const { candidates, rejections } = selectEarlyEntryContract({
    direction: best.direction, spotAtWatch, spotNow, minutesRemaining: Math.max(0, 16 * 60 - (new Date(entryAtMs).getUTCHours() * 60)), chain,
  });
  const alert = buildEarlyEntryAlert({ ticker, classification: best, candidates, rejections, spotNow, minutesRemaining: 60 });
  if (alert.state !== "ENTRY") {
    return { ticker, day, status: "NO_QUALIFYING_CONTRACT", strikesConsidered: sideStrikes.length, rejections: rejections.length };
  }

  const occ = quotes.find((q) => q.strike === alert.contract.strike && q.side === alert.contract.side)?.occ;
  if (!occ) return { ticker, day, status: "NO_QUALIFYING_CONTRACT" };

  const graded = await gradeEnteredContract({
    occ, day, entryAtMs, entryAsk: alert.contract.ask, strike: alert.contract.strike, side: alert.contract.side, underlyingBars: bars,
  });
  const signalMinuteFromOpen = Math.round((best.watch_detected_at_ms - etWallClockToUtcMs(day, 9 * 60 + 30)) / 60_000);
  const entryMinuteFromOpen = Math.round((best.entry_triggered_at_ms - etWallClockToUtcMs(day, 9 * 60 + 30)) / 60_000);
  return {
    ticker, day, status: "GRADED", direction: best.direction, strike: alert.contract.strike, side: alert.contract.side,
    signalAtMs: best.watch_detected_at_ms, entryTriggerAtMs: best.entry_triggered_at_ms, entryFillAtMs: entryAtMs,
    entryAsk: alert.contract.ask, entryBid: alert.contract.bid,
    spreadPct: candidates[0]?.spread_pct ?? null,
    signalMinuteFromOpen, entryMinuteFromOpen, capturedFraction: candidates[0]?.captured_fraction ?? null,
    ...graded,
  };
}

async function processTickerDay(ticker, day) {
  try {
    return await processTickerDayInner(ticker, day);
  } catch (err) {
    return { ticker, day, status: "ERROR", message: err instanceof Error ? err.message : String(err) };
  }
}

console.log(line("═"));
console.log("  EARLY-ENTRY BACKTEST — real historical validation, no look-ahead, $1.00-$3.00 band");
console.log(`  days=${DAYS} · entry delay ${ENTRY_DELAY_SEC}s · fee/leg $${FEE_PER_LEG}`);
console.log(line("═"));

console.log("\n[1] Resolving real trading sessions...");
const sessions = await resolveSessions(DAYS);
console.log(`    ${sessions.length} real session day(s): ${sessions.join(", ")}`);
const splitIdx = Math.ceil(sessions.length / 2);
const trainDays = sessions.slice(0, splitIdx);
const valDays = sessions.slice(splitIdx);
console.log(`    TRAIN: ${trainDays.join(", ")}`);
console.log(`    VALIDATION (held out, unseen): ${valDays.join(", ")}`);

const universe = momentumScanUniverse();
console.log(`\n[2] Universe (${universe.length}): ${universe.join(", ")}`);

async function processDays(days, label) {
  console.log(`\n[${label}] grading ${days.length} session day(s) x ${universe.length} ticker(s)...`);
  const pairs = days.flatMap((day) => universe.map((ticker) => ({ ticker, day })));
  const results = await mapPool(pairs, CONCURRENCY, (p) => processTickerDay(p.ticker, p.day));
  for (const r of results) {
    if (r.status === "GRADED") {
      console.log(
        `    ${r.day} ${r.ticker} ${r.direction} ${r.side}$${r.strike} bid/ask=$${r.entryBid}/$${r.entryAsk} spread=${r.spreadPct?.toFixed(1) ?? "—"}% ` +
          `signal@${new Date(r.signalAtMs).toISOString().slice(11, 16)}Z(+${r.signalMinuteFromOpen}m) entry@${new Date(r.entryFillAtMs).toISOString().slice(11, 16)}Z(+${r.entryMinuteFromOpen}m) ` +
          `MFE=${fmtPct(r.mfePct)} MAE=${fmtPct(r.maePct)} reached_money=${r.reachedTheMoney} -> ${r.outcome} ${fmtPct(r.pnlPct)}`
      );
    } else if (r.status === "WATCH") {
      console.log(`    ${r.day} ${r.ticker} WATCH only (level ${r.level}) -- never triggered`);
    } else if (r.status === "ERROR") {
      console.log(`    ${r.day} ${r.ticker} ERROR: ${r.message}`);
    }
  }
  return results;
}

const trainResults = await processDays(trainDays, "TRAIN");
const valResults = await processDays(valDays, "VALIDATION");

function summarize(label, results) {
  console.log(`\n${line()}`);
  console.log(`  ${label} (n=${results.length} ticker-day attempts)`);
  console.log(line());
  const statusCounts = new Map();
  for (const r of results) statusCounts.set(r.status, (statusCounts.get(r.status) ?? 0) + 1);
  console.log(`    status breakdown: ${JSON.stringify(Object.fromEntries(statusCounts))}`);

  const graded = results.filter((r) => r.status === "GRADED" && r.outcome !== "NO_DATA");
  console.log(`\n    GRADED qualifying ENTRY contracts: n=${graded.length}`);
  if (graded.length === 0) {
    console.log("    INSUFFICIENT DATA for P&L stats this split. Widen --days.");
    return { n: 0 };
  }
  const wins = graded.filter((r) => r.outcome === "WIN").length;
  const winRate = (wins / graded.length) * 100;
  const avgPnl = graded.reduce((s, r) => s + r.pnlPct, 0) / graded.length;
  const avgMfe = graded.reduce((s, r) => s + (r.mfePct ?? 0), 0) / graded.length;
  const avgMae = graded.reduce((s, r) => s + (r.maePct ?? 0), 0) / graded.length;
  const reachedMoneyRate = (graded.filter((r) => r.reachedTheMoney).length / graded.length) * 100;
  let running = 0, peak = 0, maxDd = 0;
  for (const r of graded) { running += r.pnlPct; peak = Math.max(peak, running); maxDd = Math.min(maxDd, running - peak); }
  const avgSignalMin = graded.reduce((s, r) => s + r.signalMinuteFromOpen, 0) / graded.length;
  const avgEntryMin = graded.reduce((s, r) => s + r.entryMinuteFromOpen, 0) / graded.length;

  console.log(`    avg time-from-open: signal +${avgSignalMin.toFixed(0)}m, entry-trigger +${avgEntryMin.toFixed(0)}m`);
  console.log(`    reached the money (underlying crossed the strike before the time-stop): ${reachedMoneyRate.toFixed(1)}%`);
  console.log(`    avg MFE (option premium, %): ${fmtPct(avgMfe)}    avg MAE: ${fmtPct(avgMae)}`);
  console.log(`    mechanical win rate (-50% stop / hold-to-15:50-ET): ${winRate.toFixed(1)}%`);
  console.log(`    avg P&L (same rule, net of 2x$${FEE_PER_LEG} fee): ${fmtPct(avgPnl)}`);
  console.log(`    max drawdown (sequential, same rule): ${fmtPct(maxDd)}`);
  const noQualifying = results.filter((r) => r.status === "NO_QUALIFYING_CONTRACT").length;
  const watchOnly = results.filter((r) => r.status === "WATCH").length;
  console.log(`    WATCH-only (never triggered): ${watchOnly}    ENTRY-triggered but NO_TRADE (no qualifying $1-$3 contract): ${noQualifying}`);
  return { n: graded.length, winRate, avgPnl, maxDd, reachedMoneyRate, avgMfe, avgMae };
}

const trainSummary = summarize("TRAIN", trainResults);
const valSummary = summarize("VALIDATION — HELD OUT, UNSEEN", valResults);

console.log(`\n${line("═")}`);
console.log("  No gate, flag, or threshold changed by this run — evidence-gathering only.");
console.log("  See this script's own header for the full REAL vs. APPROXIMATED disclosure.");
console.log(line("═"));

if (EMIT_JSON) {
  console.log("\n<<<JSON>>>");
  console.log(JSON.stringify({ sessions, trainDays, valDays, universe, trainResults, valResults, trainSummary, valSummary, params: { DAYS, ENTRY_DELAY_SEC, FEE_PER_LEG } }, null, 2));
}
