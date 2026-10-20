/**
 * RVOL EARLY-ENTRY A/B (UNBIASED) — supersedes zerodte-rvol-early-entry-ab.mjs's smoke test.
 * ============================================================================================
 * WHY THIS REPLACES THE EARLIER SCRIPT (2026-10-20, member directive: "fix the RVOL test's
 * survivorship bias, then compare earlier-entry candidates against the current system using
 * only information available at each signal")
 * ------------------------------------------------------------------------------------------
 * The earlier script started from real COMMITTED BREAKOUT plays — tickers that ALREADY became
 * real winners by construction — so "enter earlier, buying cheaper premium, in a stock we
 * already know moves favorably that day" won trivially regardless of whether RVOL specifically
 * carried any signal. That is exactly the "don't use the later move to justify an entry
 * retroactively" trap; it was caught and documented, not reported as a finding (see
 * docs/audit/findings-staging/2026-10-20-zerodte-breakout-origin-rvol-findings.md §F).
 *
 * THE FIX: this script starts from the SAME real, UNBIASED whole-market candidate pool
 * `thesis-rank-reject-outcome-ab.mjs` already built for a different question — every real
 * BREAKOUT/BREAKDOWN mover a session actually produced (`screenBreakoutMovers`/
 * `screenBreakdownMovers`, real grouped-daily bars, real dynamic-N cap via
 * `rankMoversForChainFetch`/`resolveBreakoutCandidateCap`) — which includes REAL LOSERS
 * (setups whose move fizzles) alongside real winners, not just the names that eventually became
 * committed plays. This is a POPULATION fix, not a methodology tweak: the comparison below is
 * now genuinely unbiased by eventual outcome.
 *
 * METHOD (same-contract, same-exit-rule, different-entry-TIME, per the member's "consistent
 * entry/exit/cost assumptions... keep exit management unchanged while testing entries"):
 *   1. For every real candidate in the unbiased pool, on EVERY real session day in the window:
 *      a "CURRENT-SYSTEM" baseline entry checkpoint, fixed at 10:30 ET (same convention
 *      `thesis-rank-reject-outcome-ab.mjs`/`discovery-recall-probe.mjs` already use as "the
 *      earliest discovery could plausibly act" — 30min opening range + 30min to confirm a real
 *      break).
 *   2. An "EARLY-RVOL" entry checkpoint: the earliest instant (if any, before the baseline, by
 *      at least --early-margin minutes) the REAL, unmodified `computeRelativeVolume` (shadow
 *      signal shipped PR #6287/#6289, imported directly) classifies "high"/"very_high" against a
 *      REAL time-of-day volume profile built from the ticker's own real trailing days — no
 *      look-ahead: only bars up to and including each candidate instant are used.
 *   3. BOTH checkpoints graded identically: resolve ONE historical same-day-expiry ATM contract
 *      per candidate (nearest strike to the REAL spot AT THE BASELINE instant — resolved ONCE,
 *      used for BOTH legs, so a strike-selection difference never confounds a timing
 *      comparison), real NBBO at (checkpoint + realistic entry delay) for entry (paying the real
 *      spread), real option minute-bar walk under the SAME PLAN_RULES -50/+100 mechanical rule
 *      (exit management held fixed, per the member's instruction — this isolates ENTRY TIMING
 *      as the only variable), real NBBO exit on a non-touch (spread paid again), MINUS a
 *      disclosed flat per-contract fee assumption (no existing convention in this codebase to
 *      inherit — $0.65/contract/leg, a commonly-cited retail options commission, is a stated
 *      ASSUMPTION, not a measured number).
 *   4. When no same-day-expiry contract is resolvable (thin/no 0DTE listing for that name/day —
 *      common on BREAKDOWN/small-cap names), falls back to the underlying-continuation proxy
 *      (`thesis-rank-reject-outcome-ab.mjs`'s own `gradeContinuation` logic, same favorable-first
 *      rule) and labels that row's basis `UNDERLYING_PROXY` — NEVER blended with the real-option
 *      `REAL_OPTION` rows in a single average; every reported number states which basis it is.
 *
 * TRAIN/VALIDATION: chronological session-day split, held-out half never shapes the read.
 *
 * THIS SCRIPT NEVER CHANGES A GATE, FILTER, OR EXIT RULE — evidence-gathering only. If results
 * are real and robust, the next step is a SHADOW-mode trial, never a direct live change.
 *
 * USAGE
 *   POLYGON_API_BASE=https://api.massive.com \
 *   env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY \
 *   node --import tsx scripts/audit/zerodte-rvol-early-entry-unbiased-ab.mjs [options]
 * OPTIONS
 *   --days=N            trading sessions to walk back (default 10)
 *   --max-tickers=N     candidates per session, both directions combined (default 40)
 *   --early-margin=N    minutes the RVOL signal must precede the baseline by (default 10)
 *   --entry-delay=SEC   realistic entry delay after either checkpoint (default 90)
 *   --hold-minutes=N    max holding window (default 90)
 *   --fee-per-leg=USD   disclosed flat per-contract commission assumption (default 0.65)
 *   --concurrency=N     parallel per-ticker fetches (default 8)
 *   --json
 */

if (!process.env.POLYGON_API_BASE || !/^https?:\/\//.test(process.env.POLYGON_API_BASE)) {
  process.env.POLYGON_API_BASE = "https://api.massive.com";
}
process.env.ZERODTE_THESIS_FIRST = process.env.ZERODTE_THESIS_FIRST ?? "1";

const SRC = new URL("../../src/", import.meta.url).pathname;
const argv = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    return m ? [m[1], m[2] ?? "true"] : [a, "true"];
  })
);
const DAYS = Math.max(1, Number(argv.days ?? 10));
const MAX_TICKERS_PER_DAY = Math.max(2, Number(argv["max-tickers"] ?? 40));
const EARLY_MARGIN_MIN = Math.max(1, Number(argv["early-margin"] ?? 10));
const ENTRY_DELAY_SEC = Math.max(0, Number(argv["entry-delay"] ?? 90));
const HOLD_MINUTES = Math.max(5, Number(argv["hold-minutes"] ?? 90));
const FEE_PER_LEG = Math.max(0, Number(argv["fee-per-leg"] ?? 0.65));
const CONCURRENCY = Math.max(1, Number(argv.concurrency ?? 8));
const EMIT_JSON = Boolean(argv.json);
const BASELINE_ET_MINUTES = 10 * 60 + 30; // 10:30 ET — same "current system" convention as the sibling tool

const { screenBreakoutMovers, screenBreakdownMovers } = await import(`${SRC}features/nighthawk/lib/candidates.ts`);
const { rankMoversForChainFetch, BREAKOUT_MAX_CANDIDATES, BREAKOUT_MAX_CANDIDATES_CEILING, BREAKOUT_SCREEN_POOL } = await import(`${SRC}lib/zerodte/breakout-discovery.ts`);
const { resolveBreakoutCandidateCap } = await import(`${SRC}lib/zerodte/breakout-cap.ts`);
const { fetchDailyMarketSummary, fetchStockMinuteBars } = await import(`${SRC}lib/providers/polygon.ts`);
const { buildTimeOfDayVolumeProfile, computeRelativeVolume, RVOL_PROFILE_MIN_DAYS } = await import(`${SRC}lib/zerodte/relative-volume.ts`);
const { groupMinuteBarsByDate } = await import(`${SRC}lib/zerodte/relative-volume-source.ts`);
const { PLAN_RULES } = await import(`${SRC}lib/zerodte/plan.ts`);
const { etWallClockToUtcMs } = await import("./lib/swing-cadence-gap-eval.mjs");

const POLYGON_BASE = process.env.POLYGON_API_BASE;
const POLYGON_KEY = process.env.POLYGON_API_KEY;

const line = (c = "─", w = 112) => c.repeat(w);
const fmtPct = (n) => (n == null ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`);
function etYmd(ms) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(ms));
}
const ymd = (d) => d.toISOString().slice(0, 10);

async function resolveSessions(n) {
  const out = [];
  const d = new Date();
  const MAX_ATTEMPTS = n * 3 + 5;
  for (let i = 0; i < MAX_ATTEMPTS && out.length < n; i++) {
    const day = ymd(d);
    const g = await fetchDailyMarketSummary(day).catch(() => null);
    if (g?.results?.length) out.push({ date: day, results: g.results });
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return out.reverse(); // oldest first, for a clean chronological TRAIN/VALIDATION split
}

async function mapPool(items, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length || 1) }, () => worker()));
  return out;
}

/** Real historical same-day-expiry ATM contract — nearest strike to spot. Mirrors
 *  gate-smallcap-sensitivity.mjs's resolveAtmContract (reference-contracts lookup), extended to
 *  both call/put sides. Expired-contract metadata is retained by Polygon indefinitely, so this
 *  works for any real historical date, not just "today." */
async function resolveAtmContract(ticker, spot, dateYmd, side) {
  const qs = new URLSearchParams({
    underlying_ticker: ticker, contract_type: side, expired: "true",
    "expiration_date.gte": dateYmd, "expiration_date.lte": dateYmd,
    sort: "strike_price", order: "asc", limit: "250", apiKey: POLYGON_KEY,
  });
  const res = await fetch(`${POLYGON_BASE}/v3/reference/options/contracts?${qs}`);
  const j = await res.json().catch(() => null);
  const rows = j?.results ?? [];
  if (!rows.length) return null;
  let best = null, bestDist = Infinity;
  for (const r of rows) {
    const dist = Math.abs(Number(r.strike_price) - spot);
    if (dist < bestDist) { bestDist = dist; best = r; }
  }
  return best ? { occ: best.ticker, strike: Number(best.strike_price) } : null;
}

async function fetchQuoteNear(occ, atMs, windowMs = 120_000) {
  const from = (atMs - windowMs) * 1e6, to = (atMs + windowMs) * 1e6;
  const url = `${POLYGON_BASE}/v3/quotes/${encodeURIComponent(occ)}?timestamp.gte=${from}&timestamp.lte=${to}&order=asc&limit=50000&apiKey=${POLYGON_KEY}`;
  const res = await fetch(url);
  const data = await res.json().catch(() => null);
  if (!data?.results?.length) return null;
  let best = null, bestDiff = Infinity;
  for (const q of data.results) {
    const t = Math.floor(q.sip_timestamp / 1e6);
    const diff = Math.abs(t - atMs);
    if (diff < bestDiff) { bestDiff = diff; best = q; }
  }
  return best ? { bid: best.bid_price, ask: best.ask_price } : null;
}

async function fetchOptionBars(occ, day) {
  const url = `${POLYGON_BASE}/v2/aggs/ticker/${encodeURIComponent(occ)}/range/1/minute/${day}/${day}?limit=1000&apiKey=${POLYGON_KEY}`;
  const res = await fetch(url);
  const data = await res.json().catch(() => null);
  return (data?.results ?? []).map((b) => ({ t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v }));
}

/** Grades one mechanical entry: real NBBO entry (+ fee), real option-bar walk under the
 *  UNCHANGED PLAN_RULES stop/target, real NBBO exit on non-touch (+ fee). */
async function gradeRealOption({ occ, direction, day, entryAtMs }) {
  const entryQuote = await fetchQuoteNear(occ, entryAtMs);
  if (!entryQuote || !(entryQuote.bid > 0) || !(entryQuote.ask > 0)) return { basis: "REAL_OPTION", outcome: "NO_QUOTE" };
  const entryPxRaw = direction === "long" ? entryQuote.ask : entryQuote.bid;
  const timeStopMs = Date.parse(`${day}T19:50:00Z`);
  const holdEndMs = Math.min(entryAtMs + HOLD_MINUTES * 60_000, timeStopMs);
  const bars = await fetchOptionBars(occ, day).catch(() => []);
  const walkBars = bars.filter((b) => b.t > entryAtMs && b.t <= holdEndMs);
  const stopPx = entryPxRaw * (1 + PLAN_RULES.stop_pct / 100);
  const targetPx = entryPxRaw * (1 + PLAN_RULES.target_pct / 100);
  let exitPx = null, exitReason = "time_stop", exitAtMs = holdEndMs;
  for (const b of walkBars) {
    if (b.l <= stopPx) { exitPx = stopPx; exitReason = "stopped"; exitAtMs = b.t; break; }
    if (b.h >= targetPx) { exitPx = targetPx; exitReason = "target"; exitAtMs = b.t; break; }
  }
  if (exitPx == null) {
    const exitQuote = await fetchQuoteNear(occ, exitAtMs);
    if (!exitQuote || !(exitQuote.bid > 0) || !(exitQuote.ask > 0)) return { basis: "REAL_OPTION", outcome: "NO_EXIT_QUOTE" };
    exitPx = exitQuote.bid;
  }
  // Real option contracts are a 100-share multiplier — a flat per-contract $ fee must be
  // weighed against the REAL dollar premium (entryPxRaw * 100), never against the raw per-share
  // quote directly. Treating it as a % of the bare quote (the first version of this script did)
  // let a $0.65 fee swamp and INVERT a real move on a cheap contract — caught live: SKHX's real
  // entry 0.05 -> exit 0.10 (a genuine +100% TARGET hit) was reported as a -2500% "LOSS" because
  // 0.65/0.05 = 1300% dwarfed the real 100% gain. Fixed: compute dollar P&L first, THEN convert
  // to a % of the real dollar premium paid.
  const dollarPnl = (exitPx - entryPxRaw) * 100 - 2 * FEE_PER_LEG; // entry + exit fee legs, in dollars
  const dollarCost = entryPxRaw * 100;
  const pnlPct = dollarCost > 0 ? (dollarPnl / dollarCost) * 100 : null;
  if (pnlPct == null) return { basis: "REAL_OPTION", outcome: "NO_QUOTE" };
  return {
    basis: "REAL_OPTION", entryPx: Math.round(entryPxRaw * 100) / 100, exitPx: Math.round(exitPx * 100) / 100,
    pnlPct: Math.round(pnlPct * 100) / 100, exitReason, outcome: pnlPct > 0 ? "WIN" : "LOSS",
  };
}

/** Underlying-continuation proxy fallback (gradeContinuation's own rule, FAV/ADV) — used ONLY
 *  when no same-day contract is resolvable. Never blended with REAL_OPTION rows. */
function gradeUnderlyingProxy(bars, direction, entryAtMs, closeMs, fav = 0.015) {
  const adv = fav / 2;
  const rth = bars
    .filter((b) => Number.isFinite(b.t) && b.t >= entryAtMs && b.t <= closeMs)
    .sort((a, b) => a.t - b.t);
  if (rth.length < 2) return { basis: "UNDERLYING_PROXY", outcome: "NO_BARS" };
  const entry = rth[0].c;
  if (!(entry > 0)) return { basis: "UNDERLYING_PROXY", outcome: "NO_BARS" };
  const favLevel = direction === "long" ? entry * (1 + fav) : entry * (1 - fav);
  const advLevel = direction === "long" ? entry * (1 - adv) : entry * (1 + adv);
  for (const b of rth) {
    const hitFav = direction === "long" ? b.h >= favLevel : b.l <= favLevel;
    const hitAdv = direction === "long" ? b.l <= advLevel : b.h >= advLevel;
    if (hitFav && !hitAdv) return { basis: "UNDERLYING_PROXY", outcome: "WIN", pnlPct: fav * 100 };
    if (hitAdv) return { basis: "UNDERLYING_PROXY", outcome: "LOSS", pnlPct: -adv * 100 };
  }
  return { basis: "UNDERLYING_PROXY", outcome: "LOSS", pnlPct: 0 };
}

console.log(line("═"));
console.log(`  RVOL EARLY-ENTRY A/B (UNBIASED) — real whole-market candidate pool, not just eventual winners`);
console.log(`  days=${DAYS} · max/day=${MAX_TICKERS_PER_DAY} · early margin >=${EARLY_MARGIN_MIN}min · entry delay ${ENTRY_DELAY_SEC}s · fee/leg $${FEE_PER_LEG}`);
console.log(line("═"));

console.log(`\n[1] Resolving real trading sessions…`);
const sessions = await resolveSessions(DAYS);
console.log(`    ${sessions.length} real session days: ${sessions.map((s) => s.date).join(", ")}`);
const splitIdx = Math.ceil(sessions.length / 2);
const trainSessions = sessions.slice(0, splitIdx);
const valSessions = sessions.slice(splitIdx);
console.log(`    TRAIN: ${trainSessions.map((s) => s.date).join(", ")}`);
console.log(`    VALIDATION (held out): ${valSessions.map((s) => s.date).join(", ")}`);

const SCREEN_POOL = Math.max(BREAKOUT_MAX_CANDIDATES_CEILING * 4, BREAKOUT_SCREEN_POOL);

async function processSession({ date, results }) {
  const longMovers = screenBreakoutMovers(results, SCREEN_POOL);
  const shortMovers = screenBreakdownMovers(results, SCREEN_POOL);
  const qualifying = longMovers.length + shortMovers.length;
  if (qualifying === 0) return { date, candidates: [], qualifying: 0 };
  const cap = resolveBreakoutCandidateCap({ qualifyingMovers: qualifying, floor: BREAKOUT_MAX_CANDIDATES, ceiling: BREAKOUT_MAX_CANDIDATES_CEILING });
  const perSide = Math.max(1, Math.floor(MAX_TICKERS_PER_DAY / 2));
  const rankedLong = rankMoversForChainFetch(longMovers, Math.min(cap, perSide), "long");
  const rankedShortAll = rankMoversForChainFetch(shortMovers, cap, "short");
  const longTickers = new Set(rankedLong.map((m) => m.ticker.toUpperCase()));
  const rankedShort = rankedShortAll.filter((m) => !longTickers.has(m.ticker.toUpperCase())).slice(0, perSide);
  const candidates = [
    ...rankedLong.map((m) => ({ ticker: m.ticker.toUpperCase(), direction: "long" })),
    ...rankedShort.map((m) => ({ ticker: m.ticker.toUpperCase(), direction: "short" })),
  ];
  console.log(`\n  [${date}] ${qualifying} real qualifying movers, cap ${cap} → grading ${candidates.length} candidates`);

  const baselineMs = etWallClockToUtcMs(date, BASELINE_ET_MINUTES);
  const rthOpenMs = etWallClockToUtcMs(date, 9 * 60 + 30);
  const closeMs = etWallClockToUtcMs(date, 16 * 60);

  const graded = await mapPool(candidates, async (cand) => {
    const todayBars = await fetchStockMinuteBars(cand.ticker, date, date).catch(() => []);
    if (!todayBars.length) return { ...cand, status: "NO_BARS" };
    const upToBaseline = todayBars.filter((b) => b.t >= rthOpenMs && b.t <= baselineMs);
    if (upToBaseline.length < 2) return { ...cand, status: "NO_BASELINE_BARS" };
    const spotAtBaseline = upToBaseline[upToBaseline.length - 1].c;

    // RVOL: real trailing-day profile, never the day itself.
    const fromDay = etYmd(rthOpenMs - 20 * 86_400_000);
    const trailingBars = await fetchStockMinuteBars(cand.ticker, fromDay, etYmd(rthOpenMs - 86_400_000)).catch(() => []);
    const byDate = groupMinuteBarsByDate(trailingBars);
    const dailyMinuteVolumes = [...byDate.values()];
    const profile = buildTimeOfDayVolumeProfile(dailyMinuteVolumes);
    const avgDailyVolume = dailyMinuteVolumes.length
      ? dailyMinuteVolumes.reduce((s, d) => s + d.reduce((a, b) => a + b, 0), 0) / dailyMinuteVolumes.length
      : null;
    if (!profile || !avgDailyVolume || dailyMinuteVolumes.length < RVOL_PROFILE_MIN_DAYS) {
      return { ...cand, status: "NO_PROFILE" };
    }
    let cumVol = 0, earliestHighMs = null;
    for (const b of upToBaseline) {
      cumVol += Number.isFinite(b.v) ? b.v : 0;
      const read = computeRelativeVolume({ cumulativeVolumeToday: cumVol, avgDailyVolume, nowMs: b.t, timeOfDayProfile: profile });
      if (read.classification === "high" || read.classification === "very_high") { earliestHighMs = b.t; break; }
    }
    if (earliestHighMs == null) return { ...cand, status: "NO_RVOL_SIGNAL" };
    const marginMin = Math.round((baselineMs - earliestHighMs) / 60_000);
    if (marginMin < EARLY_MARGIN_MIN) return { ...cand, status: "RVOL_NOT_EARLY_ENOUGH", marginMin };

    // ONE contract resolved at the BASELINE instant, used for BOTH legs — isolates entry timing.
    const side = cand.direction === "long" ? "call" : "put";
    const contract = await resolveAtmContract(cand.ticker, spotAtBaseline, date, side);
    const baselineEntryMs = baselineMs + ENTRY_DELAY_SEC * 1000;
    const earlyEntryMs = earliestHighMs + ENTRY_DELAY_SEC * 1000;

    let baselineLeg, earlyLeg;
    if (contract) {
      baselineLeg = await gradeRealOption({ occ: contract.occ, direction: cand.direction, day: date, entryAtMs: baselineEntryMs });
      earlyLeg = await gradeRealOption({ occ: contract.occ, direction: cand.direction, day: date, entryAtMs: earlyEntryMs });
    } else {
      baselineLeg = gradeUnderlyingProxy(todayBars, cand.direction, baselineEntryMs, closeMs);
      earlyLeg = gradeUnderlyingProxy(todayBars, cand.direction, earlyEntryMs, closeMs);
    }
    return { ...cand, status: "GRADED", marginMin, baselineLeg, earlyLeg };
  });
  return { date, candidates: graded, qualifying };
}

console.log(`\n[2] Grading TRAIN sessions…`);
const trainOut = [];
for (const s of trainSessions) trainOut.push(await processSession(s));
console.log(`\n[3] Grading VALIDATION sessions…`);
const valOut = [];
for (const s of valSessions) valOut.push(await processSession(s));

function summarize(label, sessionResults) {
  const all = sessionResults.flatMap((s) => s.candidates);
  const statusCounts = new Map();
  for (const c of all) statusCounts.set(c.status, (statusCounts.get(c.status) ?? 0) + 1);
  console.log(`\n${line()}`);
  console.log(`  ${label} (n=${all.length} candidates across ${sessionResults.length} session days)`);
  console.log(line());
  console.log(`    status breakdown: ${JSON.stringify(Object.fromEntries(statusCounts))}`);

  for (const basis of ["REAL_OPTION", "UNDERLYING_PROXY"]) {
    const graded = all.filter((c) => c.status === "GRADED" && c.baselineLeg?.basis === basis && c.earlyLeg?.basis === basis &&
      (c.baselineLeg.outcome === "WIN" || c.baselineLeg.outcome === "LOSS") && (c.earlyLeg.outcome === "WIN" || c.earlyLeg.outcome === "LOSS"));
    console.log(`\n    basis=${basis}: n=${graded.length}`);
    if (!graded.length) continue;
    const avgMargin = graded.reduce((s, c) => s + c.marginMin, 0) / graded.length;
    const baseWins = graded.filter((c) => c.baselineLeg.outcome === "WIN").length;
    const earlyWins = graded.filter((c) => c.earlyLeg.outcome === "WIN").length;
    const baseMeanPnl = graded.reduce((s, c) => s + c.baselineLeg.pnlPct, 0) / graded.length;
    const earlyMeanPnl = graded.reduce((s, c) => s + c.earlyLeg.pnlPct, 0) / graded.length;
    const paired = graded.map((c) => c.earlyLeg.pnlPct - c.baselineLeg.pnlPct);
    const meanDelta = paired.reduce((s, d) => s + d, 0) / paired.length;
    const sd = Math.sqrt(paired.reduce((s, d) => s + (d - meanDelta) ** 2, 0) / Math.max(1, paired.length - 1));
    const se = sd / Math.sqrt(paired.length);
    let running = 0, peakB = 0, maxDdB = 0, peakE = 0, maxDdE = 0;
    for (const c of graded) {
      running += c.baselineLeg.pnlPct; peakB = Math.max(peakB, running); maxDdB = Math.min(maxDdB, running - peakB);
    }
    running = 0;
    for (const c of graded) {
      running += c.earlyLeg.pnlPct; peakE = Math.max(peakE, running); maxDdE = Math.min(maxDdE, running - peakE);
    }
    console.log(`      avg entry-timing gained: ${avgMargin.toFixed(0)}min`);
    console.log(`      BASELINE (10:30 ET, current-system-equivalent): win_rate=${((baseWins / graded.length) * 100).toFixed(1)}%  net_expectancy=${fmtPct(baseMeanPnl)}  max_drawdown=${fmtPct(maxDdB)}`);
    console.log(`      EARLY (RVOL-signaled):                           win_rate=${((earlyWins / graded.length) * 100).toFixed(1)}%  net_expectancy=${fmtPct(earlyMeanPnl)}  max_drawdown=${fmtPct(maxDdE)}`);
    console.log(`      PAIRED mean delta (early - baseline): ${fmtPct(meanDelta)}  95% CI [${fmtPct(meanDelta - 1.96 * se)}, ${fmtPct(meanDelta + 1.96 * se)}]`);
  }
  return all;
}

const trainAll = summarize("TRAIN", trainOut);
const valAll = summarize("VALIDATION — HELD OUT, UNSEEN", valOut);

console.log(`\n${line("═")}`);
console.log(`  No gate, filter, or exit rule changed by this run — evidence-gathering only.`);
console.log(`  Exit management held IDENTICAL across both legs (same mechanical PLAN_RULES) —`);
console.log(`  this isolates ENTRY TIMING as the only variable under test, per the member's`);
console.log(`  instruction to keep exit management unchanged while testing entries.`);
console.log(line("═"));

if (EMIT_JSON) {
  console.log("\n<<<JSON>>>");
  console.log(JSON.stringify({ trainOut, valOut }, null, 2));
}
