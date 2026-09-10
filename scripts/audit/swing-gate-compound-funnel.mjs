/**
 * SWING GATE-COMPOUND FUNNEL — the swing-side sibling of `zerodte-gate-compound-funnel.mjs`.
 * ============================================================================================
 *
 * WHY THIS EXISTS (2026-09-09/10, operator directive)
 * ----------------------------------------------------
 * Two PRs shipped THIS session on the SAME operator complaint about low swing play counts —
 * `docs/audit/findings-staging/2026-09-08-swing-discovery-pool-gates-loosened.md` (raised the
 * dynamic Tier-1 cap ceiling/pool-pct, `maxStructureMovers`, the Vector-leader fetch limit, and
 * BREAKOUT_MIN_VOLUME/GAIN) and `...swing-persistence-loosened-standard-archetypes.md` (fast-
 * tracked 5 archetypes to a 1-session persistence floor). Both loosened a real gate on separate
 * evidence, but — same gap the 0DTE gate-compound-funnel was built to close — nobody had ever
 * measured swing's own JOINT commit-gate pass rate, before OR after. `v2/gates.ts` ships only 5
 * ACTIVE commit gates (G-S3 earnings, G-S4 regime, G-S6 confluence, G-S12 halt, G-S14 Cortex —
 * see the file's own header), a much smaller stack than 0DTE's ~20, but the same compounding
 * question applies: a setup must clear ALL of them at once, and "each gate looks reasonable in
 * isolation" says nothing about the joint rate.
 *
 * This script answers two DISTINCT questions, both against REAL production functions and REAL
 * live/recent data:
 *   (1) POOL SIZE — did the 2026-09-08 discovery-pool loosening actually widen the number of
 *       names that reach Tier-1 scoring, on TODAY'S real merged Tier-0 pool? Reruns the real,
 *       parameterized `resolveSwingTier1Cap` and `screenBreakoutMovers`-equivalent thresholds
 *       under both the CURRENT (loosened) config and the PRE-2026-09-08 config, side by side, on
 *       the same underlying data — this part IS a genuine, reconstructable before/after (the
 *       affected constants are either function parameters or env-overridable).
 *   (2) GATE JOINT PASS RATE — of the names that reach Tier-1 (post-cap), what fraction clears
 *       G-S3+G-S4+G-S6 (the 3 gates this harness can feed with REAL data — see APPROXIMATED
 *       below) all at once, isolated failure rate per gate, same "isolated vs joint" distinction
 *       the 0DTE tool draws. The 5 commit gates in gates.ts were NOT touched by either 2026-09-08
 *       loosening PR — there is no "before" state for them to diff against — so this half is a
 *       FRESH BASELINE ONLY, not a before/after, and is reported as such.
 *
 * A THIRD FINDING fell out of building (1), disclosed prominently rather than silently fixed:
 * `swingCorroboratedFlowMinPremium()`/`swingLegacyFlowMinPremium()` (v2/config.ts) — the two FLOW
 * premium floors the first loosening finding claims it lowered ($150k→$100k / $250k→$175k) — are
 * NEVER READ anywhere in the pipeline (confirmed: zero call sites outside their own definitions,
 * repo-wide grep). Worse, even if wired in literally as named, they would be STRUCTURALLY INERT:
 * `flowAccumulationByTicker`'s own `DIRECTION_MIN_NET_PREMIUM = 250_000` (nighthawk/flow-
 * accumulation.ts, shared with 0DTE/Vector/Helix) already classifies any ticker below $250k net
 * signed premium as "neutral" (no side to trade) BEFORE either swing floor would ever see it — so
 * every ticker that reaches `flowTickersDirectional` already clears $250k, which trivially clears
 * both the $175k and $100k floors. Wiring the two functions in as literally named would add real
 * lines of code that can never once fire in production, which is worse than leaving them dead:
 * it would read as "fixed" while changing nothing. The real fix needs the shared, cross-engine
 * `DIRECTION_MIN_NET_PREMIUM` to become configurable per caller — out of scope for a wire-up,
 * given it is read by 0DTE and Vector too. NOT fixed here; flagged plainly instead of forcing a
 * fake result (see the PR body / research doc for the full trace).
 *
 * WHAT'S REAL vs. APPROXIMATED (same honesty discipline as zerodte-gate-compound-funnel.mjs)
 * ---------------------------------------------------------------------------
 * REAL (production code, no reimplementation):
 *   - accumulationSignalsFromFlow (zerodte/flow-accumulation-context.ts, shared with 0DTE) — the
 *     real multi-day FLOW accumulation engine, fed REAL UW flow-alerts (direct REST, same
 *     disclosed swap as the 0DTE tool: production reads a Postgres mirror of this same feed).
 *   - screenBreakoutMovers (nighthawk/lib/candidates.ts) — the real whole-market STRUCTURE
 *     screen, fed REAL Polygon grouped-daily bars.
 *   - mergeTierZeroScreens / rankTierZeroSeeds (swing/discovery.ts) — the real, pure Tier-0
 *     merge + rank.
 *   - resolveSwingTier1Cap (swing/v2/tier1-cap.ts) — the real, pure dynamic Tier-1 cap resolver,
 *     run under both the current env and an explicit pre-loosening env override.
 *   - classifyArchetype (swing/archetype.ts) — the real, pure single-winner archetype classifier,
 *     fed the subset of signal clusters this harness can ground (below).
 *   - regimeFromSpyTrend / emaStackFromCloses (swing/swing-ingest.ts), trendStackScore /
 *     accumulationPersistence (horizon-scorers.ts) — the real SPY-trend regime read and the real
 *     trend-stack / persistence math, fed REAL Polygon daily bars.
 *   - deriveCatalystReads / parseEarningsWindows (swing/swing-catalyst.ts) — the real earnings-
 *     window grounding, fed REAL UW per-ticker earnings history.
 *   - evaluateEarningsGate / evaluateRegimeGate / evaluateConfluenceGate (swing/v2/gates.ts) —
 *     the REAL, unmodified G-S3/G-S4/G-S6 gate functions. Every verdict this script reports is a
 *     real gate function's real return value, not a guess about what it would do.
 *
 * REAL DATA, DIFFERENT FETCH PATH (disclosed, mirrors the 0DTE tool's own precedent): production
 * reads its FLOW candidates from a Postgres mirror (`fetchRecentFlows`) of the same UW flow-alerts
 * feed this script queries directly via REST. Same alerts, different pipe.
 *
 * APPROXIMATED / NOT EXERCISED (explicitly, so a clean run is never mistaken for "every gate
 * measured") — these gates depend on state this offline harness cannot read:
 *   - G-S12 halt/LULD: NOT evaluated at all. `evaluateHaltGate` reads a live UW+LULD halt-feed
 *     cluster read (`readSwingHaltStateForTickers`, v2/halt-read.ts) that warms itself from a
 *     live Redis cluster-freshness key this sandbox cannot reach (same class of block as direct
 *     Postgres/Redis TCP — see CLAUDE.md "Environment realities"). Assumed CLEAR (no halt, feed
 *     fresh) — biases the joint rate UP (a real halt/stale feed can only add a block this run
 *     never sees).
 *   - G-S14 Cortex: NOT evaluated at all, same discipline as the 0DTE tool's own explicit
 *     non-measurement of ITS Cortex veto layer ("evaluated AFTER these hard gates in production,
 *     not run here at all") — `evaluateSwingCortexForCommit` fans out to `fetchVectorFullState`
 *     (gex-walls/wall-trend/darkpool-confluence/catalyst-news), a heavy multi-source read that is
 *     its own separate pass, not this funnel's subject. Same UP bias as G-S12.
 *   - Only FLOW + STRUCTURE Tier-0 origins are fetched (POSITIONING/CATALYST/BANGER/VECTOR are
 *     not) — this biases G-S6 confluence the OPPOSITE direction, DOWN: every candidate here
 *     carries fewer independent discoveryPaths kinds than production's real merge would, so a
 *     name that would clear G-S6 live (via a POSITIONING/VECTOR/BANGER kind this run never
 *     fetches) can read as a G-S6 failure here. NET EFFECT ON THE JOINT NUMBER IS MIXED, not a
 *     one-directional bound — this run does not resolve which force dominates. Report this
 *     honestly as "at least this much compounding," never collapse it into "optimistic upper
 *     bound" the way the 0DTE tool could (0DTE's own approximations were all one-directional).
 *   - Archetype classification here is LOWER-FIDELITY than production's `buildSwingDossier`: only
 *     3 of the ~8 signal clusters `classifyArchetype` can use are grounded (accumPersistence01
 *     from the real FLOW signal, trendStack01 from the real SPY/name EMA stack, catalystInWindow01
 *     from real UW earnings) — BREAKOUT quality/volume-expansion, MEAN_REVERSION oversold,
 *     FAILED_BREAKDOWN reclaim, SECTOR_ROTATION leadership, and POST_EARNINGS_DRIFT gap/drift stay
 *     null (never fabricated). This biases the archetype mix toward FLOW_ACCUMULATION/
 *     PULLBACK_CONTINUATION/EVENT_DRIVEN/unclassified relative to live production, which in turn
 *     affects G-S6's required-kinds count (2 for event archetypes, else 3) and G-S3's intended-DTE
 *     window. Disclosed rather than hidden; the 3 REAL gate FUNCTIONS are never approximated —
 *     only some of their INPUTS are lower-fidelity than production's fuller dossier.
 *   - STRUCTURE-only names (no FLOW signal) are assigned direction LONG (screenBreakoutMovers only
 *     ever screens upward closes) — production's own dossier direction resolution is more nuanced;
 *     this is a disclosed simplification, not a hidden one.
 *   - Only FLOW + STRUCTURE Tier-0 origins are measured (mirrors the 0DTE tool's own "FLOW-origin
 *     setups only" scope note). POSITIONING/CATALYST/BANGER/VECTOR origins are real production
 *     Tier-0 paths this harness does not fetch — a real name that ONLY those origins would have
 *     surfaced is invisible to this run, same recall caveat the 0DTE tool states for BREAKOUT/PIN.
 *
 * USAGE
 *   POLYGON_API_BASE=https://api.massive.com \
 *   env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY \
 *   node --import tsx scripts/audit/swing-gate-compound-funnel.mjs [options]
 *
 * OPTIONS
 *   --days=N          multi-day FLOW lookback (default 5 — matches swing's 120h flowWindowHours)
 *   --min-premium=N   min alert premium for the raw UW fetch (default 250000 — matches the ACTUAL
 *                     live floor, `MULTI_DAY_MIN_PREMIUM`; NOT the aspirational, dead
 *                     swingLegacyFlowMinPremium/swingCorroboratedFlowMinPremium values — see the
 *                     header finding above)
 *   --max-tickers=N   HARNESS-ONLY budget cap on how many Tier-1 names get a per-name earnings +
 *                     daily-bars fetch in THIS run (default 50) — separate from, and typically
 *                     smaller than, production's own real dynamic Tier-1 cap (which can run to
 *                     300); when the real cap is larger than this budget, the report says so.
 *   --json            also print a machine-readable JSON block at the end
 *
 * Secrets come from env only (UW_API_KEY, POLYGON_API_KEY). Nothing is written or committed.
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
const DAYS = Math.max(1, Number(argv.days ?? 5));
const MIN_PREMIUM = Math.max(0, Number(argv["min-premium"] ?? 250_000));
const MAX_TICKERS = Math.max(1, Number(argv["max-tickers"] ?? 50));
const EMIT_JSON = Boolean(argv.json);
const ENRICH_CONCURRENCY = 8;

const { fetchMarketFlowAlertRows } = await import(`${SRC}lib/providers/unusual-whales.ts`);
const { extractChainFieldsFromRaw } = await import(`${SRC}lib/flow-raw-fields.ts`);
const { dteFromExpiry } = await import(`${SRC}lib/flow-dte.ts`);
const { accumulationSignalsFromFlow } = await import(`${SRC}lib/zerodte/flow-accumulation-context.ts`);
const {
  screenBreakoutMovers,
  isExcludedInstrument,
  BREAKOUT_MIN_VOLUME,
  BREAKOUT_MIN_GAIN,
  BREAKOUT_MIN_CLOSE_STRENGTH,
  BREAKOUT_MIN_PRICE,
  BREAKOUT_MAX_PRICE,
} = await import(`${SRC}features/nighthawk/lib/candidates.ts`);
const {
  mergeTierZeroScreens,
  rankTierZeroSeeds,
  ARCHETYPE_INTENDED_DTE,
  DEFAULT_SWING_DISCOVERY_CONFIG,
} = await import(`${SRC}lib/swing/discovery.ts`);
const { resolveSwingTier1Cap } = await import(`${SRC}lib/swing/v2/tier1-cap.ts`);
const { evaluateEarningsGate, evaluateRegimeGate, evaluateConfluenceGate } = await import(
  `${SRC}lib/swing/v2/gates.ts`
);
const { classifyArchetype } = await import(`${SRC}lib/swing/archetype.ts`);
const { deriveCatalystReads, parseEarningsWindows } = await import(`${SRC}lib/swing/swing-catalyst.ts`);
const { regimeFromSpyTrend, emaStackFromCloses } = await import(`${SRC}lib/swing/swing-ingest.ts`);
const { trendStackScore, accumulationPersistence } = await import(`${SRC}lib/horizon-scorers.ts`);
const { fetchStockDailyBars, fetchDailyMarketSummary } = await import(`${SRC}lib/providers/polygon.ts`);
const { fetchUwTickerEarningsHistory } = await import(`${SRC}lib/providers/unusual-whales.ts`);

const fmtUsd = (n) =>
  n == null ? "—" : n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(0)}k` : `$${n.toFixed(0)}`;
const pad = (s, w) => String(s).padEnd(w);
const padL = (s, w) => String(s).padStart(w);
const line = (c = "─", w = 100) => c.repeat(w);
function etYmd(ms) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
}

/** Paginate UW flow-alerts backward via `older_than` until the window is covered (identical shape
 *  to the 0DTE gate-compound-funnel's own fetcher — same feed, same pagination contract). */
async function fetchMultiDayFlow(endMs, days, minPremium) {
  const cutoffMs = endMs - days * 86_400_000;
  const rows = [];
  const seen = new Set();
  let olderThan = new Date(endMs).toISOString();
  const MAX_PAGES = 16;
  for (let page = 0; page < MAX_PAGES; page++) {
    let batch;
    try {
      batch = await fetchMarketFlowAlertRows({ limit: 200, min_premium: minPremium, older_than: olderThan });
    } catch (e) {
      console.warn(`  [flow] page ${page + 1} failed: ${e instanceof Error ? e.message : e}`);
      break;
    }
    if (!batch?.length) break;
    let oldestIso = null;
    let oldestMs = Infinity;
    for (const mr of batch) {
      const iso = mr.flow?.alerted_at;
      const ms = Date.parse(iso ?? "");
      if (Number.isFinite(ms) && ms < oldestMs) { oldestMs = ms; oldestIso = iso; }
      const key = `${mr.flow?.ticker}|${mr.flow?.expiry}|${mr.flow?.strike}|${mr.flow?.option_type}|${mr.flow?.alerted_at}|${mr.flow?.premium}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const alertMs = Date.parse(mr.flow?.alerted_at ?? "");
      if (Number.isFinite(alertMs) && alertMs >= cutoffMs && alertMs <= endMs) rows.push(mr);
    }
    if (!oldestIso || oldestMs === Infinity) break;
    if (oldestMs < cutoffMs) break;
    if (oldestIso === olderThan) break;
    olderThan = oldestIso;
  }
  return rows;
}

/** Bounded-concurrency map — preserves input order. */
async function mapPool(items, concurrency, fn) {
  if (items.length === 0) return [];
  const out = new Array(items.length);
  let next = 0;
  const workers = Math.max(1, Math.min(concurrency, items.length));
  const worker = async () => {
    for (;;) {
      const idx = next++;
      if (idx >= items.length) return;
      out[idx] = await fn(items[idx], idx);
    }
  };
  // Array.from's mapFn receives (element, index); worker() ignores both (arity 0) since it
  // tracks progress via the closed-over `next` counter, not the array position — the extra
  // args are CodeQL's "superfluous trailing arguments" finding. Wrapped as () => worker() to
  // make the discard explicit; behavior unchanged.
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return out;
}

/** Mirror of screenBreakoutMovers's real filter logic, but with the PRE-2026-09-08 thresholds
 *  (1M volume / 3% gain) instead of the live, loosened ones (750k / 2%) — screenBreakoutMovers's
 *  floors are compile-time module constants, not parameters, so the only way to reconstruct the
 *  "before" pool on the SAME live grouped-daily data is a disclosed, side-by-side reimplementation
 *  of its exact predicate. BREAKOUT_MIN_CLOSE_STRENGTH and the price band are UNCHANGED by the
 *  loosening PR, so those are read from the real module (not duplicated as a second literal). */
const OLD_BREAKOUT_MIN_VOLUME = 1_000_000;
const OLD_BREAKOUT_MIN_GAIN = 0.03;
function screenBreakoutMoversOld(results, maxKeep) {
  const out = [];
  for (const r of results) {
    const ticker = String(r.T ?? "").toUpperCase();
    if (!ticker || ticker.includes(".") || isExcludedInstrument(ticker)) continue;
    const c = Number(r.c), o = Number(r.o), h = Number(r.h), l = Number(r.l), v = Number(r.v);
    if (!(c >= BREAKOUT_MIN_PRICE && c <= BREAKOUT_MAX_PRICE) || !(v >= OLD_BREAKOUT_MIN_VOLUME)) continue;
    if (!(o > 0) || (c - o) / o < OLD_BREAKOUT_MIN_GAIN) continue;
    const range = h - l;
    const closeStrength = range > 0 ? (c - l) / range : 0;
    if (closeStrength < BREAKOUT_MIN_CLOSE_STRENGTH) continue;
    out.push({ ticker, gain: (c - o) / o, volume: v, close_strength: closeStrength, dollar: v * c, bar: { h, l, o } });
  }
  return out.sort((a, b) => b.dollar - a.dollar).slice(0, maxKeep);
}

// ── MAIN ─────────────────────────────────────────────────────────────────────────
const nowMs = Date.now();
const today = etYmd(nowMs);

console.log(line("═"));
console.log(`  SWING GATE-COMPOUND FUNNEL — as-of ${today}`);
console.log(`  flow window ${DAYS}d · raw fetch floor ${fmtUsd(MIN_PREMIUM)} · harness gate-eval budget ${MAX_TICKERS} tickers`);
console.log(line("═"));

// 1) MULTI-DAY FLOW (real UW feed, real REST path — see header disclosure)
console.log(`\n[1] Fetching multi-day UW flow (${DAYS}d back, min ${fmtUsd(MIN_PREMIUM)})…`);
const mrows = await fetchMultiDayFlow(nowMs, DAYS, MIN_PREMIUM);
console.log(`    ${mrows.length} raw alerts fetched`);
if (!mrows.length) {
  console.log("\n  No flow in window (off-hours + empty cache, or UW unreachable). Nothing to measure.");
  process.exit(0);
}

// 2) MAP → MinimalFlowRow, recovering ask_pct the same way production's SQL ingestion does.
const flowRows = [];
for (const mr of mrows) {
  const f = mr.flow;
  const raw = mr.raw ?? {};
  if (!f?.ticker || !f.option_type || f.option_type === "UNKNOWN") continue;
  const chain = extractChainFieldsFromRaw(raw, { strike: f.strike, option_type: f.option_type });
  flowRows.push({
    ticker: f.ticker,
    premium: f.premium,
    option_type: f.option_type,
    strike: f.strike,
    expiry: f.expiry,
    dte: f.expiry ? dteFromExpiry(f.expiry) ?? undefined : undefined,
    alert_rule: chain.alert_rule ?? f.alert_rule ?? undefined,
    ask_pct: chain.ask_pct,
    open_interest: chain.open_interest,
    alerted_at: f.alerted_at,
  });
}
console.log(`    ${flowRows.length} usable directional rows after CALL/PUT parse`);

// 3) REAL FLOW accumulation engine (accumulationSignalsFromFlow — shared with 0DTE).
const accSignals = accumulationSignalsFromFlow(flowRows, nowMs);
const flowTickersDirectional = [];
for (const [ticker, sig] of accSignals) {
  if (sig.direction !== "neutral") flowTickersDirectional.push(ticker);
}
console.log(`\n[2] FLOW screen: ${accSignals.size} tickers accumulated, ${flowTickersDirectional.length} directional (non-neutral)`);

// 4) REAL STRUCTURE screen (screenBreakoutMovers over real Polygon grouped-daily) — NEW (live)
//    thresholds vs the OLD (pre-2026-09-08) reimplementation, same data.
console.log(`\n[3] Fetching grouped-daily for the STRUCTURE screen…`);
const summary = await fetchDailyMarketSummary(today).catch(() => ({ results: [] }));
const grouped = summary?.results ?? [];
console.log(`    ${grouped.length} grouped-daily rows`);
const moversNew = screenBreakoutMovers(grouped, DEFAULT_SWING_DISCOVERY_CONFIG.maxStructureMovers);
const moversOld = screenBreakoutMoversOld(grouped, 40); // 40 = pre-2026-09-08 maxStructureMovers
console.log(`    STRUCTURE movers — NEW (${fmtUsd(BREAKOUT_MIN_VOLUME)}/${(BREAKOUT_MIN_GAIN * 100).toFixed(0)}%, cap ${DEFAULT_SWING_DISCOVERY_CONFIG.maxStructureMovers}): ${moversNew.length}   OLD (${fmtUsd(OLD_BREAKOUT_MIN_VOLUME)}/${(OLD_BREAKOUT_MIN_GAIN * 100).toFixed(0)}%, cap 40): ${moversOld.length}`);
const moverByTicker = new Map(moversNew.map((m) => [m.ticker.toUpperCase(), m]));

// 5) MERGE (real, pure) — NEW vs OLD structure pool, same FLOW pool both times (the FLOW-side
//    premium floors were never actually wired either before or after — see header finding — so
//    the FLOW half of the merge is identical in both eras; only STRUCTURE differs here).
const mergedNew = mergeTierZeroScreens(flowTickersDirectional, moversNew.map((m) => m.ticker));
const mergedOld = mergeTierZeroScreens(flowTickersDirectional, moversOld.map((m) => m.ticker));

// 6) REAL dynamic Tier-1 cap — CURRENT env (loosened 2026-09-08: ceiling 300, pool-pct 0.45) vs an
//    EXPLICIT pre-loosening override (ceiling 200, pool-pct 0.35) — resolveSwingTier1Cap is pure
//    and env-parameterized, so this is a genuine, reconstructable before/after, not a guess.
const capNew = resolveSwingTier1Cap(mergedNew.length, 40, process.env);
const oldEnv = {
  ...process.env,
  SWING_TIER1_CAP_MAX: "200",
  SWING_TIER1_CAP_CEILING: "200",
  SWING_TIER1_CAP_POOL_PCT: "0.35",
};
const capOld = resolveSwingTier1Cap(mergedOld.length, 40, oldEnv);

console.log(`\n${line()}`);
console.log(`  POOL-SIZE BEFORE/AFTER — the 2026-09-08 discovery-pool loosening, measured on TODAY'S real Tier-0 pool`);
console.log(line());
const row2 = (label, oldV, newV) => console.log(`    ${pad(label, 44)}OLD ${padL(oldV, 6)}    NEW ${padL(newV, 6)}    Δ ${padL(newV - oldV >= 0 ? `+${newV - oldV}` : `${newV - oldV}`, 6)}`);
row2("STRUCTURE movers", moversOld.length, moversNew.length);
row2("Tier-0 merged (FLOW ∪ STRUCTURE)", mergedOld.length, mergedNew.length);
row2("Tier-1 cap resolved", capOld.cap, capNew.cap);
console.log(`    Tier-1 cap detail — OLD: ceiling=${capOld.ceiling} poolPct=${capOld.poolPct} dynamic=${capOld.dynamic}   NEW: ceiling=${capNew.ceiling} poolPct=${capNew.poolPct} dynamic=${capNew.dynamic}`);
console.log(`    FLOW tickers (directional): ${flowTickersDirectional.length} — IDENTICAL in both eras (the FLOW-side premium`);
console.log(`      floors this loosening claimed to touch, swingCorroboratedFlowMinPremium/swingLegacyFlowMinPremium, are`);
console.log(`      never read by the pipeline — see the header finding and the PR body).`);

// 7) TIER-1 pool for gate evaluation: production's REAL cap, further bounded by this harness's own
//    fetch budget (--max-tickers) since each candidate below costs a live earnings + daily-bars fetch.
const rankedFull = rankTierZeroSeeds(mergedNew, accSignals, moverByTicker);
const tier1Pool = rankedFull.slice(0, capNew.cap);
const gateEvalPool = tier1Pool.slice(0, MAX_TICKERS);
console.log(`\n[4] Tier-1 pool (real dynamic cap): ${tier1Pool.length} names. Gate-eval harness budget: ${gateEvalPool.length}${tier1Pool.length > gateEvalPool.length ? ` (production's real cap is LARGER than this harness's per-run fetch budget — raise --max-tickers for full coverage)` : ""}`);
if (!gateEvalPool.length) {
  console.log("\n  No Tier-1 candidates this cycle. Funnel ends here.");
  process.exit(0);
}

// 8) Per-candidate: real daily bars (name + shared SPY), real earnings, real archetype classify,
//    real regime, real confluence — then the REAL G-S3/G-S4/G-S6 gate functions.
console.log(`\n[5] Fetching daily bars + earnings for ${gateEvalPool.length} candidates (concurrency ${ENRICH_CONCURRENCY})…`);
const toYmd = today;
const fromYmd = new Date(nowMs - 200 * 86_400_000).toISOString().slice(0, 10);
const spyBars = await fetchStockDailyBars("SPY", fromYmd, toYmd).catch(() => []);
const spyCloses = (spyBars ?? []).map((b) => b.c).filter((c) => Number.isFinite(c));

const results = await mapPool(gateEvalPool, ENRICH_CONCURRENCY, async (seed) => {
  const ticker = seed.ticker;
  const sig = accSignals.get(ticker) ?? null;
  const direction = sig?.direction === "bull" ? "LONG" : sig?.direction === "bear" ? "SHORT" : "LONG"; // STRUCTURE-only default LONG — see header disclosure

  const nameBars = await fetchStockDailyBars(ticker, fromYmd, toYmd).catch(() => []);
  const nameCloses = (nameBars ?? []).map((b) => b.c).filter((c) => Number.isFinite(c));
  const stack = emaStackFromCloses(nameCloses);
  const hasStack = stack.priceAboveEma20 != null || stack.ema20AboveEma50 != null || stack.ema50Rising != null;
  const bullTrend = hasStack ? trendStackScore(stack) : null;
  const trendStack01 = bullTrend == null ? null : direction === "SHORT" ? 1 - bullTrend : bullTrend;

  const accumPersistence01 = sig ? accumulationPersistence(sig.magnet?.days ?? 0, DAYS) : null;

  const earningsRows = await fetchUwTickerEarningsHistory(ticker).catch(() => []);
  const earningsWindows = parseEarningsWindows(earningsRows, nowMs);

  // Pass 1 at the STANDARD (14d) intended DTE — mirrors finalizeSwingDossierForArchetype's own
  // two-pass realignment: classify first, then re-derive catalyst reads at the ARCHETYPE's real
  // intended DTE (event archetypes trade a 5d window, not 14d).
  const catalystPass1 = deriveCatalystReads({
    intendedDte: DEFAULT_SWING_DISCOVERY_CONFIG.intendedDte,
    signedReturnPct10d: null,
    freshCatalystAgeDays: null,
    earnings: earningsWindows,
  });

  const archetypeInputs = {
    direction,
    trendStack01,
    accumPersistence01,
    catalystInWindow01: catalystPass1.catalystInWindow01,
  };
  const verdict = classifyArchetype(archetypeInputs);
  const archetype = verdict.archetype;

  const finalDte = (archetype && ARCHETYPE_INTENDED_DTE[archetype] != null) ? ARCHETYPE_INTENDED_DTE[archetype] : DEFAULT_SWING_DISCOVERY_CONFIG.intendedDte;
  const catalystFinal = finalDte === DEFAULT_SWING_DISCOVERY_CONFIG.intendedDte
    ? catalystPass1
    : deriveCatalystReads({ intendedDte: finalDte, signedReturnPct10d: null, freshCatalystAgeDays: null, earnings: earningsWindows });

  const discoveryPaths = [...seed.paths];
  if (catalystFinal.catalystStrength01 != null && !discoveryPaths.includes("CATALYST")) discoveryPaths.push("CATALYST");

  const regime01 = regimeFromSpyTrend(spyCloses, direction);

  const gEarnings = evaluateEarningsGate({ discoveryPaths, archetype, earningsInWindow: catalystFinal.earningsInWindow });
  const gRegime = evaluateRegimeGate({ discoveryPaths, archetype, regime01 });
  const gConfluence = evaluateConfluenceGate({ discoveryPaths, archetype });

  const blocks = [gEarnings, gRegime, gConfluence].filter((g) => !g.pass);
  return {
    ticker,
    direction,
    archetype,
    paths: seed.paths,
    verdict: blocks.length === 0 ? "COMMIT" : "BLOCK",
    blocks: blocks.map((g) => g.gate),
  };
});

// ── ISOLATED failure incidence per gate ──
const isolatedFail = new Map();
for (const r of results) for (const g of r.blocks) isolatedFail.set(g, (isolatedFail.get(g) ?? 0) + 1);
const jointPass = results.filter((r) => r.verdict === "COMMIT").length;
const jointBlocked = results.length - jointPass;

console.log(`\n${line()}`);
console.log(`  GATE JOINT PASS RATE — G-S3 + G-S4 + G-S6 at once (FRESH BASELINE ONLY — see header: these 3`);
console.log(`  gates were NOT touched by either 2026-09-08 loosening PR, so there is no "before" to diff)`);
console.log(line());
const row = (label, val, note = "") => console.log(`    ${pad(label, 44)}${padL(val, 6)}   ${note}`);
row("Tier-1 candidates evaluated", results.length);
row("JOINT COMMIT (clears G-S3+G-S4+G-S6)", jointPass, `${results.length ? ((jointPass / results.length) * 100).toFixed(1) : "0"}% of evaluated`);
row("JOINT BLOCKED (fails ≥1 measured gate)", jointBlocked);

console.log(`\n${line()}`);
console.log(`  PER-GATE ISOLATED FAILURE RATE  (of ${results.length} candidates — sorted worst-first)`);
console.log(line());
const sortedGates = [...isolatedFail.entries()].sort((a, b) => b[1] - a[1]);
if (!sortedGates.length) {
  console.log("    (no gate fired on any candidate — every evaluated candidate would clear all 3)");
}
for (const [code, count] of sortedGates) {
  const pct = ((count / results.length) * 100).toFixed(1);
  console.log(`    ${pad(code, 32)}${padL(count, 5)} / ${results.length}   (${padL(pct, 5)}%)`);
}

const archetypeCounts = new Map();
for (const r of results) archetypeCounts.set(r.archetype ?? "null", (archetypeCounts.get(r.archetype ?? "null") ?? 0) + 1);
console.log(`\n    Archetype mix this run (lower-fidelity classification — see header): ${[...archetypeCounts.entries()].map(([a, c]) => `${a}=${c}`).join(", ")}`);

console.log(`\n${line()}`);
console.log(`  NOT MEASURED THIS RUN (approximated/skipped — see script header for why) — biases in BOTH directions,`);
console.log(`  do not collapse this into a single "upper bound" claim`);
console.log(line());
console.log(`    G-S12 halt/LULD — needs a live UW+LULD Redis-cluster-freshness read this sandbox cannot reach; assumed`);
console.log(`      CLEAR. Biases the joint rate UP (a real halt/stale feed can only ADD a block this run never sees).`);
console.log(`    G-S14 Cortex — evaluated AFTER these hard gates in production (fetchVectorFullState fan-out); not run`);
console.log(`      here at all. Same direction: can only ADD a real block this run never sees.`);
console.log(`    POSITIONING/CATALYST/BANGER/VECTOR Tier-0 origins — this run measures FLOW+STRUCTURE only, so every`);
console.log(`      candidate's discoveryPaths carries FEWER independent kinds than production's real merge would.`);
console.log(`      This biases G-S6 confluence the OPPOSITE way — DOWN: a real name POSITIONING/VECTOR/BANGER also`);
console.log(`      surfaced would clear G-S6 more easily live than it does in this run, so G-S6's isolated failure`);
console.log(`      rate here is likely an OVERSTATEMENT of production's real rate, not an understatement.`);
console.log(`    Net effect on the joint number: MIXED, not one-directional — this run does not resolve which force`);
console.log(`    dominates. Read the joint % below as "at least this compounding effect exists," not as a bound.`);

console.log(`\n${line("═")}`);
console.log(`  SUMMARY: STRUCTURE OLD→NEW ${moversOld.length}→${moversNew.length} · Tier-0 merged OLD→NEW ${mergedOld.length}→${mergedNew.length} · Tier-1 cap OLD→NEW ${capOld.cap}→${capNew.cap}`);
console.log(`  Of ${results.length} Tier-1 candidates evaluated: ${jointPass} joint-commit-eligible on G-S3+G-S4+G-S6 (${results.length ? ((jointPass / results.length) * 100).toFixed(1) : "0"}%) — mixed-bias approximation, see NOT MEASURED above`);
console.log(`  The single biggest isolated gate this run: ${sortedGates[0] ? `${sortedGates[0][0]} (${sortedGates[0][1]}/${results.length})` : "none fired"}`);
console.log(`  FINDING: swingCorroboratedFlowMinPremium/swingLegacyFlowMinPremium are dead + structurally inert — see header + PR body`);
console.log(line("═"));

if (EMIT_JSON) {
  console.log("\n<<<JSON>>>");
  console.log(JSON.stringify({
    asOf: today,
    poolSize: {
      structureMovers: { old: moversOld.length, new: moversNew.length },
      tier0Merged: { old: mergedOld.length, new: mergedNew.length },
      tier1Cap: { old: capOld, new: capNew },
      flowTickersDirectional: flowTickersDirectional.length,
    },
    gateFunnel: {
      tier1PoolRealCap: tier1Pool.length,
      evaluated: results.length,
      jointPass,
      jointBlocked,
      isolatedFailureByGate: Object.fromEntries(sortedGates),
      archetypeMix: Object.fromEntries(archetypeCounts),
    },
    perCandidate: results,
  }, null, 2));
}
