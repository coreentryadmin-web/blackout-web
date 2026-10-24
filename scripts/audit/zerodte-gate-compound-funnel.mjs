/**
 * 0DTE GATE-COMPOUND FUNNEL — "which gate is actually killing the board, and how much does the
 * STACK compound?"
 * ============================================================================================
 *
 * WHY THIS EXISTS (2026-09-08/09, operator directive)
 * ----------------------------------------------------
 * The 2026-09-08 gate-loosening pass (fix/loosen-nighthawk-discovery-gates, #4608) turned ~10
 * individual knobs (score floors, confluence minimum, far-OTM caps, governor thresholds, the
 * BREAKOUT dynamic-N ceiling) without ever measuring whether any SINGLE knob was the actual
 * bottleneck, or whether the real problem is that a setup must clear ~15 independently-tuned
 * gates SIMULTANEOUSLY — each individually calibrated to keep 60-85% of setups, but the JOINT
 * pass rate compounds multiplicatively (ten gates at 70% each is ~3% joint, not 70%). Nobody had
 * ever measured the real joint funnel before touching a single number.
 *
 * This script closes that gap for the FLOW-origin gate stack (gates.ts's evaluateZeroDteGates,
 * G-1 through G-23 as of 2026-09-09 — see the three new safety gates in the APPROXIMATED section
 * below, none of which this offline harness can actually exercise yet): it runs REAL production
 * functions against REAL live market data and reports
 * an ISOLATED failure rate per gate (how many real candidates trip THIS gate, regardless of any
 * other) alongside the JOINT pass rate (how many clear every gate at once) — the actual number
 * this repo has never measured.
 *
 * WHAT'S REAL vs. APPROXIMATED (same honesty discipline as zerodte-sim.mjs)
 * ---------------------------------------------------------------------------
 * REAL (production code, no reimplementation):
 *   - deriveZeroDteSetups + calibrateFlowEvidenceScore (board.ts)  — the real 4-evidence-gate
 *     funnel (min_gross/min_aggr_share/min_dominance/max_itm_pct) AND the real score formula.
 *   - extractChainFieldsFromRaw / askPctFromRaw (flow-raw-fields.ts) — the real per-print
 *     ask_pct/underlying_price/open_interest recovery (mirrors the SQL fetchRecentFlows uses).
 *   - computeIntradayRead / marketBias / intradayScoreAdjust (intraday.ts) — the real VWAP/trend/
 *     opening-range read, fed REAL Polygon minute bars per ticker + SPY.
 *   - computeConfluence (confluence.ts) — the real G-12 confluence tier, fed the real intraday
 *     read above (this is the exact function attachConfluence calls in the live scan).
 *   - evaluateZeroDteGates (gates.ts) — the REAL, unmodified gate stack. Every block this script
 *     reports is a real gate function returning a real verdict, not a guess about what it would do.
 *   - Real day-open VIX (Polygon I:VIX daily bar).
 *
 * REAL DATA, DIFFERENT FETCH PATH (disclosed, mirrors zerodte-sim.mjs's own precedent): production
 * reads its FLOW candidates from a Postgres table (fetchRecentFlows, db.ts) that an ingestion cron
 * populates from UW's flow-alerts feed — Postgres is blocked from this sandbox. This script queries
 * the SAME UW flow-alerts feed directly via the UW REST API instead. Same alerts, same schema,
 * different pipe — not the live board's exact candidate SET (which also reflects ingestion timing/
 * de-dup), but the same evidence-gate math applied to real UW prints.
 *
 * APPROXIMATED / NOT EXERCISED (explicitly, so a clean run is never mistaken for "every gate
 * measured") — these gates depend on state this sandbox cannot read (a live board session's
 * governor ledger, DB-backed Cortex sources, cross-desk board state):
 *   - G-5 governor (max_concurrent/session_stops/reentry_lock/correlated_conflict): evaluated with
 *     an EMPTY book (no open plans, no stops) — this UNDERSTATES the governor's real bite. A
 *     real board with 2 open correlated plays would show more G-5 blocks than this run does.
 *   - G-6 cross-system conflict (slayerLive/nighthawkTake): evaluated with NO live cross-desk
 *     state — this gate will show ~0% isolated failure here, which is an ARTIFACT of missing
 *     input, not evidence the gate never fires live.
 *   - G-7 macro (CPI/FOMC/NFP): evaluated as "zero events" (not attempted) — no macro-calendar
 *     fetch in this pass, so G-7 never fires here.
 *   - G-8/G-9 plan-quality (moved/illiquid/no-quote) and G-11 halt/earnings: no live option quote
 *     or earnings-feed fetch in this pass — these gates are SKIPPED (input omitted), not measured.
 *   - Cortex veto layer (cortex-gate.ts, evaluated AFTER these hard gates in production): not run
 *     here at all — this script only measures gates.ts's hard-gate stack.
 * Every one of these is printed in the report's own "NOT MEASURED THIS RUN" section — never
 * silently absent.
 *
 * BREAKOUT-ORIGIN THESIS-RANK-REJECT SECTION (added 2026-09-10) — a DIFFERENT PIPELINE
 * ----------------------------------------------------------------------------------------
 * Everything above measures gates.ts's hard-gate stack for FLOW-origin setups only, and
 * previously listed "BREAKOUT/PIN origins" under NOT MEASURED THIS RUN. That gap is now half
 * closed: a new section below runs TODAY's real BREAKOUT/BREAKDOWN screen (screenBreakoutMovers/
 * screenBreakdownMovers, the same dynamic-cap/momentum-rank production applies) through the REAL
 * thesis-first pipeline (attachThesisFirstLive, thesis/live-pipeline.ts — the exact function
 * scan.ts calls live) and reports the ISOLATED `thesis_rank_reject` rate for that population,
 * clearly labeled as a SEPARATE pipeline from the hard-gate stack above (thesis-first is an
 * archetype/rank quality gate evaluated on the discovery side, not one of gates.ts's G-1..G-23).
 * See `scripts/audit/thesis-rank-reject-outcome-ab.mjs` for the dedicated, multi-day, graded
 * OUTCOME measurement (does REJECT actually correlate with worse forward results) — this
 * section only reports the isolated rejection rate for TODAY's live snapshot, same scope
 * discipline as the FLOW section above. PIN is attempted live (discoverPinSetups) but — same as
 * the dedicated tool — has no reachable measurement path from this sandbox (a live-only GEX-
 * heatmap snapshot AND a Next.js client/server module-boundary marker in its import chain);
 * reported honestly as INSUFFICIENT DATA / error, never fabricated.
 *
 * USAGE
 *   POLYGON_API_BASE=https://api.massive.com \
 *   env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY \
 *   node --import tsx scripts/audit/zerodte-gate-compound-funnel.mjs [options]
 *
 * OPTIONS
 *   --days=N          multi-day flow lookback for the UW fetch (default 3)
 *   --min-premium=N   min alert premium to ingest (default 250000, matches MULTI_DAY_MIN_PREMIUM)
 *   --max-tickers=N   cap on candidates fed through the intraday/gate pass (default 40)
 *   --now-et=HH:MM    OVERRIDE the ET clock fed to evaluateZeroDteGates only (G-2/G-12/G-14/G-18
 *                     time-window gates) — real VIX/SPY/intraday data still reflects the ACTUAL
 *                     current time, only the gate stack's own time-of-day input is synthetic.
 *                     Use this to see the RTH-window bottleneck when running off-hours; the
 *                     report labels this clearly so it's never mistaken for a live reading.
 *   --json            also print a machine-readable JSON block at the end
 *   --max-breakout=N  cap on BREAKOUT/BREAKDOWN candidates fed through the thesis-first section
 *                      (default 40 — a live snapshot, not a backtest, so this stays small)
 *
 * Secrets come from env only (UW_API_KEY, POLYGON_API_KEY). Nothing is written or committed.
 */

if (!process.env.POLYGON_API_BASE || !/^https?:\/\//.test(process.env.POLYGON_API_BASE)) {
  process.env.POLYGON_API_BASE = "https://api.massive.com";
}
process.env.ZERODTE_THESIS_FIRST = "1"; // exercise the LIVE rank-tier → thesis_rank_reject mapping

const SRC = new URL("../../src/", import.meta.url).pathname;

const argv = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    return m ? [m[1], m[2] ?? "true"] : [a, "true"];
  })
);
const DAYS = Math.max(1, Number(argv.days ?? 3));
const MIN_PREMIUM = Math.max(0, Number(argv["min-premium"] ?? 250_000));
const MAX_TICKERS = Math.max(1, Number(argv["max-tickers"] ?? 40));
const MAX_BREAKOUT = Math.max(1, Number(argv["max-breakout"] ?? 40));
const EMIT_JSON = Boolean(argv.json);
const NOW_ET_OVERRIDE = (() => {
  if (!argv["now-et"] || argv["now-et"] === "true") return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(argv["now-et"]));
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
})();

const { fetchMarketFlowAlertRows } = await import(`${SRC}lib/providers/unusual-whales.ts`);
const { extractChainFieldsFromRaw } = await import(`${SRC}lib/flow-raw-fields.ts`);
const { dteFromExpiry } = await import(`${SRC}lib/flow-dte.ts`);
const { deriveZeroDteSetups } = await import(`${SRC}lib/zerodte/board.ts`);
const { evaluateZeroDteGates } = await import(`${SRC}lib/zerodte/gates.ts`);
const { computeConfluence } = await import(`${SRC}lib/zerodte/confluence.ts`);
const { computeIntradayRead, marketBias, intradayScoreAdjust } = await import(
  `${SRC}lib/zerodte/intraday.ts`
);
const { fetchStockMinuteBars, fetchDailyMarketSummary } = await import(`${SRC}lib/providers/polygon.ts`);
const { fetchAggBars } = await import(`${SRC}lib/providers/polygon-largo.ts`);
// BREAKOUT-origin thesis-rank-reject section (2026-09-10) — a DIFFERENT pipeline, see header.
const { screenBreakoutMovers, screenBreakdownMovers } = await import(`${SRC}features/nighthawk/lib/candidates.ts`);
const {
  rankMoversForChainFetch,
  BREAKOUT_MAX_CANDIDATES,
  BREAKOUT_MAX_CANDIDATES_CEILING,
  BREAKOUT_SCREEN_POOL,
} = await import(`${SRC}lib/zerodte/breakout-discovery.ts`);
const { resolveBreakoutCandidateCap } = await import(`${SRC}lib/zerodte/breakout-cap.ts`);
const { breakoutScoreBreakdown } = await import(`${SRC}lib/zerodte/breakout-source.ts`);
const { attachThesisFirstLive } = await import(`${SRC}lib/zerodte/thesis/live-pipeline.ts`);

const fmtUsd = (n) =>
  n == null ? "—" : n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(0)}k` : `$${n.toFixed(0)}`;
const pad = (s, w) => String(s).padEnd(w);
const padL = (s, w) => String(s).padStart(w);
const line = (c = "─", w = 100) => c.repeat(w);
function etYmd(ms) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
}
function etMinutesOf(ms) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "numeric", hour12: false }).formatToParts(new Date(ms));
  return Number(parts.find((p) => p.type === "hour")?.value ?? 0) * 60 + Number(parts.find((p) => p.type === "minute")?.value ?? 0);
}

/** Paginate UW flow-alerts backward via `older_than` until the window is covered. */
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

// ── MAIN ─────────────────────────────────────────────────────────────────────────
const nowMs = Date.now();
const today = etYmd(nowMs);
const realNowEtMinutes = etMinutesOf(nowMs);
const nowEtMinutes = NOW_ET_OVERRIDE ?? realNowEtMinutes;

console.log(line("═"));
console.log(`  0DTE GATE-COMPOUND FUNNEL — as-of ${today} ${String(Math.floor(realNowEtMinutes / 60)).padStart(2, "0")}:${String(realNowEtMinutes % 60).padStart(2, "0")} ET (real)`);
if (NOW_ET_OVERRIDE != null) {
  console.log(`  ⚠ GATE-CLOCK OVERRIDE: evaluateZeroDteGates is fed ${String(Math.floor(nowEtMinutes / 60)).padStart(2, "0")}:${String(nowEtMinutes % 60).padStart(2, "0")} ET instead — VIX/SPY/intraday data below is still the REAL current read, only the time-window gates (G-2/G-12/G-14/G-18) see the synthetic clock`);
}
console.log(`  flow window ${DAYS}d · min premium ${fmtUsd(MIN_PREMIUM)} · cap ${MAX_TICKERS} tickers`);
console.log(line("═"));

// 1) MULTI-DAY FLOW (real UW feed, real REST path — see header disclosure)
console.log(`\n[1] Fetching multi-day UW flow (${DAYS}d back, min ${fmtUsd(MIN_PREMIUM)})…`);
const mrows = await fetchMultiDayFlow(nowMs, DAYS, MIN_PREMIUM);
console.log(`    ${mrows.length} raw alerts fetched`);
if (!mrows.length) {
  console.log("\n  No flow in window (off-hours + empty cache, or UW unreachable). Nothing to measure.");
  process.exit(0);
}

// 2) MAP → FlowSetupInput, recovering ask_pct/underlying_price/open_interest/fill_price the same
//    way production's SQL ingestion does (extractChainFieldsFromRaw — a real, shared helper).
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
    underlying_price: chain.underlying_price,
    fill_price: chain.fill_price,
    open_interest: chain.open_interest,
    alerted_at: f.alerted_at,
  });
}
console.log(`    ${flowRows.length} usable directional rows after CALL/PUT parse`);

// 3) REAL evidence-gate funnel (the 4 gates deriveZeroDteSetups enforces before a row is even a
//    "setup") — this IS production code, rejections captured via its own opts.rejections.
console.log(`\n[2] Running the REAL evidence-gate funnel (deriveZeroDteSetups)…`);
const rejections = [];
const rawSetups = deriveZeroDteSetups(flowRows, {
  maxSetups: MAX_TICKERS,
  nowMs,
  todayYmd: today,
  rejections,
});
console.log(`    ${rawSetups.length} setups survived evidence gates (min_gross/aggr_share/dominance/max_itm)`);
const evidenceRejectionCounts = new Map();
for (const r of rejections) {
  evidenceRejectionCounts.set(r.gate_failed, (evidenceRejectionCounts.get(r.gate_failed) ?? 0) + 1);
}

if (!rawSetups.length) {
  console.log("\n  No setups survived the evidence gates this cycle. Funnel ends here.");
  process.exit(0);
}

// 4) REAL VIX day-open + REAL SPY intraday read (for G-4 and market bias).
console.log(`\n[3] Fetching real day-open VIX + SPY intraday read…`);
const vixBar = await fetchAggBars("I:VIX", 1, "day", today, today).catch(() => []);
const vixDayOpen = Array.isArray(vixBar) && vixBar[0]?.o != null ? Number(vixBar[0].o) : null;
const spyBars = await fetchStockMinuteBars("SPY", today, today).catch(() => []);
const spyRead = computeIntradayRead((spyBars ?? []).map((b) => ({ t: b.t, h: b.h, l: b.l, c: b.c, v: b.v })));
const bias = marketBias(spyRead);
console.log(`    VIX day-open: ${vixDayOpen ?? "—"}  ·  SPY bias: ${bias ?? "unknown"} (vwap ${spyRead.vwap?.toFixed(2) ?? "—"}, last ${spyRead.last?.toFixed(2) ?? "—"})`);

// 5) Per-ticker intraday read (real Polygon minute bars) → real confluence + real intraday-conflict.
console.log(`\n[4] Fetching per-ticker intraday reads for ${rawSetups.length} setups (real Polygon minute bars)…`);
const enriched = [];
for (const s of rawSetups) {
  const bars = await fetchStockMinuteBars(s.ticker, today, today).catch(() => []);
  const read = (bars ?? []).length ? computeIntradayRead(bars.map((b) => ({ t: b.t, h: b.h, l: b.l, c: b.c, v: b.v }))) : null;
  const marketAligned = bias == null || bias === "flat" ? null : (bias === "up") === (s.direction === "long");
  const conflict = read ? intradayScoreAdjust(s.direction, read).conflict : false;
  const setupForConfluence = { direction: s.direction, intraday: read, market_aligned: marketAligned };
  const confluence = computeConfluence(setupForConfluence, nowEtMinutes);
  enriched.push({ setup: s, intraday: read, marketAligned, intradayConflict: conflict, confluence });
}
console.log(`    done — ${enriched.filter((e) => e.intraday?.last != null).length}/${enriched.length} have a live intraday read`);

// 6) THE ACTUAL GATE-COMPOUND MEASUREMENT — run every setup through the REAL evaluateZeroDteGates
//    and record EVERY block it returns (not just the first), so isolated-vs-joint is exact.
console.log(`\n[5] Running the REAL evaluateZeroDteGates stack per setup…`);
const results = [];
for (const e of enriched) {
  const s = e.setup;
  const input = {
    ticker: s.ticker,
    direction: s.direction,
    score: s.score,
    discovery_origin: ["FLOW"],
    nowEtMinutes,
    nowMs,
    bias,
    biasAsOfMs: spyRead.last_bar_ms ?? null,
    governor: { open_plans: [], stops: [] }, // APPROXIMATED — see header disclosure
    vixDayOpen,
    vixUnavailable: vixDayOpen == null,
    slayerLive: null, // NOT MEASURED — see header
    nighthawkTake: null, // NOT MEASURED — see header
    macroEvents: [], // NOT MEASURED — treated as "fetched, zero events"
    plan: null, // G-8/G-9 skipped (no live quote fetch this pass)
    deferPlanQualityGates: true,
    contractHorizon: "ZERO_DTE",
    intradayConflict: e.intradayConflict,
    market_aligned: e.marketAligned,
    halted: false,
    haltFeedStale: false,
    earnings: null,
    earningsUnavailable: false,
    confluence: e.confluence,
  };
  const verdict = evaluateZeroDteGates(input);
  results.push({ ticker: s.ticker, direction: s.direction, score: s.score, verdict });
}

// ── ISOLATED failure incidence per gate code (across all setups that reached this stage) ──
const isolatedFail = new Map();
for (const r of results) {
  for (const b of r.verdict.blocks) {
    isolatedFail.set(b.code, (isolatedFail.get(b.code) ?? 0) + 1);
  }
}
const jointPass = results.filter((r) => r.verdict.verdict === "COMMIT").length;
const jointBlocked = results.length - jointPass;

console.log(`\n${line()}`);
console.log(`  STAGE-BY-STAGE FUNNEL`);
console.log(line());
const row = (label, val, note = "") => console.log(`    ${pad(label, 40)}${padL(val, 6)}   ${note}`);
row("raw UW alerts fetched", mrows.length);
row("usable CALL/PUT rows", flowRows.length);
row("↳ rejected: min_gross", evidenceRejectionCounts.get("min_gross") ?? 0);
row("↳ rejected: min_aggr_share", evidenceRejectionCounts.get("min_aggr_share") ?? 0);
row("↳ rejected: min_dominance", evidenceRejectionCounts.get("min_dominance") ?? 0);
row("↳ rejected: max_itm_pct", evidenceRejectionCounts.get("max_itm_pct") ?? 0);
row("setups (evidence gates passed)", rawSetups.length);
console.log(`    ${line("·", 50)}`);
row("JOINT COMMIT (clears every gate at once)", jointPass, `${results.length ? ((jointPass / results.length) * 100).toFixed(1) : "0"}% of setups`);
row("JOINT BLOCKED (fails ≥1 gate)", jointBlocked);

console.log(`\n${line()}`);
console.log(`  PER-GATE ISOLATED FAILURE RATE  (of ${results.length} setups reaching the hard-gate stack — sorted worst-first)`);
console.log(`  "isolated" = fails THIS gate regardless of any other; a setup can appear in multiple rows`);
console.log(line());
const sortedGates = [...isolatedFail.entries()].sort((a, b) => b[1] - a[1]);
if (!sortedGates.length) {
  console.log("    (no gate fired on any setup — every setup that reached this stage would commit)");
}
for (const [code, count] of sortedGates) {
  const pct = ((count / results.length) * 100).toFixed(1);
  console.log(`    ${pad(code, 32)}${padL(count, 5)} / ${results.length}   (${padL(pct, 5)}%)`);
}

console.log(`\n${line()}`);
console.log(`  NOT MEASURED THIS RUN (approximated/skipped — see script header for why)`);
console.log(line());
console.log(`    G-5 governor (max_concurrent/session_stops/reentry_lock/correlated_conflict) — evaluated with an EMPTY book`);
console.log(`    G-6 cross_system_conflict — no live Slayer/Night Hawk cross-desk state`);
console.log(`    G-7 macro_hard_block — no macro-calendar fetch (treated as zero events)`);
console.log(`    G-8/G-9 plan_moved/plan_illiquid/plan_no_quote/plan_quote_* — no live option quote fetch`);
console.log(`    G-11 halted/earnings — no halt-feed/earnings-feed fetch`);
console.log(`    G-20 input_desync (2026-09-09) — needs plan.quoteAgeMs; no live option quote fetched this pass (plan: null) → fail-open, never fires here`);
console.log(`    G-21 quote thin_size/no_volume_or_oi (2026-09-09 recalibration) — lives inside plan-quality (planQualityGateBlocks), SKIPPED here same as G-8/G-9`);
console.log(`    G-23 qualification_dislocation (2026-09-09) — needs a qualification-time underlying snapshot this offline harness never captures → fail-open, never fires here`);
console.log(`    Cortex veto layer (cortex-gate.ts) — evaluated AFTER these hard gates in production, not run here`);
console.log(`    BREAKOUT/PIN origins — the hard-gate stack above measures FLOW-origin setups only;`);
console.log(`      see the BREAKOUT/PIN THESIS-RANK-REJECT section below (a DIFFERENT pipeline)`);

// ── BREAKOUT/PIN THESIS-RANK-REJECT — a DIFFERENT PIPELINE (added 2026-09-10) ───────────────
// thesis-first (thesis/live-pipeline.ts) is an archetype/rank QUALITY gate evaluated on the
// discovery side, not one of gates.ts's G-1..G-23 above — reported separately, never folded into
// the joint hard-gate numbers. See the dedicated `thesis-rank-reject-outcome-ab.mjs` for the
// multi-day GRADED outcome measurement; this section is a live, single-snapshot isolated-rate
// check only (same "today, whatever's live" scope as the FLOW section above).
console.log(`\n${line()}`);
console.log(`  BREAKOUT/PIN THESIS-RANK-REJECT — DIFFERENT PIPELINE (thesis-first archetype/rank gate, not a gates.ts hard gate)`);
console.log(line());
let breakoutThesis = { attempted: false, error: null, graded: 0, reject: 0, blockCounts: {} };
try {
  const summary = await fetchDailyMarketSummary(today).catch(() => null);
  const grouped = summary?.results ?? [];
  if (!grouped.length) {
    console.log(`  no live grouped-daily snapshot for ${today} (off-hours/provider miss) — INSUFFICIENT DATA this run.`);
  } else {
    const screenPool = Math.max(BREAKOUT_MAX_CANDIDATES_CEILING * 4, BREAKOUT_SCREEN_POOL);
    const longMovers = screenBreakoutMovers(grouped, screenPool);
    const shortMovers = screenBreakdownMovers(grouped, screenPool);
    const qualifying = longMovers.length + shortMovers.length;
    if (qualifying === 0) {
      console.log(`  0 qualifying BREAKOUT/BREAKDOWN movers today — INSUFFICIENT DATA this run.`);
    } else {
      const cap = resolveBreakoutCandidateCap({ qualifyingMovers: qualifying, floor: BREAKOUT_MAX_CANDIDATES, ceiling: BREAKOUT_MAX_CANDIDATES_CEILING });
      const perSide = Math.max(1, Math.floor(MAX_BREAKOUT / 2));
      const rankedLong = rankMoversForChainFetch(longMovers, Math.min(cap, perSide), "long");
      const longTickers = new Set(rankedLong.map((m) => m.ticker.toUpperCase()));
      const rankedShort = rankMoversForChainFetch(shortMovers, cap, "short").filter((m) => !longTickers.has(m.ticker.toUpperCase())).slice(0, perSide);
      const longMaxDollar = longMovers.reduce((m, x) => Math.max(m, x.dollar), 0);
      const shortMaxDollar = shortMovers.reduce((m, x) => Math.max(m, x.dollar), 0);
      const candidates = [
        ...rankedLong.map((m) => ({ mover: m, direction: "long", dollarNorm: longMaxDollar > 0 ? m.dollar / longMaxDollar : 0 })),
        ...rankedShort.map((m) => ({ mover: m, direction: "short", dollarNorm: shortMaxDollar > 0 ? m.dollar / shortMaxDollar : 0 })),
      ];
      console.log(`  ${qualifying} qualifying (${longMovers.length}L/${shortMovers.length}S) → cap ${cap} → ${candidates.length} candidate(s) fed to the thesis-first pipeline`);
      const btSetups = [];
      for (const cand of candidates) {
        const bars = await fetchStockMinuteBars(cand.mover.ticker.toUpperCase(), today, today).catch(() => []);
        if (!bars.length) continue;
        const upToNow = bars.filter((b) => Number.isFinite(b.t) && etMinutesOf(b.t) <= nowEtMinutes);
        const intraday = computeIntradayRead(upToNow.map((b) => ({ t: b.t, h: b.h, l: b.l, c: b.c, v: b.v })));
        if (intraday.last == null) continue;
        const { score } = breakoutScoreBreakdown(cand.mover, cand.dollarNorm, cand.direction);
        btSetups.push({
          ticker: cand.mover.ticker.toUpperCase(),
          direction: cand.direction,
          discovery_origin: ["BREAKOUT"],
          score,
          gross_premium: 0,
          prints: 0,
          underlying_price: intraday.last,
          intraday,
          rel_volume: null,
          key_resistances: [],
          key_supports: [],
          gamma_regime: null,
          rsi14: null,
          catalyst_flags: [],
          news_hot: null,
          earnings: null,
          flow_quality: null,
        });
      }
      attachThesisFirstLive(btSetups, nowEtMinutes, {}, undefined);
      const btRows = btSetups.map((s) => ({
        ticker: s.ticker,
        rank_tier: s.thesis_first?.rank_tier ?? null,
        blocks: s.thesis_first?.archetype_gates?.blocks ?? [],
      }));
      const rejectCount = btRows.filter((r) => r.rank_tier === "REJECT").length;
      const blockCounts = new Map();
      for (const r of btRows) if (r.rank_tier === "REJECT") for (const b of r.blocks) blockCounts.set(b, (blockCounts.get(b) ?? 0) + 1);
      breakoutThesis = { attempted: true, error: null, graded: btRows.length, reject: rejectCount, blockCounts: Object.fromEntries(blockCounts) };
      console.log(`  ${btRows.length} graded through attachThesisFirstLive — thesis_rank_reject isolated rate: ${rejectCount}/${btRows.length} (${btRows.length ? ((rejectCount / btRows.length) * 100).toFixed(1) : "0"}%)`);
      if (blockCounts.size) {
        for (const [code, n] of [...blockCounts.entries()].sort((a, b) => b[1] - a[1])) {
          console.log(`    ${pad(code, 32)}${padL(n, 5)} / ${rejectCount}`);
        }
      }
    }
  }
} catch (e) {
  breakoutThesis.error = e instanceof Error ? e.message : String(e);
  console.log(`  BREAKOUT thesis-first section FAILED: ${breakoutThesis.error}`);
}

console.log(`\n  PIN (live attempt only — no historical replay path from this sandbox, see header):`);
let pinThesis = { attempted: false, error: null, setups: 0 };
try {
  const { discoverPinSetups } = await import(`${SRC}lib/zerodte/pin-discovery.ts`);
  const pinSetups = await discoverPinSetups({ today, nowEtMinutes, excludeTickers: new Set() });
  pinThesis = { attempted: true, error: null, setups: pinSetups.length };
  if (pinSetups.length === 0) {
    console.log(`    0 live PIN setups this run (off-hours or no clean pin regime) — INSUFFICIENT DATA, expected.`);
  } else {
    attachThesisFirstLive(pinSetups, nowEtMinutes, {}, undefined);
    const rejectCount = pinSetups.filter((s) => s.thesis_first?.rank_tier === "REJECT").length;
    console.log(`    ${pinSetups.length} live PIN setup(s) — thesis_rank_reject: ${rejectCount}/${pinSetups.length}`);
  }
} catch (e) {
  pinThesis.error = e instanceof Error ? e.message : String(e);
  console.log(`    PIN discovery attempt FAILED: ${pinThesis.error} (same Next.js module-boundary/live-GEX-only limitation documented in thesis-rank-reject-outcome-ab.mjs)`);
}

console.log(`\n${line("═")}`);
console.log(`  SUMMARY: ${flowRows.length} rows → ${rawSetups.length} setups (evidence gates) → ${jointPass} commit-eligible (hard gates, partial context)`);
console.log(`  The single biggest isolated gate this run: ${sortedGates[0] ? `${sortedGates[0][0]} (${sortedGates[0][1]}/${results.length})` : "none fired"}`);
console.log(`  BREAKOUT thesis_rank_reject (different pipeline): ${breakoutThesis.graded ? `${breakoutThesis.reject}/${breakoutThesis.graded}` : "INSUFFICIENT DATA/error this run"}`);
console.log(line("═"));

if (EMIT_JSON) {
  console.log("\n<<<JSON>>>");
  console.log(JSON.stringify({
    asOf: today,
    nowEtMinutes,
    vixDayOpen,
    bias,
    funnel: {
      rawAlerts: mrows.length,
      usableRows: flowRows.length,
      evidenceRejections: Object.fromEntries(evidenceRejectionCounts),
      setups: rawSetups.length,
      jointPass,
      jointBlocked,
    },
    isolatedFailureByGate: Object.fromEntries(sortedGates),
    perSetup: results.map((r) => ({ ticker: r.ticker, direction: r.direction, score: r.score, verdict: r.verdict.verdict, blocks: r.verdict.blocks.map((b) => b.code) })),
    breakoutThesisRankReject: breakoutThesis,
    pinThesisRankReject: pinThesis,
  }, null, 2));
}
