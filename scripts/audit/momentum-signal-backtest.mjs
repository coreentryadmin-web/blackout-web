/**
 * MOMENTUM-SIGNAL BACKTEST — real historical validation of the 4th 0DTE discovery origin
 * (operator directive, 2026-10-25: "Find same-day expiration calls and puts with an executable
 * ask below $1.00 and strong momentum, volatility, volume, liquidity, and a realistic path toward
 * the strike... Backtest using information available at the signal time, realistic fills,
 * slippage, and fees. Report how often qualifying contracts reached $2, $5, $10, and $20 before
 * expiration, along with losses, drawdowns, sample size, and signal timing. Validate on separate,
 * unseen dates. Don't optimize around a few spectacular winners or force signals.")
 * ============================================================================================
 *
 * WHAT THIS MEASURES
 * -------------------
 * Replays the REAL, SHIPPED `evaluateMomentumSignal` (momentum-signal.ts) and the REAL
 * `computeRelativeVolume`/`buildTimeOfDayVolumeProfile` (relative-volume.ts) against REAL
 * historical Polygon data, over the operator's REAL fixed 10-name universe
 * (ticker-universe.ts, SPXW collapsed into SPX — momentum-signal-discovery.ts's own
 * `momentumScanUniverse`, imported unchanged), to answer the standing question this origin was
 * shipped on an UNCALIBRATED basis: does it actually find runners, and how often do the
 * contracts it would have entered reach $2 / $5 / $10 / $20 before expiry?
 *
 * NO-LOOKAHEAD, BY CONSTRUCTION: for every (ticker, session day), this walks the ticker's REAL
 * minute-by-minute bars forward and, at each minute, calls `evaluateMomentumSignal` using ONLY
 * bars up to and including that minute (never a later one) and an empty chain (the SAME
 * cheap-detection-before-expensive-chain-fetch two-phase discipline momentum-signal-discovery.ts
 * itself uses live). The FIRST minute `detected:true` is the "signal time" — nothing before it
 * could have known the setup would qualify, and nothing after it is consulted to decide whether
 * to act.
 *
 * REAL vs. APPROXIMATED (disclosed every run, never silently absent):
 * REAL:
 *   - `evaluateMomentumSignal` / `computeMomentumAcceleration` / `computeRelativeVolume` /
 *     `buildTimeOfDayVolumeProfile` — imported unmodified from production. Never reimplemented.
 *   - The underlying's own REAL Polygon minute bars (equity via fetchStockMinuteBars, index via
 *     fetchIndexMinuteBars + polygonSpotTicker's real I: mapping for SPX).
 *   - The REAL listed same-day strikes for that historical date (Polygon
 *     `/v3/reference/options/contracts`, `expired=true` — expired-contract metadata is retained
 *     indefinitely, so this works for any real past date, not just "today"; precedented in this
 *     toolkit by `gate-smallcap-sensitivity.mjs`/`zerodte-rvol-early-entry-unbiased-ab.mjs`).
 *   - REAL point-in-time NBBO quotes at the signal time (+ a disclosed realistic entry delay) for
 *     EVERY listed same-day strike on the confirmed side — the SAME real chain-screening
 *     `evaluateMomentumSignal`'s hard-reject stage runs live, just fed real historical quotes
 *     instead of a live snapshot.
 *   - The entered contract's OWN real minute bars for the rest of the session (walked forward to
 *     the SAME PLAN_RULES time-stop (15:50 ET) the live board uses) — this is what the $2/$5/$10/
 *     $20 touch flags and the mechanical stop/no-touch P&L are graded against.
 *   - Fees: a disclosed flat $0.65/contract/leg assumption (the SAME number
 *     `zerodte-rvol-early-entry-unbiased-ab.mjs` already uses — no second invented figure).
 * APPROXIMATED / NOT MEASURED (printed every run):
 *   - Point-in-time IMPLIED VOLATILITY is not available from this historical data source (no
 *     snapshot/greeks endpoint serves a past instant), so every backtest chain row's `iv` is
 *     `null` — exactly the honest "never estimate what you don't have" path
 *     `evaluateMomentumSignal`/`rankContractsByReachability` already define for a missing `iv`:
 *     `reachability_prob`/`target_reachability_prob` are null for every row here, so ranking among
 *     several qualifying strikes on a signal falls back to spread-quality alone (the SAME real
 *     `rank_score` formula, just with its reachability term correctly reading 0 rather than
 *     fabricated). Live production, with a real IV feed, WILL rank differently.
 *   - "Touched $X" uses the contract's own bar HIGH (a touch, not a guaranteed fill at that exact
 *     instant) — the same disclosed convention this toolkit's reachability-math module itself
 *     documents (strike-reachability.ts's PROXY header) and `condor-wr.mjs`'s own touch-based
 *     grading uses elsewhere in this codebase.
 *   - The mechanical stop/no-touch P&L rule (-50% hard stop else hold to the 15:50 ET time-stop)
 *     is a SIMPLE proxy for "a loss," not the live board's full scale-out/trim machinery — deliberately
 *     simple so "losses, drawdowns" has a well-defined number without smuggling in an un-reviewed
 *     exit-management claim; the $2/$5/$10/$20 touch rates are reported SEPARATELY and are NOT
 *     conditioned on this rule.
 *   - A single-stock universe member without a true daily 0DTE listing on a given day (common —
 *     most Mag-7 names list only Mon/Wed/Fri, confirmed live against this exact endpoint before
 *     writing this script) correctly produces zero graded rows that day — never fabricated.
 *
 * THIS SCRIPT NEVER CHANGES A GATE, FLAG, OR THRESHOLD — evidence-gathering only, same discipline
 * as every sibling A/B/backtest in this toolkit.
 *
 * USAGE
 *   env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY \
 *   node --import tsx scripts/audit/momentum-signal-backtest.mjs [options]
 *
 * OPTIONS
 *   --days=N            real trading sessions to walk back (default 20)
 *   --entry-delay=SEC   realistic fill delay after the signal minute (default 90)
 *   --fee-per-leg=USD   disclosed flat per-contract commission (default 0.65)
 *   --concurrency=N     parallel (ticker,day) detection passes (default 6)
 *   --quote-concurrency=N  parallel per-strike quote fetches within one signal (default 10)
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
const CONCURRENCY = Math.max(1, Number(argv.concurrency ?? 6));
const QUOTE_CONCURRENCY = Math.max(1, Number(argv["quote-concurrency"] ?? 10));
const EMIT_JSON = Boolean(argv.json);

const { evaluateMomentumSignal } = await import(`${SRC}lib/zerodte/momentum-signal.ts`);
const { computeIntradayRead } = await import(`${SRC}lib/zerodte/intraday.ts`);
const { polygonSpotTicker } = await import(`${SRC}lib/zerodte/board.ts`);
const { momentumScanUniverse } = await import(`${SRC}lib/zerodte/momentum-signal-discovery.ts`);
const {
  buildTimeOfDayVolumeProfile,
  computeRelativeVolume,
  RVOL_PROFILE_MIN_DAYS,
} = await import(`${SRC}lib/zerodte/relative-volume.ts`);
const { groupMinuteBarsByDate } = await import(`${SRC}lib/zerodte/relative-volume-source.ts`);
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

/** Bounded-concurrency map, preserving input order. */
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

/** Equity-vs-index-aware minute bars — the SAME real routing `polygonSpotTicker` drives in
 *  production (board.ts), so SPX correctly reads the index namespace instead of silently
 *  returning empty from a stock-only endpoint. */
async function realMinuteBars(ticker, from, to) {
  const sym = polygonSpotTicker(ticker);
  const bars = sym.startsWith("I:")
    ? await fetchIndexMinuteBars(sym, from, to).catch(() => [])
    : await fetchStockMinuteBars(sym, from, to).catch(() => []);
  return bars
    .filter((b) => Number.isFinite(b.t) && Number.isFinite(b.h) && Number.isFinite(b.l) && Number.isFinite(b.c))
    .map((b) => ({ t: b.t, h: b.h, l: b.l, c: b.c, v: Number.isFinite(b.v) ? b.v : undefined }));
}

/** Real same-day listed strikes (both sides) for one historical date — expired-contract metadata
 *  is retained indefinitely by Polygon, so this works for any real past date. */
async function todaySameDayStrikes(ticker, dayYmd) {
  const underlying = polygonSpotTicker(ticker).startsWith("I:") ? "SPX" : ticker;
  async function side(contractType) {
    const qs = new URLSearchParams({
      underlying_ticker: underlying,
      contract_type: contractType,
      expired: "true",
      "expiration_date.gte": dayYmd,
      "expiration_date.lte": dayYmd,
      sort: "strike_price",
      order: "asc",
      limit: "250",
      apiKey: POLYGON_KEY,
    });
    const res = await fetch(`${POLYGON_BASE}/v3/reference/options/contracts?${qs}`);
    const j = await res.json().catch(() => null);
    return (j?.results ?? []).map((r) => ({
      occ: r.ticker,
      strike: Number(r.strike_price),
      side: contractType,
    }));
  }
  const [calls, puts] = await Promise.all([side("call"), side("put")]);
  return [...calls, ...puts];
}

async function fetchQuoteNear(occ, atMs, windowMs = 120_000) {
  const qs = new URLSearchParams({
    "timestamp.gte": String((atMs - windowMs) * 1e6),
    "timestamp.lte": String((atMs + windowMs) * 1e6),
    order: "asc",
    limit: "50000",
    apiKey: POLYGON_KEY,
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

/** Real trailing RVOL profile + avg daily volume for `ticker`, built ONLY from days strictly
 *  before `dayYmd` -- no look-ahead into the test day or any later one. */
async function trailingRvolInputs(ticker, dayYmd) {
  const dayOpenMs = etWallClockToUtcMs(dayYmd, 9 * 60 + 30);
  const toExclusive = etYmd(dayOpenMs - 86_400_000);
  const from = etYmd(dayOpenMs - 20 * 86_400_000);
  const bars = await realMinuteBars(ticker, from, toExclusive);
  const byDate = groupMinuteBarsByDate(bars.map((b) => ({ t: b.t, v: b.v ?? 0 })));
  const dailyMinuteVolumes = [...byDate.values()];
  const profile = buildTimeOfDayVolumeProfile(dailyMinuteVolumes);
  const avgDailyVolume = dailyMinuteVolumes.length
    ? dailyMinuteVolumes.reduce((s, day) => s + day.reduce((a, b) => a + b, 0), 0) / dailyMinuteVolumes.length
    : null;
  return { profile, avgDailyVolume, daysUsed: dailyMinuteVolumes.length };
}

/** The no-lookahead walk: returns the FIRST minute `evaluateMomentumSignal` detects (empty-chain
 *  pre-check), or null if the ticker never qualifies this session day. */
function findSignalMinute(bars, profile, avgDailyVolume, dayYmd) {
  // `avgDailyVolume` is guaranteed non-null here -- the one real call site (processTickerDayInner)
  // already returns NO_RVOL_PROFILE before ever calling this function when it's null. Flagged by
  // CodeQL as a dead null-check when this still read `avgDailyVolume != null ? ... : {ratio:null}`.
  const rthOpenMs = etWallClockToUtcMs(dayYmd, 9 * 60 + 30);
  const closeMs = etWallClockToUtcMs(dayYmd, 16 * 60);
  const rth = bars.filter((b) => b.t >= rthOpenMs && b.t < closeMs).sort((a, b) => a.t - b.t);
  let cumVol = 0;
  for (let i = 0; i < rth.length; i++) {
    cumVol += rth[i].v ?? 0;
    if (i < 9) continue; // need >=10 bars for the 5m/5m momentum windows
    const soFar = rth.slice(0, i + 1);
    const intraday = computeIntradayRead(soFar);
    if (intraday.or_high == null || intraday.or_low == null) continue; // OR not formed yet
    const referenceLevel = { high: intraday.or_high, low: intraday.or_low };
    const rvol = computeRelativeVolume({
      cumulativeVolumeToday: cumVol,
      avgDailyVolume,
      nowMs: rth[i].t,
      timeOfDayProfile: profile,
    });
    const minutesRemaining = Math.max(0, (closeMs - rth[i].t) / 60_000);
    const precheck = evaluateMomentumSignal({
      ticker: "x",
      bars: soFar,
      referenceLevel,
      rvolRatio: rvol.ratio,
      minutesRemaining,
      chain: [],
      nowMs: rth[i].t,
    });
    if (precheck.detected) {
      return { atMs: rth[i].t, minutesRemaining, bars: soFar, rvolRatio: rvol.ratio };
    }
  }
  return null;
}

/** Grade one entered contract's forward path to the SAME PLAN_RULES time-stop the live board
 *  uses: $2/$5/$10/$20 touch flags (bar HIGH) + a simple mechanical -50%-stop-else-hold P&L,
 *  exiting on a real NBBO bid quote only when no stop is hit (same convention
 *  `zerodte-rvol-early-entry-unbiased-ab.mjs`'s `gradeRealOption` already uses). */
async function gradeEnteredContract({ occ, day, entryAtMs, entryAsk }) {
  const timeStopMs = etWallClockToUtcMs(day, PLAN_RULES.time_stop_et_minutes);
  const bars = await fetchOptionMinuteBars(occ, day, day).catch(() => []);
  const walk = bars.filter((b) => Number.isFinite(b.t) && b.t > entryAtMs && b.t <= timeStopMs).sort((a, b) => a.t - b.t);

  const thresholds = [2, 5, 10, 20];
  const touched = {};
  for (const th of thresholds) touched[th] = { hit: false, atMs: null, minutesToTouch: null };
  for (const b of walk) {
    for (const th of thresholds) {
      if (!touched[th].hit && b.h >= th) {
        touched[th] = { hit: true, atMs: b.t, minutesToTouch: Math.round((b.t - entryAtMs) / 60_000) };
      }
    }
  }

  const stopPx = entryAsk * (1 + PLAN_RULES.stop_pct / 100); // stop_pct is -50 -> stopPx = 0.5*entry
  let exitPx = null;
  let exitReason = "time_stop";
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
    touched,
    exitReason,
    exitPx: Math.round(exitPx * 100) / 100,
    pnlPct: pnlPct != null ? Math.round(pnlPct * 100) / 100 : null,
    outcome: pnlPct == null ? "NO_DATA" : pnlPct > 0 ? "WIN" : "LOSS",
    barsWalked: walk.length,
  };
}

/** One full (ticker, day) pass: detect (no look-ahead), screen the real chain at the signal
 *  moment, grade the top-ranked qualifying contract. */
async function processTickerDay(ticker, day) {
  try {
    return await processTickerDayInner(ticker, day);
  } catch (err) {
    return { ticker, day, status: "ERROR", message: err instanceof Error ? `${err.message}\n${err.stack}` : String(err) };
  }
}

async function processTickerDayInner(ticker, day) {
  const dayOpenMs = etWallClockToUtcMs(day, 9 * 60 + 30);
  const [bars, { profile, avgDailyVolume, daysUsed }] = await Promise.all([
    realMinuteBars(ticker, day, day),
    trailingRvolInputs(ticker, day),
  ]);
  if (bars.length < 10) return { ticker, day, status: "NO_BARS" };
  if (avgDailyVolume == null || daysUsed < RVOL_PROFILE_MIN_DAYS) {
    return { ticker, day, status: "NO_RVOL_PROFILE" };
  }

  const signal = findSignalMinute(bars, profile, avgDailyVolume, day);
  if (!signal) return { ticker, day, status: "NOT_DETECTED" };

  const signalMinuteFromOpen = Math.round((signal.atMs - dayOpenMs) / 60_000);
  const strikes = await todaySameDayStrikes(ticker, day).catch(() => []);
  if (strikes.length === 0) return { ticker, day, status: "NO_SAME_DAY_LISTING", signalMinuteFromOpen };

  const entryAtMs = signal.atMs + ENTRY_DELAY_SEC * 1000;

  // Re-derive the signal's own direction/momentum honestly (both are deterministic functions of
  // `signal.bars` alone, already proven to detect above -- recomputing here, rather than
  // threading `findSignalMinute`'s internal precheck result out, keeps that function's return
  // shape minimal).
  const intraday = computeIntradayRead(signal.bars);
  const referenceLevel = { high: intraday.or_high, low: intraday.or_low };
  const prechk = evaluateMomentumSignal({
    ticker, bars: signal.bars, referenceLevel, rvolRatio: signal.rvolRatio,
    minutesRemaining: signal.minutesRemaining, chain: [], nowMs: signal.atMs,
  });
  const direction = prechk.direction;
  const momentum = prechk.momentum;
  const side = direction === "long" ? "call" : "put";
  const sideStrikes = strikes.filter((s) => s.side === side);
  if (sideStrikes.length === 0) return { ticker, day, status: "NO_SAME_DAY_LISTING", signalMinuteFromOpen };

  const quotes = await mapPool(sideStrikes, QUOTE_CONCURRENCY, async (s) => {
    const q = await fetchQuoteNear(s.occ, entryAtMs);
    return { ...s, bid: q?.bid ?? null, ask: q?.ask ?? null };
  });

  const chain = quotes.map((q) => ({ strike: q.strike, side: q.side, bid: q.bid, ask: q.ask, oi: null, iv: null }));
  const real = evaluateMomentumSignal({
    ticker, bars: signal.bars, referenceLevel, rvolRatio: signal.rvolRatio,
    minutesRemaining: signal.minutesRemaining, chain, nowMs: entryAtMs,
  });
  if (!real.detected || real.candidates.length === 0) {
    return {
      ticker, day, status: "NO_QUALIFYING_CONTRACT", signalMinuteFromOpen,
      rejections: real.rejections.length, strikesConsidered: sideStrikes.length,
    };
  }

  const top = real.candidates[0];
  const occ = quotes.find((q) => q.strike === top.strike && q.side === top.side)?.occ;
  if (!occ) return { ticker, day, status: "NO_QUALIFYING_CONTRACT", signalMinuteFromOpen };

  const graded = await gradeEnteredContract({ occ, day, entryAtMs, entryAsk: top.ask });
  return {
    ticker, day, status: "GRADED", signalMinuteFromOpen, direction,
    strike: top.strike, side: top.side, entryAsk: top.ask, spreadPct: top.spread_pct,
    rvolRatio: signal.rvolRatio, recentMovePct: momentum.recent_move_pct,
    strikesConsidered: sideStrikes.length, rejections: real.rejections.length,
    ...graded,
  };
}

console.log(line("═"));
console.log("  MOMENTUM-SIGNAL BACKTEST — real historical validation, no look-ahead");
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
        `    ${r.day} ${r.ticker} ${r.direction} ${r.side}$${r.strike} entry=$${r.entryAsk} ` +
          `signal@+${r.signalMinuteFromOpen}m rvol=${r.rvolRatio?.toFixed(2) ?? "—"} -> ${r.outcome} ${fmtPct(r.pnlPct)}`
      );
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
  console.log(`\n    GRADED qualifying contracts: n=${graded.length}`);
  if (graded.length === 0) {
    console.log("    INSUFFICIENT DATA — no qualifying contract this split. Widen --days.");
    return { n: 0 };
  }

  const avgSignalMinute = graded.reduce((s, r) => s + r.signalMinuteFromOpen, 0) / graded.length;
  const wins = graded.filter((r) => r.outcome === "WIN").length;
  const winRate = (wins / graded.length) * 100;
  const avgPnl = graded.reduce((s, r) => s + r.pnlPct, 0) / graded.length;
  let running = 0, peak = 0, maxDd = 0;
  for (const r of graded) {
    running += r.pnlPct;
    peak = Math.max(peak, running);
    maxDd = Math.min(maxDd, running - peak);
  }
  const touchRate = (th) => (graded.filter((r) => r.touched[th]?.hit).length / graded.length) * 100;
  const avgTouchMinutes = (th) => {
    const hits = graded.filter((r) => r.touched[th]?.hit);
    return hits.length ? hits.reduce((s, r) => s + r.touched[th].minutesToTouch, 0) / hits.length : null;
  };

  console.log(`    avg time-from-open to signal: ${avgSignalMinute.toFixed(0)}min`);
  console.log(`    win rate (mechanical -50% stop / hold-to-15:50-ET rule): ${winRate.toFixed(1)}%`);
  console.log(`    avg P&L (same rule, net of 2x$${FEE_PER_LEG} fee): ${fmtPct(avgPnl)}`);
  console.log(`    max drawdown (sequential, same rule): ${fmtPct(maxDd)}`);
  console.log(`\n    MILESTONE TOUCH RATES (bar HIGH reaching the level before the 15:50 ET time-stop):`);
  for (const th of [2, 5, 10, 20]) {
    const rate = touchRate(th);
    const avgMin = avgTouchMinutes(th);
    console.log(
      `      reached $${th}: ${rate.toFixed(1)}% of qualifying contracts` +
        (avgMin != null ? ` (avg ${avgMin.toFixed(0)}min after entry)` : "")
    );
  }
  return { n: graded.length, winRate, avgPnl, maxDd, avgSignalMinute };
}

const trainSummary = summarize("TRAIN", trainResults);
const valSummary = summarize("VALIDATION — HELD OUT, UNSEEN", valResults);

console.log(`\n${line("═")}`);
console.log("  No gate, flag, or threshold changed by this run — evidence-gathering only.");
console.log("  See this script's own header for the full REAL vs. APPROXIMATED disclosure");
console.log("  (point-in-time IV unavailable -> reachability ranking falls back to spread only;");
console.log("  milestone touches are bar-HIGH touches, not guaranteed fills; the mechanical P&L");
console.log("  rule is a simple -50%-stop-else-hold proxy, not the live board's full exit stack).");
console.log(line("═"));

if (EMIT_JSON) {
  console.log("\n<<<JSON>>>");
  console.log(JSON.stringify({
    sessions, trainDays, valDays, universe,
    trainResults, valResults, trainSummary, valSummary,
    params: { DAYS, ENTRY_DELAY_SEC, FEE_PER_LEG },
  }, null, 2));
}
