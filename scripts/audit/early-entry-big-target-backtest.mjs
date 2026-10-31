/**
 * EARLY-ENTRY BIG-TARGET BACKTEST — does the $1.00-$3.00 WATCH/ENTRY pipeline find contracts that
 * can actually reach $10.00 (stretch $20.00), and does the shipped exit rule capture that reach
 * when the underlying path gets there? (Operator directive, 2026-10-27: "A 5/5 day at roughly
 * +10% per play doesn't establish that it can find $1-$3 contracts that reach $10-$20... Measure
 * these separately: profitable exit rate, % reaching $10 before the stop/expiration, % reaching
 * $20, MAE, time to target, net expectancy, drawdown... Compare the current exits with partial-
 * profit and trailing-runner alternatives.")
 *
 * This is the SIBLING of early-entry-backtest.mjs, not a replacement — that script measures
 * %-P&L outcomes under a simplified mechanical proxy; THIS one measures the specific big-target
 * question (absolute-dollar reach) under the REAL shipped ratchet mechanics plus named
 * alternatives, replayed bar-by-bar via early-entry-exit-variants.ts's pure, imported functions
 * (never reimplemented here).
 *
 * REAL: classifySetup/detectDevelopingPressure/selectEarlyEntryContract/buildEarlyEntryAlert
 * (unmodified, same as early-entry-backtest.mjs), real Polygon minute bars (underlying + the
 * entered option contract), real listed same-day strikes, real point-in-time NBBO at entry,
 * replayRatchetExit/replayPartialProfitRunner (exit-engine.ts's own shipped constants, imported
 * via early-entry-exit-variants.ts — the SAME pure functions a future live wiring would use).
 *
 * APPROXIMATED / NOT MEASURED (disclosed, same root cause as early-entry-backtest.mjs):
 *   - Point-in-time IMPLIED VOLATILITY is unavailable from this historical data source — every
 *     chain row's iv is null, so target10/target20 (early-entry-target-reachability.ts) can be
 *     computed on the SELECTED contract only as a null-iv no-op; this backtest CANNOT validate
 *     the target-reachability plausibility filter against real history. It ships as an advisory,
 *     reporting-only field for live production (which DOES have real IV) — forward paper-trading
 *     is the only path to real evidence on whether it predicts anything, stated here rather than
 *     left implicit.
 *   - The hard stop / ratchet-floor / flat-timeout replay is MECHANICAL only — no thesis-break,
 *     catalyst, or regime evidence (unreconstructable from historical bars without fabricating
 *     it, same disclosed gap as this repo's other mechanical exit replays, e.g.
 *     swing-early-trim-ab.mjs).
 *   - Entry fill = real historical NBBO ask + a disclosed realistic delay. Exit fills use the
 *     bar's own OHLC (a touch, not a guaranteed fill at that exact price).
 *
 * THIS SCRIPT NEVER CHANGES A GATE, FLAG, OR THRESHOLD — evidence-gathering only.
 *
 * USAGE
 *   env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY \
 *   node --import tsx scripts/audit/early-entry-big-target-backtest.mjs [options]
 *
 * OPTIONS
 *   --days=N            real trading sessions to walk back (default 20)
 *   --entry-delay=SEC   realistic fill delay after the entry-trigger minute (default 90)
 *   --fee-per-leg=USD   disclosed flat per-contract commission (default 0.65)
 *   --concurrency=N     parallel (ticker,day) detection passes (default 2)
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
const CONTRACTS_PER_LEG_MULTIPLIER = 100; // standard $100/contract option multiplier

const { polygonSpotTicker } = await import(`${SRC}lib/zerodte/board.ts`);
const { momentumScanUniverse, rateByRvol } = await import(`${SRC}lib/zerodte/momentum-signal-discovery.ts`);
const { classifySetup } = await import(`${SRC}lib/zerodte/early-entry-state.ts`);
const { selectEarlyEntryContract } = await import(`${SRC}lib/zerodte/early-entry-contract-select.ts`);
const { buildEarlyEntryAlert } = await import(`${SRC}lib/zerodte/early-entry-alert.ts`);
const { replayRatchetExit, replayPartialProfitRunner } = await import(`${SRC}lib/zerodte/early-entry-exit-variants.ts`);
const { fetchStockMinuteBars, fetchIndexMinuteBars, fetchDailyMarketSummary, fetchOptionMinuteBars } =
  await import(`${SRC}lib/providers/polygon.ts`);
const { PLAN_RULES } = await import(`${SRC}lib/zerodte/plan.ts`);
const { etWallClockToUtcMs } = await import("./lib/swing-cadence-gap-eval.mjs");

const POLYGON_BASE = process.env.POLYGON_API_BASE;
const POLYGON_KEY = process.env.POLYGON_API_KEY;

const line = (c = "─", w = 118) => c.repeat(w);
const fmtPct = (n) => (n == null ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`);
const fmtDollar = (n) => (n == null ? "—" : `$${n.toFixed(2)}`);
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
  d.setUTCDate(d.getUTCDate() - 1);
  const MAX_ATTEMPTS = n * 3 + 10;
  for (let i = 0; i < MAX_ATTEMPTS && out.length < n; i++) {
    const day = ymd(d);
    const g = await fetchDailyMarketSummary(day).catch(() => null);
    if (g?.results?.length) out.push(day);
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return out.reverse();
}

const VARIANTS = [
  { key: "SHIPPED", label: "shipped ratchet (arm+5%, 0.4x peak)", kind: "ratchet", config: {} },
  { key: "WIDE_A", label: "wide runner A (arm+50%, 0.3x peak)", kind: "ratchet", config: { armPnlPct: 50, lockFraction: 0.3 } },
  { key: "WIDE_B", label: "wide runner B (arm+100%, 0.25x peak)", kind: "ratchet", config: { armPnlPct: 100, lockFraction: 0.25 } },
  { key: "PARTIAL", label: "partial-profit ($5/$10 tranches, unguarded runner)", kind: "partial", config: {} },
];

function runVariant(variant, entryAsk, optionBars, entryAtMs, timeStopMs) {
  if (variant.kind === "ratchet") {
    return replayRatchetExit(entryAsk, optionBars, entryAtMs, timeStopMs, variant.config);
  }
  return replayPartialProfitRunner(entryAsk, optionBars, entryAtMs, timeStopMs, variant.config);
}

/** Leg count for fee accounting: entry (1) + however many realized exit events this variant's
 *  decision produced (ratchet variants always close in one shot; partial-profit closes once per
 *  tranche plus the final runner exit). */
function legCount(variant, result) {
  if (variant.kind === "ratchet") return 2; // entry + 1 exit
  return 1 + (result.tranchesBanked ?? 0) + 1; // entry + N tranche exits + 1 runner exit
}

async function gradeAllVariants({ occ, day, entryAtMs, entryAsk, underlyingBars, strike, side }) {
  const timeStopMs = etWallClockToUtcMs(day, PLAN_RULES.time_stop_et_minutes);
  const optionBars = (await fetchOptionMinuteBars(occ, day, day).catch(() => []))
    .filter((b) => Number.isFinite(b.t) && Number.isFinite(b.h) && Number.isFinite(b.l) && Number.isFinite(b.c));

  const underlyingAfterEntry = underlyingBars.filter((b) => b.t > entryAtMs && b.t <= timeStopMs);
  const reachedTheMoney = underlyingAfterEntry.some((b) => (side === "call" ? b.h >= strike : b.l <= strike));

  const perVariant = {};
  for (const variant of VARIANTS) {
    const r = runVariant(variant, entryAsk, optionBars, entryAtMs, timeStopMs);
    const legs = legCount(variant, r);
    const realizedPx = variant.kind === "partial" ? r.blendedExitPx : r.exitPx;
    const dollarPnl = (realizedPx - entryAsk) * CONTRACTS_PER_LEG_MULTIPLIER - legs * FEE_PER_LEG;
    const dollarCost = entryAsk * CONTRACTS_PER_LEG_MULTIPLIER;
    const pnlPct = dollarCost > 0 ? (dollarPnl / dollarCost) * 100 : null;
    perVariant[variant.key] = {
      exitReason: r.exitReason,
      exitAtMs: r.exitAtMs,
      realizedPx: Math.round(realizedPx * 100) / 100,
      peakPx: r.peakPx,
      troughPx: r.troughPx,
      hit10: r.hit10,
      hit20: r.hit20,
      timeToHit10Ms: r.timeToHit10Ms,
      timeToHit20Ms: r.timeToHit20Ms,
      exitCleared10: r.exitCleared10,
      exitCleared20: r.exitCleared20,
      maePct: entryAsk > 0 ? Math.round(((r.troughPx - entryAsk) / entryAsk) * 10000) / 100 : null,
      pnlPct: pnlPct != null ? Math.round(pnlPct * 100) / 100 : null,
      dollarPnl: Math.round(dollarPnl * 100) / 100,
      outcome: pnlPct == null ? "NO_DATA" : pnlPct > 0 ? "WIN" : "LOSS",
      legs,
      tranchesBanked: r.tranchesBanked ?? null,
    };
  }

  return { reachedTheMoney, optionBarsWalked: optionBars.length, perVariant };
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

  if (best.state !== "ENTRY") return { ticker, day, status: best.state };

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
    direction: best.direction, spotAtWatch, spotNow,
    minutesRemaining: Math.max(0, 16 * 60 - (new Date(entryAtMs).getUTCHours() * 60)), chain,
  });
  const alert = buildEarlyEntryAlert({ ticker, classification: best, candidates, rejections, spotNow, minutesRemaining: 60 });
  if (alert.state !== "ENTRY") {
    return { ticker, day, status: "NO_QUALIFYING_CONTRACT", strikesConsidered: sideStrikes.length, rejections: rejections.length };
  }

  const occ = quotes.find((q) => q.strike === alert.contract.strike && q.side === alert.contract.side)?.occ;
  if (!occ) return { ticker, day, status: "NO_QUALIFYING_CONTRACT" };

  const graded = await gradeAllVariants({
    occ, day, entryAtMs, entryAsk: alert.contract.ask, underlyingBars: bars, strike: alert.contract.strike, side: alert.contract.side,
  });
  return {
    ticker, day, status: "GRADED", direction: best.direction, strike: alert.contract.strike, side: alert.contract.side,
    entryAtMs, entryAsk: alert.contract.ask, entryBid: alert.contract.bid,
    signalAtMs: best.watch_detected_at_ms, entryTriggerAtMs: best.entry_triggered_at_ms,
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
console.log("  EARLY-ENTRY BIG-TARGET BACKTEST — $1-$3 entries, does the path reach $10/$20?");
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
      const shipped = r.perVariant.SHIPPED;
      console.log(
        `    ${r.day} ${r.ticker} ${r.direction} ${r.side}$${r.strike} entry=$${r.entryAsk} ` +
          `hit10=${shipped.hit10} hit20=${shipped.hit20} peak=${fmtDollar(shipped.peakPx)} -> SHIPPED ${shipped.outcome} ${fmtPct(shipped.pnlPct)}`
      );
    } else if (r.status === "ERROR") {
      console.log(`    ${r.day} ${r.ticker} ERROR: ${r.message}`);
    }
  }
  return results;
}

const trainResults = await processDays(trainDays, "TRAIN");
const valResults = await processDays(valDays, "VALIDATION");

function summarizeVariant(graded, key) {
  const rows = graded.map((r) => r.perVariant[key]).filter((v) => v.outcome !== "NO_DATA");
  const n = rows.length;
  if (n === 0) return { n: 0 };
  const wins = rows.filter((v) => v.outcome === "WIN").length;
  const hit10 = rows.filter((v) => v.hit10).length;
  const hit20 = rows.filter((v) => v.hit20).length;
  const exitCleared10 = rows.filter((v) => v.exitCleared10).length;
  const exitCleared20 = rows.filter((v) => v.exitCleared20).length;
  const avgPnlPct = rows.reduce((s, v) => s + v.pnlPct, 0) / n;
  const avgDollarPnl = rows.reduce((s, v) => s + v.dollarPnl, 0) / n;
  const avgMae = rows.reduce((s, v) => s + (v.maePct ?? 0), 0) / n;
  let running = 0, peak = 0, maxDd = 0;
  for (const v of rows) { running += v.dollarPnl; peak = Math.max(peak, running); maxDd = Math.min(maxDd, running - peak); }
  const hit10Rows = rows.filter((v) => v.timeToHit10Ms != null);
  return {
    n,
    profitableExitRatePct: Math.round((wins / n) * 1000) / 10,
    hit10RatePct: Math.round((hit10 / n) * 1000) / 10,
    hit20RatePct: Math.round((hit20 / n) * 1000) / 10,
    exitCleared10RatePct: Math.round((exitCleared10 / n) * 1000) / 10,
    exitCleared20RatePct: Math.round((exitCleared20 / n) * 1000) / 10,
    avgPnlPct: Math.round(avgPnlPct * 100) / 100,
    avgDollarPnl: Math.round(avgDollarPnl * 100) / 100,
    avgMaePct: Math.round(avgMae * 100) / 100,
    maxDrawdownDollars: Math.round(maxDd * 100) / 100,
    nHit10ForTiming: hit10Rows.length,
  };
}

function summarize(label, results) {
  console.log(`\n${line()}`);
  console.log(`  ${label} (n=${results.length} ticker-day attempts)`);
  console.log(line());
  const statusCounts = new Map();
  for (const r of results) statusCounts.set(r.status, (statusCounts.get(r.status) ?? 0) + 1);
  console.log(`    status breakdown: ${JSON.stringify(Object.fromEntries(statusCounts))}`);

  const graded = results.filter((r) => r.status === "GRADED");
  console.log(`\n    GRADED qualifying ENTRY contracts: n=${graded.length}`);
  if (graded.length === 0) {
    console.log("    INSUFFICIENT DATA for separated big-target stats this split. Widen --days.");
    return { n: 0 };
  }

  const reachedMoneyRate = (graded.filter((r) => r.reachedTheMoney).length / graded.length) * 100;
  console.log(`    reached the money (underlying crossed the strike before time-stop): ${reachedMoneyRate.toFixed(1)}%`);
  console.log();
  console.log(
    `    ${"variant".padEnd(42)} n   profitable%  hit$10%  hit$20%  exitClr$10%  exitClr$20%  avgP&L%  avg$P&L  avgMAE%  maxDD$`
  );
  const perVariantSummary = {};
  for (const variant of VARIANTS) {
    const s = summarizeVariant(graded, variant.key);
    perVariantSummary[variant.key] = s;
    if (s.n === 0) {
      console.log(`    ${variant.label.padEnd(42)} 0   INSUFFICIENT DATA`);
      continue;
    }
    console.log(
      `    ${variant.label.padEnd(42)} ${String(s.n).padEnd(3)} ${String(s.profitableExitRatePct).padEnd(11)} ` +
        `${String(s.hit10RatePct).padEnd(8)} ${String(s.hit20RatePct).padEnd(8)} ${String(s.exitCleared10RatePct).padEnd(12)} ` +
        `${String(s.exitCleared20RatePct).padEnd(12)} ${String(s.avgPnlPct).padEnd(8)} ${String(s.avgDollarPnl).padEnd(8)} ` +
        `${String(s.avgMaePct).padEnd(8)} ${s.maxDrawdownDollars}`
    );
  }
  return { n: graded.length, reachedMoneyRate, perVariantSummary };
}

const trainSummary = summarize("TRAIN", trainResults);
const valSummary = summarize("VALIDATION — HELD OUT, UNSEEN", valResults);

console.log(`\n${line("═")}`);
console.log("  Note: hit$10%/hit$20% are IDENTICAL across variants by construction (same real");
console.log("  option premium bar path) -- the variant-dependent numbers are exitClr$10/$20%");
console.log("  (did THIS rule's own realized exit actually bank at/above that level), avgP&L%,");
console.log("  avg$P&L, and maxDD -- those are what separates one exit rule from another.");
console.log("  No gate, flag, or threshold changed by this run — evidence-gathering only.");
console.log("  Historical point-in-time IV is unavailable -- target10/target20 plausibility");
console.log("  (early-entry-target-reachability.ts) could NOT be backtested here; see header.");
console.log(line("═"));

if (EMIT_JSON) {
  console.log("\n<<<JSON>>>");
  console.log(JSON.stringify({
    sessions, trainDays, valDays, universe, variants: VARIANTS.map((v) => ({ key: v.key, label: v.label, config: v.config })),
    trainResults, valResults, trainSummary, valSummary, params: { DAYS, ENTRY_DELAY_SEC, FEE_PER_LEG },
  }, null, 2));
}
