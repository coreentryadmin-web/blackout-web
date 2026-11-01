/**
 * THESIS_RANK_REJECT REAL-COST A/B — does the `thesis_rank_reject` gate (especially its
 * dominant `momentum_abs_floor` sub-gate) actually separate winners from losers once REAL
 * option costs, point-in-time contract selection, and a held-out validation split are applied?
 * ============================================================================================
 * WHY THIS EXISTS (2026-10-20, member directive: "Test thesis_rank_reject, especially
 * momentum_abs_floor, using point-in-time contract selection, historical option bid/ask quotes,
 * realistic entry delay, costs on both sides, and a chronological held-out validation set...
 * Compare net expectancy, entry timing, losses, and drawdown against the current baseline — not
 * just win rate. Preserve current exit management and risk controls during testing.")
 * ------------------------------------------------------------------------------------------
 * `thesis-rank-reject-outcome-ab.mjs` already answered the UNDERLYING-basis version of this
 * question (REJECT n=119 graded 68.1% WR vs PASS n=379 graded 53.0% WR, 10-session run,
 * 112/119 REJECTs traced to `momentum_abs_floor`) — but it has no real option cost and no
 * TRAIN/VALIDATION split, both named as open gaps in its own header/this investigation's report.
 * This script closes BOTH gaps by reusing that tool's exact real candidate-generation +
 * `attachThesisFirstLive` machinery (never reimplemented) and grafting on the real-cost grading
 * machinery already built and fee-bug-fixed in `zerodte-rvol-early-entry-unbiased-ab.mjs`
 * (`resolveAtmContract`/`fetchQuoteNear`/`fetchOptionBars`/`gradeRealOption`, copied verbatim
 * including the $100-multiplier fee-calculation fix — see that script's own header for the
 * SKHX -2500%-vs-+74% bug this already caught once).
 *
 * WHAT'S REAL vs. APPROXIMATED (same disclosure discipline as both source tools)
 * -----------------------------------------------------------------------------------------------
 * REAL: screenBreakoutMovers/screenBreakdownMovers (real grouped-daily bars), rankMoversFor-
 * ChainFetch + resolveBreakoutCandidateCap (real dynamic-N cap), breakoutScoreBreakdown (real
 * score formula), computeIntradayRead (real VWAP/opening-range/trend, real minute bars),
 * attachThesisFirstLive (the EXACT function scan.ts calls live — real rail scoring, real
 * archetype classification, real per-archetype gates, real rank-tier resolver — nothing
 * reimplemented). Point-in-time contract selection: resolveAtmContract uses the REAL spot AT THE
 * SIGNAL INSTANT (computeIntradayRead's own `.last` over bars strictly at/before the entry
 * checkpoint) — no look-ahead. Real NBBO entry/exit (Polygon `/v3/quotes`), real option minute
 * bars for the mechanical stop/target walk, SAME UNCHANGED `PLAN_RULES` stop/target for every
 * leg regardless of REJECT/PASS (exit management and risk controls held fixed, per the member's
 * instruction — this isolates the GATE DECISION, not entry speed, as the variable under test).
 *
 * APPROXIMATED (disclosed, inherited from thesis-rank-reject-outcome-ab.mjs's own setup-
 * construction path): `key_resistances`/`key_supports`/`rel_volume` left null — matches what a
 * live BREAKOUT-origin setup actually carries through the SAME pipeline (production's own
 * `buildBreakoutSetup` sets these null too for BREAKOUT origin; see that tool's header for the
 * line-number proof). PIN population out of scope — same unreachable-from-this-sandbox
 * limitation as the sibling tool (no historical GEX-snapshot replay path, module-boundary import
 * error); not re-attempted here.
 *
 * ENTRY TIMING: identical, fixed `--entry` ET checkpoint for BOTH REJECT and PASS rows — this
 * test isolates whether the GATE's decision (not entry speed) predicts real-cost outcome, so
 * "entry timing gained" is not a metric here (that question is `zerodte-rvol-early-entry-
 * unbiased-ab.mjs`'s). Net expectancy, win rate, average loss, and additive max-drawdown are
 * reported for both REJECT and PASS, at both REAL_OPTION and UNDERLYING_PROXY basis, split
 * REJECT further by the specific archetype-gate block code (`momentum_abs_floor` vs others).
 *
 * TRAIN/VALIDATION: chronological session-day split (oldest half = TRAIN, newest half = held-out
 * VALIDATION), same convention as the RVOL unbiased A/B.
 *
 * THIS SCRIPT NEVER CHANGES A GATE, FILTER, OR EXIT RULE — evidence-gathering only.
 *
 * USAGE
 *   POLYGON_API_BASE=https://api.massive.com \
 *   env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY \
 *   node --import tsx scripts/audit/zerodte-thesis-rank-reject-real-cost-ab.mjs [options]
 * OPTIONS
 *   --days=N            trading sessions to walk back (default 14)
 *   --max-tickers=N     candidates per session, both directions combined (default 50)
 *   --entry=HH:MM       ET signal/decision checkpoint, same for REJECT and PASS (default 10:30)
 *   --entry-delay=SEC   realistic entry delay after the checkpoint (default 90)
 *   --hold-minutes=N    max holding window for the real-option walk (default 90)
 *   --fee-per-leg=USD   disclosed flat per-contract commission assumption (default 0.65)
 *   --fav=N             underlying-proxy favorable-first threshold (default 0.015)
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
const DAYS = Math.max(1, Number(argv.days ?? 14));
const MAX_TICKERS_PER_DAY = Math.max(2, Number(argv["max-tickers"] ?? 50));
const [ENTRY_H, ENTRY_M] = String(argv.entry ?? "10:30").split(":").map(Number);
const ENTRY_ET_MINUTES = ENTRY_H * 60 + (ENTRY_M || 0);
const ENTRY_DELAY_SEC = Math.max(0, Number(argv["entry-delay"] ?? 90));
const HOLD_MINUTES = Math.max(5, Number(argv["hold-minutes"] ?? 90));
const FEE_PER_LEG = Math.max(0, Number(argv["fee-per-leg"] ?? 0.65));
const FAV = Number(argv.fav ?? 0.015);
const ADV = FAV / 2;
const CONCURRENCY = Math.max(1, Number(argv.concurrency ?? 8));
const EMIT_JSON = Boolean(argv.json);

const { screenBreakoutMovers, screenBreakdownMovers } = await import(`${SRC}features/nighthawk/lib/candidates.ts`);
const {
  rankMoversForChainFetch,
  BREAKOUT_MAX_CANDIDATES,
  BREAKOUT_MAX_CANDIDATES_CEILING,
  BREAKOUT_SCREEN_POOL,
} = await import(`${SRC}lib/zerodte/breakout-discovery.ts`);
const { resolveBreakoutCandidateCap } = await import(`${SRC}lib/zerodte/breakout-cap.ts`);
const { breakoutScoreBreakdown } = await import(`${SRC}lib/zerodte/breakout-source.ts`);
const { computeIntradayRead } = await import(`${SRC}lib/zerodte/intraday.ts`);
const { attachThesisFirstLive } = await import(`${SRC}lib/zerodte/thesis/live-pipeline.ts`);
const { fetchDailyMarketSummary, fetchStockMinuteBars } = await import(`${SRC}lib/providers/polygon.ts`);
const { PLAN_RULES } = await import(`${SRC}lib/zerodte/plan.ts`);
const { etWallClockToUtcMs } = await import("./lib/swing-cadence-gap-eval.mjs");

const POLYGON_BASE = process.env.POLYGON_API_BASE;
const POLYGON_KEY = process.env.POLYGON_API_KEY;

const line = (c = "─", w = 112) => c.repeat(w);
const pct = (x) => (x == null ? "n/a" : `${(x * 100).toFixed(1)}%`);
const fmtPct = (n) => (n == null ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`);
const pad = (s, w) => String(s).padEnd(w);
const padL = (s, w) => String(s).padStart(w);
function etYmd(ms) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(ms));
}
const ymd = (d) => d.toISOString().slice(0, 10);
function utcMinOf(tMs) {
  const d = new Date(tMs);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

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

/** Real historical same-day-expiry ATM contract — nearest strike to spot AT the signal instant.
 *  Copied verbatim from zerodte-rvol-early-entry-unbiased-ab.mjs (no behavior change). */
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

/** Grades one mechanical entry under the UNCHANGED PLAN_RULES stop/target — real NBBO entry/exit,
 *  real option-bar walk, real $100-multiplier fee math. Copied verbatim from the RVOL unbiased
 *  A/B (including that script's fee-calc fix), except the time-stop anchor is upgraded here to
 *  the DST-safe etWallClockToUtcMs instead of a hardcoded UTC literal — a real improvement, not
 *  a behavior regression, since the sibling script's own hardcoded "T19:50:00Z" silently assumes
 *  EDT. */
async function gradeRealOption({ occ, direction, day, entryAtMs }) {
  const entryQuote = await fetchQuoteNear(occ, entryAtMs);
  if (!entryQuote || !(entryQuote.bid > 0) || !(entryQuote.ask > 0)) return { basis: "REAL_OPTION", outcome: "NO_QUOTE" };
  const entryPxRaw = direction === "long" ? entryQuote.ask : entryQuote.bid;
  const timeStopMs = etWallClockToUtcMs(day, 15 * 60 + 50); // 3:50pm ET — same 10min-before-close convention
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
  const dollarPnl = (exitPx - entryPxRaw) * 100 - 2 * FEE_PER_LEG; // entry + exit fee legs, in dollars
  const dollarCost = entryPxRaw * 100;
  const pnlPct = dollarCost > 0 ? (dollarPnl / dollarCost) * 100 : null;
  if (pnlPct == null) return { basis: "REAL_OPTION", outcome: "NO_QUOTE" };
  return {
    basis: "REAL_OPTION", entryPx: Math.round(entryPxRaw * 100) / 100, exitPx: Math.round(exitPx * 100) / 100,
    pnlPct: Math.round(pnlPct * 100) / 100, exitReason, outcome: pnlPct > 0 ? "WIN" : "LOSS",
  };
}

/** Underlying-continuation proxy fallback — used ONLY when no same-day contract is resolvable.
 *  Never blended with REAL_OPTION rows. Same favorable-first rule as the sibling tools. */
function gradeUnderlyingProxy(bars, direction, entryAtMs, closeMs) {
  const rth = bars
    .filter((b) => Number.isFinite(b.t) && b.t >= entryAtMs && b.t <= closeMs)
    .sort((a, b) => a.t - b.t);
  if (rth.length < 2) return { basis: "UNDERLYING_PROXY", outcome: "NO_BARS" };
  const entry = rth[0].c;
  if (!(entry > 0)) return { basis: "UNDERLYING_PROXY", outcome: "NO_BARS" };
  const favLevel = direction === "long" ? entry * (1 + FAV) : entry * (1 - FAV);
  const advLevel = direction === "long" ? entry * (1 - ADV) : entry * (1 + ADV);
  for (const b of rth) {
    const hitFav = direction === "long" ? b.h >= favLevel : b.l <= favLevel;
    const hitAdv = direction === "long" ? b.l <= advLevel : b.h >= advLevel;
    if (hitFav && !hitAdv) return { basis: "UNDERLYING_PROXY", outcome: "WIN", pnlPct: FAV * 100 };
    if (hitAdv) return { basis: "UNDERLYING_PROXY", outcome: "LOSS", pnlPct: -ADV * 100 };
  }
  return { basis: "UNDERLYING_PROXY", outcome: "LOSS", pnlPct: 0 };
}

/** Read up to (and including) the entry checkpoint — the "as of discovery" snapshot the real
 *  thesis pipeline scores. Copied from thesis-rank-reject-outcome-ab.mjs. */
function readAsOfEntry(bars, entryMs) {
  const upToEntry = bars.filter((b) => Number.isFinite(b.t) && b.t <= entryMs);
  return computeIntradayRead(upToEntry.map((b) => ({ t: b.t, h: b.h, l: b.l, c: b.c, v: b.v })));
}

const SCREEN_POOL = Math.max(BREAKOUT_MAX_CANDIDATES_CEILING * 4, BREAKOUT_SCREEN_POOL);

async function runSession(date, results) {
  const longMovers = screenBreakoutMovers(results, SCREEN_POOL);
  const shortMovers = screenBreakdownMovers(results, SCREEN_POOL);
  const qualifying = longMovers.length + shortMovers.length;
  if (qualifying === 0) return { date, error: "no qualifying breakouts/breakdowns" };

  const cap = resolveBreakoutCandidateCap({ qualifyingMovers: qualifying, floor: BREAKOUT_MAX_CANDIDATES, ceiling: BREAKOUT_MAX_CANDIDATES_CEILING });
  const perSide = Math.max(1, Math.floor(MAX_TICKERS_PER_DAY / 2));
  const rankedLong = rankMoversForChainFetch(longMovers, Math.min(cap, perSide), "long");
  const rankedShortAll = rankMoversForChainFetch(shortMovers, cap, "short");
  const longTickers = new Set(rankedLong.map((m) => m.ticker.toUpperCase()));
  const rankedShort = rankedShortAll.filter((m) => !longTickers.has(m.ticker.toUpperCase())).slice(0, perSide);

  const longMaxDollar = longMovers.reduce((m, x) => Math.max(m, x.dollar), 0);
  const shortMaxDollar = shortMovers.reduce((m, x) => Math.max(m, x.dollar), 0);
  const candidates = [
    ...rankedLong.map((m) => ({ mover: m, direction: "long", dollarNorm: longMaxDollar > 0 ? m.dollar / longMaxDollar : 0 })),
    ...rankedShort.map((m) => ({ mover: m, direction: "short", dollarNorm: shortMaxDollar > 0 ? m.dollar / shortMaxDollar : 0 })),
  ];
  if (candidates.length === 0) return { date, error: "no candidates survived rank/cap" };

  const entryMs = etWallClockToUtcMs(date, ENTRY_ET_MINUTES);
  const closeMs = etWallClockToUtcMs(date, 16 * 60);
  const entryAtMs = entryMs + ENTRY_DELAY_SEC * 1000;

  const built = await mapPool(candidates, async (cand) => {
    const bars = await fetchStockMinuteBars(cand.mover.ticker.toUpperCase(), date, date).catch(() => []);
    if (!bars.length) return null;
    const intraday = readAsOfEntry(bars, entryMs);
    if (intraday.last == null) return null;
    const { score } = breakoutScoreBreakdown(cand.mover, cand.dollarNorm, cand.direction);
    return { ticker: cand.mover.ticker.toUpperCase(), direction: cand.direction, score, intraday, bars };
  });
  const usable = built.filter(Boolean);
  if (usable.length === 0) return { date, error: "no candidate had a usable minute-bar read" };

  // Real thesis-first classification — same setup-construction approximation as
  // thesis-rank-reject-outcome-ab.mjs (see header); everything from here is the REAL,
  // unmodified attachThesisFirstLive.
  const setups = usable.map((u) => ({
    ticker: u.ticker, direction: u.direction, discovery_origin: ["BREAKOUT"], score: u.score,
    gross_premium: 0, prints: 0, underlying_price: u.intraday.last, intraday: u.intraday,
    rel_volume: null, key_resistances: [], key_supports: [], gamma_regime: null, rsi14: null,
    catalyst_flags: [], news_hot: null, earnings: null, flow_quality: null,
  }));
  attachThesisFirstLive(setups, ENTRY_ET_MINUTES, {}, undefined);

  // Point-in-time real-cost grading: ONE contract resolved at the signal instant's own spot,
  // same mechanical exit rule for every row regardless of rank_tier.
  const graded = await mapPool(usable, async (u, i) => {
    const s = setups[i];
    const rankTier = s.thesis_first?.rank_tier ?? null;
    const blocks = s.thesis_first?.archetype_gates?.blocks ?? [];
    const spot = u.intraday.last;
    const side = u.direction === "long" ? "call" : "put";
    const contract = await resolveAtmContract(u.ticker, spot, date, side);
    const leg = contract
      ? await gradeRealOption({ occ: contract.occ, direction: u.direction, day: date, entryAtMs })
      : gradeUnderlyingProxy(u.bars, u.direction, entryAtMs, closeMs);
    return { ticker: u.ticker, direction: u.direction, rank_tier: rankTier, blocks, leg };
  });

  return { date, qualifying_total: qualifying, cap, graded_count: graded.length, rows: graded };
}

console.log(line("═"));
console.log(`  THESIS_RANK_REJECT REAL-COST A/B — point-in-time contract, real NBBO, held-out split`);
console.log(`  days=${DAYS} · max/day=${MAX_TICKERS_PER_DAY} · entry ${String(argv.entry ?? "10:30")} ET (+${ENTRY_DELAY_SEC}s delay) · fee/leg $${FEE_PER_LEG}`);
console.log(line("═"));

console.log(`\n[1] Resolving ${DAYS} real trading session(s)…`);
const sessions = await resolveSessions(DAYS);
const splitIdx = Math.ceil(sessions.length / 2);
const trainSessions = sessions.slice(0, splitIdx);
const valSessions = sessions.slice(splitIdx);
console.log(`    ${sessions.length} session(s): ${sessions.map((s) => s.date).join(", ")}`);
console.log(`    TRAIN: ${trainSessions.map((s) => s.date).join(", ")}`);
console.log(`    VALIDATION (held out): ${valSessions.map((s) => s.date).join(", ")}`);

console.log(`\n[2] Running the REAL screen → cap/rank → thesis-first pipeline → real-cost grade, per session…`);
async function runAll(label, sessionsForHalf) {
  const out = [];
  for (const s of sessionsForHalf) {
    const r = await runSession(s.date, s.results);
    out.push(r);
    if (r.error) console.log(`    [${label}] ${s.date}: ${r.error}`);
    else console.log(`    [${label}] ${s.date}: qualifying=${r.qualifying_total} cap=${r.cap} graded=${r.graded_count}`);
  }
  return out.filter((r) => !r.error).flatMap((r) => r.rows);
}
const trainRows = await runAll("TRAIN", trainSessions);
const valRows = await runAll("VAL", valSessions);

function summarize(label, rows) {
  console.log(`\n${line()}`);
  console.log(`  ${label} — ${rows.length} candidates classified`);
  console.log(line());
  const rejectRows = rows.filter((r) => r.rank_tier === "REJECT");
  const passRows = rows.filter((r) => r.rank_tier !== "REJECT" && r.rank_tier != null);
  console.log(`  rank_tier: REJECT=${rejectRows.length}  PASS(non-REJECT)=${passRows.length}  unclassified=${rows.length - rejectRows.length - passRows.length}`);

  function statsFor(bucketRows, basis) {
    const graded = bucketRows.filter((r) => r.leg?.basis === basis && (r.leg.outcome === "WIN" || r.leg.outcome === "LOSS"));
    if (!graded.length) return null;
    const wins = graded.filter((r) => r.leg.outcome === "WIN");
    const losses = graded.filter((r) => r.leg.outcome === "LOSS");
    const winRate = wins.length / graded.length;
    const netExpectancy = graded.reduce((s, r) => s + r.leg.pnlPct, 0) / graded.length;
    const avgLoss = losses.length ? losses.reduce((s, r) => s + r.leg.pnlPct, 0) / losses.length : null;
    let running = 0, peak = 0, maxDd = 0;
    for (const r of graded) { running += r.leg.pnlPct; peak = Math.max(peak, running); maxDd = Math.min(maxDd, running - peak); }
    return { n: graded.length, winRate, netExpectancy, avgLoss, maxDd };
  }

  for (const basis of ["REAL_OPTION", "UNDERLYING_PROXY"]) {
    console.log(`\n  basis=${basis}`);
    const r = statsFor(rejectRows, basis);
    const p = statsFor(passRows, basis);
    console.log(`    ${pad("REJECT", 10)} n=${padL(r?.n ?? 0, 4)}  win_rate=${padL(pct(r?.winRate), 7)}  net_expectancy=${padL(r ? fmtPct(r.netExpectancy) : "—", 9)}  avg_loss=${padL(r?.avgLoss != null ? fmtPct(r.avgLoss) : "—", 9)}  max_dd=${padL(r ? fmtPct(r.maxDd) : "—", 9)}`);
    console.log(`    ${pad("PASS", 10)} n=${padL(p?.n ?? 0, 4)}  win_rate=${padL(pct(p?.winRate), 7)}  net_expectancy=${padL(p ? fmtPct(p.netExpectancy) : "—", 9)}  avg_loss=${padL(p?.avgLoss != null ? fmtPct(p.avgLoss) : "—", 9)}  max_dd=${padL(p ? fmtPct(p.maxDd) : "—", 9)}`);
  }

  // REJECT broken down by specific block code, momentum_abs_floor isolated per the member's
  // explicit focus on that sub-gate — underlying-proxy basis only (the real-option population is
  // too thin to split further; printed plainly rather than silently glossed over).
  if (rejectRows.length) {
    const byBlock = new Map();
    for (const r of rejectRows) for (const b of r.blocks) (byBlock.get(b) ?? byBlock.set(b, []).get(b)).push(r);
    console.log(`\n  REJECT by specific block code (basis=UNDERLYING_PROXY, underlying-proxy n only):`);
    for (const [code, blockRows] of [...byBlock.entries()].sort((a, b) => b[1].length - a[1].length)) {
      const s = statsFor(blockRows, "UNDERLYING_PROXY");
      console.log(`    ${pad(code, 26)}n=${padL(blockRows.length, 4)}  graded(proxy)=${padL(s?.n ?? 0, 4)}  win_rate=${padL(pct(s?.winRate), 7)}  net_expectancy=${padL(s ? fmtPct(s.netExpectancy) : "—", 9)}`);
    }
  }

  const rProxy = statsFor(rejectRows, "UNDERLYING_PROXY");
  const pProxy = statsFor(passRows, "UNDERLYING_PROXY");
  const MIN_N = 20;
  let verdict;
  if (rProxy && pProxy && rProxy.n >= MIN_N && pProxy.n >= MIN_N) {
    verdict = rProxy.netExpectancy <= pProxy.netExpectancy
      ? `REJECT net expectancy ${fmtPct(rProxy.netExpectancy)} <= PASS ${fmtPct(pProxy.netExpectancy)} — gate correctly separating on this basis.`
      : `⚠ REJECT net expectancy ${fmtPct(rProxy.netExpectancy)} > PASS ${fmtPct(pProxy.netExpectancy)} — the gate rejected setups that graded BETTER net of the same costs. Worth a closer look.`;
  } else {
    verdict = `INSUFFICIENT DATA at this basis — REJECT n=${rProxy?.n ?? 0}, PASS n=${pProxy?.n ?? 0} (need >=${MIN_N} each).`;
  }
  console.log(`\n  Verdict (underlying-proxy basis, net expectancy): ${verdict}`);
  return { rejectRows, passRows };
}

const trainSummary = summarize("TRAIN", trainRows);
const valSummary = summarize("VALIDATION — HELD OUT, UNSEEN", valRows);

console.log(`\n${line("═")}`);
console.log(`  No gate, filter, or exit rule changed by this run — evidence-gathering only.`);
console.log(`  Exit management (PLAN_RULES stop/target) held IDENTICAL for REJECT and PASS — this`);
console.log(`  isolates the GATE DECISION, not entry speed or exit management, as the variable`);
console.log(`  under test, per the member's instruction to preserve current exit management and`);
console.log(`  risk controls while testing this gate.`);
console.log(line("═"));

if (EMIT_JSON) {
  console.log("\n<<<JSON>>>");
  console.log(JSON.stringify({
    days_requested: DAYS, max_tickers_per_day: MAX_TICKERS_PER_DAY, entry: String(argv.entry ?? "10:30"),
    entry_delay_sec: ENTRY_DELAY_SEC, hold_minutes: HOLD_MINUTES, fee_per_leg: FEE_PER_LEG, fav: FAV,
    train: trainRows, validation: valRows,
  }, null, 2));
}
