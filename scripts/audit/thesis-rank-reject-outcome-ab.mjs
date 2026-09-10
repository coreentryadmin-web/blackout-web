/**
 * THESIS-RANK-REJECT OUTCOME A/B — is the thesis-first pipeline's `thesis_rank_reject` gate
 * (the BREAKOUT/PIN quality/rank floor, `src/lib/zerodte/thesis/live-pipeline.ts`) actually
 * rejecting the RIGHT setups?
 * ============================================================================================
 *
 * WHY THIS EXISTS (2026-09-09/10)
 * --------------------------------
 * `ZERODTE_THESIS_FIRST` is live in production. On 2026-09-09 `thesis_rank_reject` alone
 * accounted for 218/1,705 gate-blocked events that session — more than any single hard-gate
 * code — taking 121 detected tickers down to 8 commits. `zerodte-gate-compound-funnel.mjs`
 * (the existing joint-gate-compound harness) explicitly scopes to FLOW-origin setups and lists
 * "BREAKOUT/PIN origins" under its own "NOT MEASURED THIS RUN" section. Nobody had asked the
 * outcome question: does REJECTing these solo-BREAKOUT/PIN setups actually improve forward
 * results, or is the gate cutting winners along with losers? This tool answers it the same way
 * every other A/B harness in this repo does — real production decision code, real market data,
 * a favorable-first proxy grade, honest INSUFFICIENT DATA when the sample is too thin to trust.
 *
 * THE MECHANISM (read before trusting any number below)
 * -------------------------------------------------------
 * `thesis_rank_reject` fires whenever the thesis-first pipeline's `rank_tier` resolves to
 * `"REJECT"` (`resolveThesisRankTier`, live-pipeline.ts) — which happens ONLY when
 * `archetype_gates.verdict === "BLOCK"` (`evaluateArchetypeGates`, archetype-gates.ts). For a
 * BREAKOUT-origin setup that means `breakout_score_floor` (BREAKOUT rail score < 55, or < 48
 * under amplify-session relief); for the archetype a PIN fade classifies into
 * (`GAMMA_BREAK`, via the POSITIONING rail) it means `gamma_positioning_floor` (POSITIONING
 * rail score < 55). This is a QUALITY/RANK gate on top of discovery, not a discovery filter
 * itself — a setup only reaches this gate after its origin's own screen (`screenBreakoutMovers`/
 * `screenBreakdownMovers` for BREAKOUT, `evaluatePinRegime` for PIN) already qualified it.
 *
 * WHAT'S REAL vs. APPROXIMATED (same disclosure discipline as zerodte-gate-compound-funnel.mjs)
 * -----------------------------------------------------------------------------------------------
 * REAL (production code, no reimplementation):
 *   - screenBreakoutMovers / screenBreakdownMovers (features/nighthawk/lib/candidates.ts) — the
 *     REAL whole-market breakout/breakdown screen, fed REAL historical Polygon grouped-daily bars.
 *   - rankMoversForChainFetch (breakout-discovery.ts) — the REAL momentum-quality re-rank
 *     (gain-over-range) production applies before the chain-fetch cap.
 *   - resolveBreakoutCandidateCap (breakout-cap.ts) — the REAL dynamic-N cap formula
 *     (clamp(ceil(qualifying × 0.40), 40, 220) as of 2026-09-08).
 *   - breakoutScoreBreakdown (breakout-source.ts) — the REAL BREAKOUT board-score formula.
 *   - computeIntradayRead (intraday.ts) — the REAL VWAP/opening-range/trend read, fed REAL
 *     historical Polygon minute bars for that session.
 *   - attachThesisFirstLive (thesis/live-pipeline.ts) — the EXACT function scan.ts calls live:
 *     runs the real rail scoring (railHitsFromLegacySetup), real archetype classification
 *     (classifyTradeArchetype), the real per-archetype gates (evaluateArchetypeGates), and the
 *     real rank-tier resolver (resolveThesisRankTier) — nothing here is reimplemented.
 *   - discoverPinSetups (pin-discovery.ts) — the REAL, unmodified PIN discovery orchestration
 *     (live GEX heatmap + chain), attempted live (see PIN section below for why it is usually
 *     empty in this sandbox).
 *
 * REAL DATA, DIFFERENT SETUP-CONSTRUCTION PATH (disclosed, same precedent as
 * zerodte-gate-compound-funnel.mjs's UW-direct fetch and discovery-recall-probe.mjs's grouped-
 * daily replay): production's live BREAKOUT setups are built by `buildBreakoutSetup`, which
 * requires a live per-ticker OPTION CHAIN fetch (`resolveTickerChainRows`) to pick a contract —
 * that live chain-fetch IO orchestration (`discoverBreakoutSetups`) only runs inside the RTH
 * commit window [9:30, 15:30) ET, and this tool is built to also run OFF-HOURS (so it can
 * accumulate a multi-day sample instead of being pinned to one live session). So this tool
 * builds the setup object directly from the same real inputs `buildBreakoutSetup` would carry
 * (real score, real intraday read, real direction) MINUS the option-chain-dependent fields
 * (`key_resistances`/`key_supports`/`rel_volume` — production sets these to null for BREAKOUT-
 * origin setups too; see the code comment at the setup-builder below for the proof) and MINUS a
 * real contract (irrelevant here — grading is an underlying-continuation proxy, not option P&L,
 * same convention as discovery-recall-probe.mjs/merge-precedence-ab.mjs). Everything AFTER setup
 * construction — the actual `thesis_rank_reject` decision this tool measures — is 100% the real,
 * unmodified `attachThesisFirstLive` production function.
 *
 * GRADING (honest proxy, labeled as such, same convention as discovery-recall-probe.mjs): from
 * the entry bar (first minute bar at/after --entry ET), the underlying's favorable-first move —
 * long: HIGH reaches entry·(1+fav) before LOW reaches entry·(1−fav/2); short: mirrored — decides
 * WIN/LOSS. This is an underlying-continuation proxy (not exact option P&L), applied IDENTICALLY
 * to the REJECT and PASS buckets, so the comparison is apples-to-apples.
 *
 * NOT MEASURED THIS RUN (printed every run so a clean pass is never mistaken for exhaustive):
 *   - PIN population: TWO independent blockers, either one alone would be enough.
 *     (1) `discoverPinSetups` needs a LIVE GEX-heatmap snapshot (server-side UW product,
 *     cache-only) — there is no historical replay path for PIN from this sandbox (the same
 *     limitation `wall-temporal-stability.mjs` documents for GEX-wall snapshots generally).
 *     (2) measured 2026-09-10: importing `pin-discovery.ts` from a plain Node script throws
 *     "This module cannot be imported from a Client Component module" — a Next.js client/
 *     server module-boundary marker somewhere in `resolveTickerChainRows`'s dependency graph
 *     (the option-chain resolver PIN discovery shares with BREAKOUT discovery's live IO path).
 *     This tool still ATTEMPTS a live PIN discovery pass every run (real code, catches and
 *     reports the exact failure) so a future session with a different import path, or running
 *     from inside the app's own server graph, can pick this up — but as of this writing PIN has
 *     NO reachable measurement path from this sandbox at all, live or historical. Reported as
 *     INSUFFICIENT DATA, not a tool bug.
 *   - Cortex veto layer (evaluated after thesis-first in production) — not run here; this tool
 *     measures the thesis-first rank gate ONLY, not the full commit pipeline.
 *   - regime relief (amplify_floor_relief) — no live regime-plane state in this offline replay;
 *     always evaluated with relief OFF (the stricter of the two real floors), disclosed once
 *     here rather than per row.
 *   - resistance/support (PDH/PDL/GEX walls) — not fetched (see disclosure above); the BREAKOUT
 *     rail's structural_state (TRIGGERED/COILED) is decided from the REAL opening-range break
 *     alone. This can only make TRIGGERED harder to reach than in production (fewer paths to it),
 *     never easier — so this tool's REJECT rate is, if anything, a slight over-estimate.
 *
 * USAGE
 *   POLYGON_API_BASE=https://api.massive.com \
 *   env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY \
 *   node --import tsx scripts/audit/thesis-rank-reject-outcome-ab.mjs [options]
 *
 * OPTIONS
 *   --days=N          trading sessions to walk back and measure (default 8)
 *   --max-tickers=N   cap on BREAKOUT/BREAKDOWN candidates fed through the thesis pipeline PER
 *                     SESSION, combined both directions (default 50)
 *   --entry=HH:MM     ET entry checkpoint for BOTH the "as-of" intraday read fed to the thesis
 *                     pipeline AND the start of the forward grading window (default 10:30 — 30min
 *                     opening range + 30min to observe a genuine break, same convention as
 *                     discovery-recall-probe.mjs's --entry)
 *   --fav=N           favorable-first move threshold (default 0.015, matches sibling tools)
 *   --concurrency=N   parallel minute-bar fetches (default 10)
 *   --json            also print a machine-readable JSON block at the end
 *
 * Secrets from env only (POLYGON_API_KEY). Nothing written or committed. Read-only.
 */

const rawBase = process.env.POLYGON_API_BASE;
process.env.POLYGON_API_BASE = rawBase && /^https?:\/\//.test(rawBase) ? rawBase : "https://api.massive.com";
process.env.ZERODTE_THESIS_FIRST = "1"; // exercise the LIVE (not shadow-only) rank-tier → gate-block mapping

const SRC = new URL("../../src/", import.meta.url).pathname;

const argv = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    return m ? [m[1], m[2] ?? "true"] : [a, "true"];
  })
);
const DAYS = Math.max(1, Number(argv.days ?? 8));
const MAX_TICKERS_PER_DAY = Math.max(2, Number(argv["max-tickers"] ?? 50));
const FAV = Number(argv.fav ?? 0.015);
const ADV = FAV / 2;
const CONCURRENCY = Math.max(1, Number(argv.concurrency ?? 10));
const EMIT_JSON = Boolean(argv.json);
const [ENTRY_H, ENTRY_M] = String(argv.entry ?? "10:30").split(":").map(Number);
const ENTRY_ET_MINUTES = ENTRY_H * 60 + (ENTRY_M || 0);
const ET_OFFSET = -4; // EDT (summer/early-fall sessions) — see discovery-recall-probe.mjs's own note
const ENTRY_UTC_MIN = (ENTRY_H - ET_OFFSET) * 60 + (ENTRY_M || 0);
const CLOSE_UTC_MIN = (16 - ET_OFFSET) * 60; // 16:00 ET close

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

const pct = (x) => (x == null ? "n/a" : `${(x * 100).toFixed(1)}%`);
const pad = (s, w) => String(s).padEnd(w);
const padL = (s, w) => String(s).padStart(w);
const line = (c = "─", w = 100) => c.repeat(w);
function etMinutesOf(ms) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "numeric", hour12: false }).formatToParts(new Date(ms));
  return Number(parts.find((p) => p.type === "hour")?.value ?? 0) * 60 + Number(parts.find((p) => p.type === "minute")?.value ?? 0);
}
function etYmd(ms) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
}
const utcMinOf = (tMs) => {
  const d = new Date(tMs);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
};
const ymd = (d) => d.toISOString().slice(0, 10);

/** Walk back from today (calendar days) collecting the last `n` sessions with real grouped-daily
 *  data (skips weekends/holidays, same technique as discovery-recall-probe.mjs's resolveSessions,
 *  extended to collect N sessions instead of just the most recent one). Today's own session
 *  counts once the close has passed (grouped-daily for "today" is complete by then) — the walk
 *  doesn't special-case "today", it just skips any date whose grouped response is empty. */
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
  return out;
}

/** Favorable-first proxy, direction-aware (long: up first; short: down first). Mirrors
 *  discovery-recall-probe.mjs's gradeContinuation, generalized to both directions. */
function gradeContinuation(bars, direction) {
  const rth = bars
    .filter((b) => Number.isFinite(b.t) && Number.isFinite(b.h) && Number.isFinite(b.l) && Number.isFinite(b.c))
    .sort((a, b) => a.t - b.t)
    .filter((b) => utcMinOf(b.t) >= ENTRY_UTC_MIN && utcMinOf(b.t) <= CLOSE_UTC_MIN);
  if (rth.length < 2) return null;
  const entry = rth[0].c;
  if (!(entry > 0)) return null;
  const favLevel = direction === "long" ? entry * (1 + FAV) : entry * (1 - FAV);
  const advLevel = direction === "long" ? entry * (1 - ADV) : entry * (1 + ADV);
  let maxRet = 0;
  for (let i = 1; i < rth.length; i++) {
    const b = rth[i];
    maxRet = Math.max(maxRet, direction === "long" ? (b.h - entry) / entry : (entry - b.l) / entry);
    const hitFav = direction === "long" ? b.h >= favLevel : b.l <= favLevel;
    const hitAdv = direction === "long" ? b.l <= advLevel : b.h >= advLevel;
    if (hitFav && !hitAdv) return { win: true, maxRet, entry };
    if (hitAdv && !hitFav) return { win: false, maxRet, entry };
    if (hitFav && hitAdv) return { win: false, maxRet, entry }; // same-bar ambiguity → pessimistic
  }
  return { win: false, maxRet, entry }; // never reached favorable → time-stop loss
}

/** Read up to (and including) the entry checkpoint — this is the "as of discovery" snapshot the
 *  real thesis pipeline scores (BREAKOUT structural_state / MOMENTUM trend+VWAP). */
function readAsOfEntry(bars) {
  const upToEntry = bars.filter((b) => Number.isFinite(b.t) && utcMinOf(b.t) <= ENTRY_UTC_MIN);
  return computeIntradayRead(upToEntry.map((b) => ({ t: b.t, h: b.h, l: b.l, c: b.c, v: b.v })));
}

/** Bounded-concurrency worker pool (same pattern as discovery-recall-probe.mjs's gradeCohort). */
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
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length || 1) }, worker));
  return out;
}

const SCREEN_POOL = Math.max(BREAKOUT_MAX_CANDIDATES_CEILING * 4, BREAKOUT_SCREEN_POOL);

/** One session's measurement: real screen → real cap/rank → real per-ticker bars → real
 *  intraday read + real score → real thesis-first pipeline → real forward grade. */
async function runSession(date, results) {
  const longMovers = screenBreakoutMovers(results, SCREEN_POOL);
  const shortMovers = screenBreakdownMovers(results, SCREEN_POOL);
  const qualifying = longMovers.length + shortMovers.length;
  if (qualifying === 0) return { date, error: "no qualifying breakouts/breakdowns" };

  const cap = resolveBreakoutCandidateCap({
    qualifyingMovers: qualifying,
    floor: BREAKOUT_MAX_CANDIDATES,
    ceiling: BREAKOUT_MAX_CANDIDATES_CEILING,
  });
  // Split the per-day fetch budget across both sides so a session skewed heavily to one
  // direction doesn't starve the other; each side still respects the real production cap.
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

  // Real per-ticker minute bars → real "as of entry" intraday read + real forward grade,
  // fetched ONCE per ticker and reused for both purposes.
  const built = await mapPool(candidates, async (cand) => {
    const bars = await fetchStockMinuteBars(cand.mover.ticker.toUpperCase(), date, date).catch(() => []);
    if (!bars.length) return null;
    const intraday = readAsOfEntry(bars);
    if (intraday.last == null) return null; // no bars at/before entry — can't score a real read
    const grade = gradeContinuation(bars, cand.direction);
    if (!grade) return null; // no bars in the [entry, close] grading window
    const { score } = breakoutScoreBreakdown(cand.mover, cand.dollarNorm, cand.direction);
    return {
      ticker: cand.mover.ticker.toUpperCase(),
      direction: cand.direction,
      gain: cand.mover.gain,
      dollar: cand.mover.dollar,
      score,
      intraday,
      grade,
    };
  });
  const usable = built.filter(Boolean);
  if (usable.length === 0) return { date, error: "no candidate had a usable minute-bar read" };

  // Setup construction (disclosed approximation — see header): everything AFTER this point is
  // the REAL, unmodified thesis-first pipeline (attachThesisFirstLive).
  //
  // `key_resistances`/`key_supports`/`rel_volume` are left null/empty — NOT a shortcut taken for
  // this tool: production's own `buildBreakoutSetup` (breakout-source.ts) never sets them either
  // (no technicals dossier is passed for a BREAKOUT-origin setup; board.ts:1896 only populates
  // `rel_volume` from a dossier `enrichSetup` receives, and BREAKOUT calls `enrichSetup(base,
  // null)`). So a live BREAKOUT setup reaches the SAME thesis pipeline with the SAME nulls here —
  // this tool is not weaker than production on these fields, it matches it exactly.
  const setups = usable.map((u) => ({
    ticker: u.ticker,
    direction: u.direction,
    discovery_origin: ["BREAKOUT"],
    score: u.score,
    gross_premium: 0,
    prints: 0,
    underlying_price: u.intraday.last,
    intraday: u.intraday,
    rel_volume: null,
    key_resistances: [],
    key_supports: [],
    gamma_regime: null,
    rsi14: null,
    catalyst_flags: [],
    news_hot: null,
    earnings: null,
    flow_quality: null,
  }));
  attachThesisFirstLive(setups, ENTRY_ET_MINUTES, {}, undefined);

  const rows = setups.map((s, i) => ({
    ticker: s.ticker,
    direction: s.direction,
    archetype: s.thesis_first?.thesis?.trade_archetype ?? null,
    rank_tier: s.thesis_first?.rank_tier ?? null,
    blocks: s.thesis_first?.archetype_gates?.blocks ?? [],
    win: usable[i].grade.win,
    maxRet: usable[i].grade.maxRet,
  }));

  return {
    date,
    qualifying_long: longMovers.length,
    qualifying_short: shortMovers.length,
    qualifying_total: qualifying,
    cap,
    graded: rows.length,
    rows,
  };
}

console.log(line("═"));
console.log(`  THESIS-RANK-REJECT OUTCOME A/B — BREAKOUT/PIN population`);
console.log(`  ${DAYS} session(s) requested · up to ${MAX_TICKERS_PER_DAY} candidates/session · entry ${String(argv.entry ?? "10:30")} ET · fav ${pct(FAV)}`);
console.log(line("═"));

console.log(`\n[1] Resolving ${DAYS} real trading session(s) (walking back from today)…`);
const sessions = await resolveSessions(DAYS);
console.log(`    ${sessions.length} session(s) with real grouped-daily data: ${sessions.map((s) => s.date).join(", ")}`);

console.log(`\n[2] Running the REAL screen → cap/rank → thesis-first pipeline per session…`);
const results = [];
for (const s of sessions) {
  const r = await runSession(s.date, s.results);
  results.push(r);
  if (r.error) console.log(`    ${s.date}: ${r.error}`);
  else console.log(`    ${s.date}: qualifying=${r.qualifying_total} cap=${r.cap} graded=${r.graded}`);
}
const valid = results.filter((r) => !r.error);
const allRows = valid.flatMap((r) => r.rows);

// ── BREAKOUT/BREAKDOWN: REJECT vs PASS ──────────────────────────────────────────────
const rejectRows = allRows.filter((r) => r.rank_tier === "REJECT");
const passRows = allRows.filter((r) => r.rank_tier !== "REJECT" && r.rank_tier != null);
const rate = (arr) => (arr.length ? arr.filter((x) => x.win).length / arr.length : null);
const avg = (arr, f) => (arr.length ? arr.reduce((s, x) => s + f(x), 0) / arr.length : null);

console.log(`\n${line()}`);
console.log(`  BREAKOUT/BREAKDOWN POPULATION — ${allRows.length} graded across ${valid.length}/${sessions.length} usable session(s)`);
console.log(line());
console.log(`  rank_tier distribution: ${["A+", "A", "B", "WATCH", "REJECT"].map((t) => `${t}=${allRows.filter((r) => r.rank_tier === t).length}`).join("  ")}`);
console.log(`\n  ${pad("bucket", 24)}${padL("n", 6)}   ${padL("win_rate", 10)}   ${padL("avg_max_ret", 12)}`);
console.log(`  ${pad("REJECT (thesis_rank_reject)", 24)}${padL(rejectRows.length, 6)}   ${padL(pct(rate(rejectRows)), 10)}   ${padL(pct(avg(rejectRows, (x) => x.maxRet)), 12)}`);
console.log(`  ${pad("PASS (control, non-REJECT)", 24)}${padL(passRows.length, 6)}   ${padL(pct(rate(passRows)), 10)}   ${padL(pct(avg(passRows, (x) => x.maxRet)), 12)}`);

if (rejectRows.length > 0) {
  const blockCounts = new Map();
  for (const r of rejectRows) for (const b of r.blocks) blockCounts.set(b, (blockCounts.get(b) ?? 0) + 1);
  console.log(`\n  REJECT breakdown by specific archetype-gate block:`);
  for (const [code, n] of [...blockCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${pad(code, 32)}${padL(n, 5)} / ${rejectRows.length}`);
  }
}

let verdict = "INSUFFICIENT DATA";
const MIN_N = 20;
if (rejectRows.length >= MIN_N && passRows.length >= MIN_N) {
  const rr = rate(rejectRows);
  const pr = rate(passRows);
  verdict =
    rr <= pr
      ? `REJECT graded ${pct(rr)} vs PASS ${pct(pr)} — the gate is correctly separating (rejected setups graded no better, and often worse, than the control).`
      : `⚠ REJECT graded ${pct(rr)} vs PASS ${pct(pr)} — the gate REJECTED setups that graded BETTER than the ones it let through. Worth a closer look before trusting the gate as a quality floor for this population.`;
} else {
  verdict = `INSUFFICIENT DATA — REJECT n=${rejectRows.length}, PASS n=${passRows.length} (need ≥${MIN_N} each to trust a comparison). Re-run with more --days for a larger sample.`;
}
console.log(`\n  Verdict: ${verdict}`);

// ── PIN: live attempt only (see header — no offline replay path exists) ──────────────
console.log(`\n${line()}`);
console.log(`  PIN POPULATION — live attempt only (no historical replay path from this sandbox — see header)`);
console.log(line());
let pinReport = { attempted: true, error: null, setups: 0, rows: [] };
try {
  const { discoverPinSetups } = await import(`${SRC}lib/zerodte/pin-discovery.ts`);
  const nowMs = Date.now();
  const today = etYmd(nowMs);
  const nowEtMinutes = etMinutesOf(nowMs);
  console.log(`  attempting live discoverPinSetups (today=${today}, now=${String(Math.floor(nowEtMinutes / 60)).padStart(2, "0")}:${String(nowEtMinutes % 60).padStart(2, "0")} ET)…`);
  const pinSetups = await discoverPinSetups({ today, nowEtMinutes, excludeTickers: new Set() });
  pinReport.setups = pinSetups.length;
  if (pinSetups.length === 0) {
    console.log(`  0 live PIN setups this run (off-hours, or no clean pin regime right now) — INSUFFICIENT DATA for PIN this run.`);
    console.log(`  This is an EXPECTED, honest outcome — PIN discovery needs a live GEX-heatmap snapshot with no`);
    console.log(`  offline replay path (same limitation wall-temporal-stability.mjs documents). Re-run this tool`);
    console.log(`  during RTH (9:30-15:30 ET, or the condor-late window after) on a session with a clean pin regime.`);
  } else {
    attachThesisFirstLive(pinSetups, nowEtMinutes, {}, undefined);
    for (const s of pinSetups) {
      pinReport.rows.push({
        ticker: s.ticker,
        rank_tier: s.thesis_first?.rank_tier ?? null,
        archetype: s.thesis_first?.thesis?.trade_archetype ?? null,
        blocks: s.thesis_first?.archetype_gates?.blocks ?? [],
      });
    }
    console.log(`  ${pinSetups.length} live PIN setup(s) — rank_tier: ${pinReport.rows.map((r) => `${r.ticker}=${r.rank_tier}`).join(", ")}`);
    console.log(`  NOTE: this is a single live snapshot, not a graded outcome — a PIN A/B needs the same intraday`);
    console.log(`  poller precedent as wall-temporal-stability.mjs (gex-wall-snapshot-poll.mjs) run across a full`);
    console.log(`  RTH session before/after entry, which this one-shot tool run cannot do. Treat this section as`);
    console.log(`  proof the live code path works, not as outcome evidence.`);
  }
} catch (e) {
  pinReport.error = e instanceof Error ? e.message : String(e);
  const boundaryMarker = /Client Component|Server Component|server-only|client-only/.test(pinReport.error);
  console.log(`  PIN discovery attempt FAILED: ${pinReport.error}`);
  if (boundaryMarker) {
    console.log(`  This is a Next.js client/server MODULE-BOUNDARY marker somewhere in pin-discovery.ts's`);
    console.log(`  import chain (measured 2026-09-10: resolveTickerChainRows's own dependency graph), not a`);
    console.log(`  transient failure — importing pin-discovery.ts from a plain Node script trips it every`);
    console.log(`  time, live GEX snapshot or not. Combined with the live-only GEX-heatmap limitation already`);
    console.log(`  disclosed in the header, PIN has NO reachable measurement path from this sandbox at all`);
    console.log(`  right now — INSUFFICIENT DATA for PIN is the honest, permanent-for-this-sandbox answer,`);
    console.log(`  not a "re-run during RTH" caveat. A PIN measurement needs to run where pin-discovery.ts's`);
    console.log(`  full server graph already loads (e.g. inside the app itself, admin-gated) or a poller`);
    console.log(`  built the way wall-temporal-stability.mjs's gex-wall-snapshot-poll.mjs is: authenticating`);
    console.log(`  through the live app's own API route instead of importing the module directly.`);
  }
}

console.log(`\n${line("═")}`);
console.log(`  SUMMARY: BREAKOUT/BREAKDOWN REJECT n=${rejectRows.length} (WR ${pct(rate(rejectRows))}) vs PASS n=${passRows.length} (WR ${pct(rate(passRows))})`);
console.log(`  PIN: ${pinReport.error ? "error" : pinReport.setups > 0 ? `${pinReport.setups} live setup(s), see above` : "0 live setups this run (INSUFFICIENT DATA — expected off-hours)"}`);
console.log(line("═"));

if (EMIT_JSON) {
  console.log("\n<<<JSON>>>");
  console.log(JSON.stringify({
    days_requested: DAYS,
    max_tickers_per_day: MAX_TICKERS_PER_DAY,
    entry: String(argv.entry ?? "10:30"),
    fav: FAV,
    sessions: results,
    breakout: {
      total_graded: allRows.length,
      rank_tier_distribution: Object.fromEntries(["A+", "A", "B", "WATCH", "REJECT"].map((t) => [t, allRows.filter((r) => r.rank_tier === t).length])),
      reject: { n: rejectRows.length, win_rate: rate(rejectRows), avg_max_ret: avg(rejectRows, (x) => x.maxRet) },
      pass: { n: passRows.length, win_rate: rate(passRows), avg_max_ret: avg(passRows, (x) => x.maxRet) },
      verdict,
    },
    pin: pinReport,
  }, null, 2));
}
