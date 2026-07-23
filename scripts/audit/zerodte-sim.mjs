/**
 * 0DTE PLAY SIMULATOR — "what does this change actually do to today's plays?"
 * =========================================================================
 *
 * WHY THIS EXISTS
 * ---------------
 * Every change to the Night Hawk 0DTE pipeline used to be a leap of faith: you edit a gate, a
 * selector, or the flow logic, and you have NO idea until the next live session whether it
 * generates more plays, fewer, or breaks the board. This simulator closes that loop. It runs the
 * REAL production pipeline functions (imported straight from src/, not reimplemented) against REAL
 * market data (multi-day UW option flow + live Polygon chains + Polygon minute bars) and reports,
 * per stage:
 *   • which tickers become candidates (and why),
 *   • the exact per-stage FUNNEL (candidates → score floor → chain → contract → premium → geometry
 *     → grounded → built),
 *   • per-ticker GATE TRACE — where each candidate died or that it PASSED,
 *   • the final generated plays with real contract + entry/target/stop + R:R,
 *   • (backtest mode) a minute-bar GRADE of each play (doubled / stopped / time-stop) so you can
 *     see the win-rate impact of a change on a PAST session.
 *
 * This is "logical debugging of every change": make an edit, run the sim, read the funnel. If a
 * change is supposed to unlock more 0DTE plays, the funnel proves it; if it silently empties the
 * board, the funnel shows exactly which gate ate everything.
 *
 * WHAT'S REAL vs. APPROXIMATED (honesty)
 * --------------------------------------
 * REAL (production code, no reimplementation):
 *   - flowAccumulationByTicker  (the multi-day "stacked hits" memory layer — the change under test)
 *   - buildDeterministicEditionPlays + pickChainContract  (the actual selector + its funnel)
 *   - filterPlaysByMaxDte / optionsPlayWithinMaxDte       (the 0DTE day-window gate)
 *   - validatePlayGeometry (via buildDeterministicEditionPlays)
 *   - gradePlanFromBars + PLAN_RULES                      (the actual grader)
 * REAL data: UW flow-alerts (multi-day, paginated), Polygon chain snapshot, Polygon minute aggs.
 * APPROXIMATED: the CANDIDATE DISCOVERY here is the accumulation engine itself (direction + strength
 *   from stacked multi-day flow), NOT the full production market-wide discovery (candidates.ts, which
 *   needs many UW endpoints + Redis that aren't all reachable from this sandbox). That is deliberate:
 *   the point is to test how accumulation-driven candidates flow through the REAL selector/gates.
 *   Backtest grading uses the option's OWN minute bars on the session date for entry premium +
 *   outcome (self-consistent), but historical per-strike OI is not available, so contract SELECTION
 *   in backtest mode uses the accumulation magnet strike rather than the live-OI-filtered picker.
 *
 * USAGE
 *   POLYGON_API_BASE=https://api.massive.com \
 *   env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY \
 *   node --import tsx scripts/audit/zerodte-sim.mjs [options]
 *
 * OPTIONS
 *   --days=N            multi-day flow lookback window (default 5)
 *   --min-premium=N     min alert premium to ingest (default 250000)
 *   --max-tickers=N     cap on candidate tickers fed to chains (default 25)
 *   --max-dte=N         0DTE day-window for the picker/gate (default 1)
 *   --tickers=A,B,C     restrict the candidate universe to these symbols
 *   --grade=YYYY-MM-DD  BACKTEST: reconstruct as-of that session, grade each magnet play on minute bars
 *   --json              also print a machine-readable JSON block at the end
 *   --quiet             suppress the app's [nighthawk] console.info funnel line (keep only the report)
 *
 * Secrets come from env only (UW_API_KEY, POLYGON_API_KEY). Nothing is written or committed.
 */

// ── Env guard: the sandbox ships POLYGON_API_BASE as an unresolved placeholder. The provider modules
//    read process.env.POLYGON_API_BASE at IMPORT time (const BASE = ...; allowlist), so this MUST run
//    before any dynamic import of an app module below. api.massive.com is the code's own default host.
if (!process.env.POLYGON_API_BASE || !/^https?:\/\//.test(process.env.POLYGON_API_BASE)) {
  process.env.POLYGON_API_BASE = "https://api.massive.com";
}

const SRC = new URL("../../src/", import.meta.url).pathname;

// ── CLI args ──────────────────────────────────────────────────────────────────────
const argv = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    return m ? [m[1], m[2] ?? "true"] : [a, "true"];
  })
);
const DAYS = Math.max(1, Number(argv.days ?? 5));
const MIN_PREMIUM = Math.max(0, Number(argv["min-premium"] ?? 250_000));
const MAX_TICKERS = Math.max(1, Number(argv["max-tickers"] ?? 25));
const MAX_DTE = Number(argv["max-dte"] ?? 1);
const ONLY_TICKERS = argv.tickers
  ? new Set(String(argv.tickers).toUpperCase().split(",").map((s) => s.trim()).filter(Boolean))
  : null;
const GRADE_DATE = argv.grade && argv.grade !== "true" ? String(argv.grade) : null;
const EMIT_JSON = Boolean(argv.json);
const QUIET = Boolean(argv.quiet);

// Index / non-equity instruments the stock-chain path can't price via Polygon equity snapshots.
// (ETFs like SPY/QQQ/IWM DO resolve, so they stay in.)
const INDEX_INSTRUMENTS = new Set(["SPX", "SPXW", "VIX", "VIXW", "NDX", "RUT", "XSP", "VVIX", "DJX"]);

if (QUIET) {
  // --quiet suppresses the app's own diagnostic chatter (the `[nighthawk/det-edition] funnel:` line
  // emitted inside buildDeterministicEditionPlays) so only this script's report shows. console.info
  // is the app's channel for that; the sim itself writes via console.log. Silence console.info
  // outright rather than re-emit its args — a passthrough would route app-side strings into a log
  // sink (CodeQL log-injection), and there's nothing on console.info worth keeping under --quiet.
  console.info = () => {};
}

// ── Imports (real pipeline) ─────────────────────────────────────────────────────────
const { flowAccumulationByTicker } = await import(`${SRC}features/nighthawk/lib/flow-accumulation.ts`);
const { buildDeterministicEditionPlays, DETERMINISTIC_EDITION_TARGET } = await import(`${SRC}features/nighthawk/lib/deterministic-edition.ts`);
const { filterPlaysByMaxDte } = await import(`${SRC}features/nighthawk/lib/agents/day-trade-filters.ts`);
const { fetchEditionChains } = await import(`${SRC}features/nighthawk/lib/option-chain-prompt.ts`);
const { fetchMarketFlowAlertRows } = await import(`${SRC}lib/providers/unusual-whales.ts`);
const { gradePlanFromBars, PLAN_RULES } = await import(`${SRC}lib/zerodte/plan.ts`);
const { evaluateExitState } = await import(`${SRC}lib/zerodte/exit-engine.ts`);
const { fetchAggBars } = await import(`${SRC}lib/providers/polygon-largo.ts`);
const { appendFileSync } = await import("node:fs"); // for RATCHET_DUMP (offline ratchet-param sweep)

/**
 * Grade a play through the SHIPPED live exit engine (exit-engine.ts evaluateExitState) instead of the
 * hold-to-stop/target gradePlanFromBars — so the backtest measures the ratchet/trim/flat-timeout the
 * board ACTUALLY runs (arm +25%→BE, +50%→+20% lock, TRIM half at +100% then run the rest with a +50%
 * floor, flat-theta scratch). Faithful bar replay: conservative intrabar order = adverse extreme (low)
 * for protective exits FIRST, then favorable extreme (high) for target/trim, then the close for the
 * flat-timeout. Cortex evidence is null (thesis-break can't be replayed off-line → skipped, never
 * fabricated). Returns { pnl_pct, outcome } or null.
 *
 * MARK-FAITHFULNESS (audit 2026-07-23, three fixes so the ratchet EV is honest, not optimistic):
 *  #2  the replay stops at 15:30 ET (PLAN_RULES.time_stop_et_minutes = 930), NOT 16:00 — the board
 *      hard-CLOSES every 0DTE row at 15:30 (derivePlayStatus) and never fires an exit after, freezing
 *      P&L at the ~15:30 mark. Grading 15:31→16:00 bars would credit/charge trades the board forbids
 *      (and diverge from the sibling gradePlanFromBars, which already breaks at 15:30).
 *  #3  the ENTRY bar is excluded (b.t > flaggedMs, not >=). Entry is the entry bar's CLOSE, so its
 *      intrabar HIGH can print BEFORE entry existed — including it let a pre-entry high arm a ratchet
 *      floor (or trim) off a price the trade never had. The live peak latch only starts at flag time.
 */
const PROTECT_AT = process.env.RATCHET_PROTECT_AT === "close" ? "close" : "low";
const REPLAY_STOP_ET_MIN = 15 * 60 + 30; // 930 = 15:30 ET board hard time-stop (PLAN_RULES.time_stop_et_minutes)
function gradeThroughExitEngine(bars, entry, planStop, planTarget, flaggedMs) {
  if (!(entry > 0)) return null;
  const seq = [...bars].filter((b) => b.t > flaggedMs && etMinOfBar(b.t) <= REPLAY_STOP_ET_MIN).sort((a, z) => a.t - z.t);
  if (!seq.length) return null;
  const pnlAt = (mark) => ((mark - entry) / entry) * 100;
  let peak = entry, trimmed = false, realized = 0, remaining = 1, exited = false, outcome = "time_stop", lastClose = entry;
  for (const b of seq) {
    lastClose = b.c;
    const age = (b.t - flaggedMs) / 60000;
    const mk = (m, pk) => ({ entryPremium: entry, currentMark: m, peakPremium: pk, ageMinutes: age, cortexEvidence: null, planStop, planTarget, status: trimmed ? "TRIM" : "OPEN", trimmed, entryCortexScore: null });
    // 1) PROTECTIVE exit only (plan-stop or ratchet/runner floor). Flat-timeout is a time-based scratch
    // at the mark, handled at the close below. RATCHET_PROTECT_AT brackets BOTH axes of the live exit's
    // fidelity (audit 2026-07-23 fix #1) — trigger AND fill, not just trigger:
    //   =low (default, PESSIMISTIC): the bar LOW both TRIGGERS (the wick over-triggers vs live SSE marks —
    //     a dip that recovers still exits) AND is booked as the FILL (gap-through — the live poller freezes
    //     the first observed mark ≤ floor, which on a fast candle undershoots the floor toward the low).
    //   =close (OPTIMISTIC): the bar CLOSE triggers (only a sustained breach exits) and the fill is the
    //     clean floor level (a resting order fills AT the floor).
    // The old grader booked floorPnlPct in BOTH modes — always the best-case fill — so the ratchet EV was
    // systematically optimistic and the advertised bracket never actually varied the fill. The true live
    // fill sits inside [low-mode, close-mode]; running both now brackets the ratchet's real cost honestly.
    const protMark = PROTECT_AT === "close" ? b.c : b.l;
    const dLow = evaluateExitState(mk(protMark, peak));
    if (dLow.action === "EXIT" && (dLow.reason === "plan_stop" || /ratchet|runner/.test(dLow.reason))) {
      // plan_stop books at the stop level (repo stop convention, marks-math.ts). A ratchet/runner FLOOR
      // breach books the gap-through fill (bar low) in the pessimistic bound, the clean floor in the optimistic.
      const exitPnl = dLow.reason === "plan_stop"
        ? pnlAt(planStop)
        : (PROTECT_AT === "low" ? pnlAt(protMark) : dLow.floorPnlPct);
      realized += remaining * exitPnl; exited = true;
      outcome = dLow.reason === "plan_stop" ? "stopped" : "ratchet";
      break;
    }
    peak = Math.max(peak, b.h);
    // 2) favorable extreme (high) → trim half at target, or bank the runner
    const dHigh = evaluateExitState(mk(b.h, peak));
    if (dHigh.action === "TRIM" && !trimmed) { realized += 0.5 * pnlAt(planTarget); trimmed = true; remaining = 0.5; }
    else if (dHigh.action === "EXIT" && trimmed && dHigh.reason === "plan_target_final") { realized += remaining * pnlAt(planTarget); exited = true; outcome = "doubled"; break; }
    // 3) close → flat-theta scratch
    const dClose = evaluateExitState(mk(b.c, peak));
    if (dClose.action === "EXIT" && dClose.reason === "flat_theta_bleed") { realized += remaining * pnlAt(b.c); exited = true; outcome = "flat_scratch"; break; }
  }
  if (!exited) { realized += remaining * pnlAt(lastClose); outcome = trimmed ? "runner_close" : "time_stop"; }
  return { pnl_pct: Math.round(realized * 10) / 10, outcome };
}

// ── Small helpers ────────────────────────────────────────────────────────────────
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const fmtUsd = (n) =>
  n == null ? "—" : n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(0)}k` : `$${n.toFixed(0)}`;
const pad = (s, w) => String(s).padEnd(w);
const padL = (s, w) => String(s).padStart(w);
const line = (c = "─", w = 96) => c.repeat(w);
function etYmd(ms) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
}

/**
 * Map an app MarketFlowRow ({raw, flow}) → the pure FlowAlertRow the accumulation engine consumes.
 * UW returns ask/bid-side premium + vol/oi as STRINGS — coerce them. Drop UNKNOWN-side prints (they
 * carry no directional signal) and malformed rows.
 */
function toFlowAlertRow(mr) {
  const f = mr.flow ?? {};
  const raw = mr.raw ?? {};
  const side = f.option_type === "PUT" ? "put" : f.option_type === "CALL" ? "call" : null;
  if (!side) return null;
  const ticker = String(f.ticker ?? raw.ticker ?? "").toUpperCase();
  const strike = num(f.strike ?? raw.strike);
  const expiry = String(f.expiry ?? raw.expiry ?? "").slice(0, 10);
  const premium = num(f.premium ?? raw.total_premium ?? raw.premium);
  const createdAtMs = Date.parse(f.alerted_at ?? raw.created_at ?? "");
  if (!ticker || !strike || strike <= 0 || !expiry || premium == null || premium <= 0 || !Number.isFinite(createdAtMs)) {
    return null;
  }
  return {
    ticker,
    strike,
    expiry,
    side,
    premium,
    askSidePremium: num(raw.total_ask_side_prem),
    bidSidePremium: num(raw.total_bid_side_prem),
    sweep: Boolean(raw.has_sweep),
    opening: Boolean(raw.all_opening_trades ?? raw.is_opening),
    volOiRatio: num(raw.volume_oi_ratio),
    createdAtMs,
  };
}

/**
 * Paginate UW flow-alerts backward via `older_than` until the oldest row crosses the lookback cutoff.
 * Returns FlowAlertRow[] spanning ~`days` calendar days ending at `endMs`.
 */
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
      if (Number.isFinite(ms) && ms < oldestMs) {
        oldestMs = ms;
        oldestIso = iso;
      }
      const far = toFlowAlertRow(mr);
      if (!far) continue;
      const key = `${far.ticker}|${far.expiry}|${far.strike}|${far.side}|${far.createdAtMs}|${far.premium}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (far.createdAtMs >= cutoffMs && far.createdAtMs <= endMs) rows.push(far);
    }
    if (!oldestIso || oldestMs === Infinity) break;
    if (oldestMs < cutoffMs) break; // walked past the window
    if (oldestIso === olderThan) break; // no progress
    olderThan = oldestIso;
  }
  return rows;
}

/** Derive a display conviction letter purely from accumulation strength (cosmetic; tier gate re-derives). */
function convictionOf(strength) {
  return strength >= 70 ? "A+" : strength >= 55 ? "A" : strength >= 45 ? "A-" : "B";
}

/** Build an OCC option symbol for Polygon aggs, e.g. O:NVDA260722C00210000. */
function occSymbol(ticker, expiryYmd, side, strike) {
  const yymmdd = expiryYmd.slice(2).replace(/-/g, "");
  const cp = side === "put" ? "P" : "C";
  const strikeInt = String(Math.round(strike * 1000)).padStart(8, "0");
  return `O:${ticker.toUpperCase()}${yymmdd}${cp}${strikeInt}`;
}

const ENTRY_ET_MIN = 9 * 60 + 45; // enter ~09:45 ET (first clean quarter-hour after the open)
function etMinOfBar(t) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "numeric", hour12: false }).formatToParts(new Date(t));
  return Number(parts.find((p) => p.type === "hour")?.value ?? 0) * 60 + Number(parts.find((p) => p.type === "minute")?.value ?? 0);
}

/** Underlying spot at ~entry time on a past date = close of the first minute bar ≥ 09:45 ET. */
async function spotAtEntryOnDate(underlying, date) {
  const bars = await fetchAggBars(underlying.toUpperCase(), 1, "minute", date, date, "1500").catch(() => []);
  const clean = (bars ?? []).filter((b) => Number.isFinite(b.t) && Number.isFinite(b.c));
  if (!clean.length) return null;
  const at = clean.find((b) => etMinOfBar(b.t) >= ENTRY_ET_MIN) ?? clean[0];
  return at.c;
}

/** Standard strike increment for a given spot (mirrors typical OCC listing granularity). */
function strikeIncrement(spot) {
  if (spot < 25) return 0.5;
  if (spot < 100) return 1;
  if (spot < 250) return 2.5;
  return 5;
}

/**
 * Probe an ATM 0DTE contract that actually TRADED on `date`. The accumulation magnet strike is a
 * multi-day positioning signal (often a weekly/monthly) — NOT the tradeable 0DTE contract — so we
 * grade what production would actually pick: an ATM strike at the grade-date expiry, direction from
 * accumulation. Walks a small ladder around spot and returns the first strike with real minute bars.
 * Returns null when the underlying has no 0DTE contract on `date` (non-daily-expiry name) — an honest
 * "not tradeable as 0DTE", not a bug.
 */
async function probeAtm0dte(underlying, date, side, spot) {
  const inc = strikeIncrement(spot);
  const base = Math.round(spot / inc) * inc;
  const ladder = [base, base + inc, base - inc, base + 2 * inc, base - 2 * inc];
  for (const strike of ladder) {
    if (strike <= 0) continue;
    const occ = occSymbol(underlying, date, side, strike);
    const bars = await fetchAggBars(occ, 1, "minute", date, date, "1500").catch(() => []);
    const clean = (bars ?? [])
      .map((b) => ({ t: b.t, h: b.h, l: b.l, c: b.c }))
      .filter((b) => Number.isFinite(b.t) && Number.isFinite(b.h) && Number.isFinite(b.l) && Number.isFinite(b.c) && b.c > 0);
    if (clean.length) return { occ, strike, bars: clean };
  }
  return null;
}

// ── MAIN ─────────────────────────────────────────────────────────────────────────
const nowMs = GRADE_DATE ? Date.parse(`${GRADE_DATE}T16:00:00-04:00`) : Date.now();
const asOfLabel = GRADE_DATE ? `${GRADE_DATE} (backtest)` : `${etYmd(nowMs)} (live)`;

console.log(line("═"));
console.log(`  0DTE PLAY SIMULATOR — as-of ${asOfLabel}`);
console.log(`  flow window ${DAYS}d · min premium ${fmtUsd(MIN_PREMIUM)} · maxDTE ${MAX_DTE} · cap ${MAX_TICKERS} tickers`);
console.log(line("═"));

// 1) MULTI-DAY FLOW
console.log(`\n[1] Fetching multi-day option flow (UW, ${DAYS}d back)…`);
const flowRows = await fetchMultiDayFlow(nowMs, DAYS, MIN_PREMIUM);
const flowDays = new Set(flowRows.map((r) => etYmd(r.createdAtMs)));
const flowTickers = new Set(flowRows.map((r) => r.ticker));
console.log(`    ${flowRows.length} directional alerts · ${flowDays.size} distinct days [${[...flowDays].sort().join(", ")}] · ${flowTickers.size} tickers`);
if (!flowRows.length) {
  console.log("\n  No flow in window (off-hours + empty cache, or UW unreachable). Nothing to simulate.");
  process.exit(0);
}

// 2) ACCUMULATION (the change under test)
console.log(`\n[2] Multi-day flow accumulation (stacked-hits memory layer)…`);
const signals = flowAccumulationByTicker(flowRows, nowMs);
let ranked = [...signals.values()]
  .filter((s) => s.direction !== "neutral")
  .filter((s) => (ONLY_TICKERS ? ONLY_TICKERS.has(s.ticker) : true))
  .filter((s) => !INDEX_INSTRUMENTS.has(s.ticker))
  .sort((a, b) => b.strength - a.strength);

const neutralCount = [...signals.values()].filter((s) => s.direction === "neutral").length;
console.log(`    ${signals.size} tickers with flow → ${ranked.length} directional (${neutralCount} neutral/mixed dropped)`);
console.log(`\n    ${pad("TICKER", 8)}${pad("DIR", 6)}${padL("STR", 4)}  ${padL("NET PREM", 10)}  ${padL("DAYS", 5)}  MAGNET`);
console.log(`    ${line("·", 78)}`);
for (const s of ranked.slice(0, Math.min(MAX_TICKERS, 20))) {
  const mg = s.magnet;
  const magnet = mg ? `${mg.strike}${mg.side === "put" ? "P" : "C"} ${mg.expiry} · ${mg.days}d · ${fmtUsd(mg.weightedPremium)}` : "—";
  console.log(
    `    ${pad(s.ticker, 8)}${pad(s.direction, 6)}${padL(s.strength, 4)}  ${padL(fmtUsd(s.netSignedPremium), 10)}  ${padL(mg?.days ?? "—", 5)}  ${magnet}`
  );
}

// Cap to the candidate universe fed to chains.
ranked = ranked.slice(0, MAX_TICKERS);

// 3) SYNTHESIZE ScoredCandidate[] from accumulation signals.
const magnetByTicker = new Map();
const scoredCandidates = ranked.map((s) => {
  magnetByTicker.set(s.ticker, s.magnet);
  return {
    ticker: s.ticker,
    score: s.strength,
    direction: s.direction === "bull" ? "long" : "short",
    flow_score: s.strength, // drives the thesis "flow" driver
    tech_score: 0,
    pos_score: 0,
    news_score: 0,
    smart_money_score: 0,
    conviction: convictionOf(s.strength),
    confirming_signals: Math.min(5, (s.top ?? []).length),
  };
});
const belowFloor = scoredCandidates.filter((c) => c.score < 35).map((c) => c.ticker);

// 4) LIVE CHAINS (skip in backtest mode — historical OI snapshot isn't available).
let chains = {};
if (!GRADE_DATE) {
  console.log(`\n[3] Fetching live Polygon chains for ${scoredCandidates.length} candidates…`);
  chains = await fetchEditionChains({ stockTickers: scoredCandidates.map((c) => c.ticker), dossiers: [] });
  console.log(`    chains resolved for ${Object.keys(chains).length}/${scoredCandidates.length} tickers`);
}

if (!GRADE_DATE) {
  // 5) REAL SELECTOR + FUNNEL
  //    Run with target = the full candidate count so EVERY candidate that clears the gates is
  //    returned — otherwise the built list is truncated to the production top-N and the gate trace
  //    can't tell "failed a gate" from "ranked out of the top-N". We surface the production board
  //    (top DETERMINISTIC_EDITION_TARGET) separately below.
  console.log(`\n[4] Running the REAL deterministic edition selector (maxDte=${MAX_DTE})…`);
  const { plays, funnel } = buildDeterministicEditionPlays({
    ranked: scoredCandidates,
    dossierMap: {},
    chains,
    maxDte: MAX_DTE,
    target: Math.max(DETERMINISTIC_EDITION_TARGET, scoredCandidates.length),
  });

  // 6) 0DTE DAY-WINDOW FILTER
  const survivors = filterPlaysByMaxDte(plays, MAX_DTE);
  // Production would publish only the top N of the survivors (ranked order is preserved).
  const published = survivors.slice(0, DETERMINISTIC_EDITION_TARGET);
  const publishedTickers = new Set(published.map((p) => p.ticker.toUpperCase()));

  // ── FUNNEL ──
  console.log(`\n${line()}`);
  console.log(`  PER-STAGE FUNNEL`);
  console.log(line());
  const f = funnel;
  const row = (label, val, note = "") => console.log(`    ${pad(label, 34)}${padL(val, 5)}   ${note}`);
  row("candidates in", f.candidates);
  row("↳ below score floor (35)", f.score_below_floor, belowFloor.length ? `[${belowFloor.slice(0, 8).join(", ")}]` : "");
  row("↳ no chain resolved", f.no_chain);
  row("↳ no spot", f.no_spot);
  row("contract found (any pool)", f.contract_ok);
  row("stock-only (caveated/no contract)", f.stock_only);
  row("premium-capped (> $35/sh)", f.premium_capped);
  row("premium OK", f.premium_ok);
  row("geometry FAIL (wrong-side/thin)", f.geometry_fail);
  row("geometry OK", f.geometry_ok);
  row("grounded", f.grounded);
  row("dropped ungrounded", f.dropped_ungrounded);
  console.log(`    ${line("·", 44)}`);
  row("PLAYS BUILT (all gate-passers)", plays.length);
  row(`survive 0DTE filter (≤${MAX_DTE} DTE)`, survivors.length);
  row(`PUBLISHED (production top ${DETERMINISTIC_EDITION_TARGET})`, published.length);

  // ── PER-TICKER GATE TRACE ──
  console.log(`\n${line()}`);
  console.log(`  PER-TICKER GATE TRACE  (where each candidate ended up)`);
  console.log(line());
  const builtByTicker = new Map(plays.map((p) => [p.ticker.toUpperCase(), p]));
  const survivorTickers = new Set(survivors.map((p) => p.ticker.toUpperCase()));
  for (const c of scoredCandidates) {
    const tk = c.ticker.toUpperCase();
    const built = builtByTicker.get(tk);
    let verdict;
    if (c.score < 35) verdict = `✗ below score floor (${c.score})`;
    else if (!chains[tk]) verdict = "✗ no chain resolved (Polygon)";
    else if (publishedTickers.has(tk)) verdict = `✓ PUBLISHED PLAY (top ${DETERMINISTIC_EDITION_TARGET})`;
    else if (survivorTickers.has(tk)) verdict = "✓ play (gates ✓, ranked below top-N)";
    else if (built) verdict = `◐ built but dropped by 0DTE filter — contract "${built.options_play}"`;
    else verdict = "✗ no valid ≤maxDTE contract / premium-cap / geometry gate";
    console.log(`    ${pad(tk, 8)}${pad(c.direction, 6)}str ${padL(c.score, 3)}   ${verdict}`);
  }

  // ── FINAL PLAYS ──
  console.log(`\n${line()}`);
  console.log(`  0DTE PLAYS THAT CLEAR ALL GATES  (${survivors.length}; production publishes the first ${DETERMINISTIC_EDITION_TARGET})`);
  console.log(line());
  if (!survivors.length) {
    console.log(`    (none survived — see funnel above for the gate that emptied the board)`);
  }
  survivors.forEach((p, i) => {
    const tag = i < DETERMINISTIC_EDITION_TARGET ? "★ PUBLISHED" : "· bench";
    console.log(`\n    ${tag}  ● ${p.ticker}  ${p.direction}  [${p.conviction}]  score ${p.score}${p.rr_ratio ? `  R:R ${p.rr_ratio}` : ""}`);
    console.log(`      contract : ${p.options_play}${p.entry_premium != null ? `  (~$${p.entry_premium}/sh, $${p.entry_cost_per_contract ?? Math.round(p.entry_premium * 100)}/lot)` : ""}`);
    console.log(`      entry    : ${p.entry_range}`);
    console.log(`      target   : ${p.target}    stop: ${p.stop}`);
    console.log(`      signal   : ${p.key_signal}`);
  });

  console.log(`\n${line("═")}`);
  console.log(`  SUMMARY: ${flowRows.length} alerts/${flowDays.size}d → ${ranked.length} directional tickers → ${plays.length} gate-passers → ${survivors.length} ≤${MAX_DTE}DTE → ${published.length} published`);
  console.log(line("═"));

  if (EMIT_JSON) {
    console.log("\n<<<JSON>>>");
    console.log(JSON.stringify({
      asOf: asOfLabel, flow: { alerts: flowRows.length, days: [...flowDays].sort(), tickers: flowTickers.size },
      funnel, builtCount: plays.length, survivorCount: survivors.length, publishedCount: published.length,
      plays: survivors.map((p, i) => ({ published: i < DETERMINISTIC_EDITION_TARGET, ticker: p.ticker, direction: p.direction, conviction: p.conviction, score: p.score, options_play: p.options_play, entry_premium: p.entry_premium, entry_range: p.entry_range, target: p.target, stop: p.stop, rr_ratio: p.rr_ratio })),
    }, null, 2));
  }
} else {
  // ── BACKTEST GRADE MODE ──
  console.log(`\n[3] BACKTEST GRADE — minute-bar outcome of each magnet play on ${GRADE_DATE}`);
  console.log(`    rules: stop ${PLAN_RULES.stop_pct}% · target +${PLAN_RULES.target_pct}% · time-stop ${Math.floor(PLAN_RULES.time_stop_et_minutes / 60)}:${String(PLAN_RULES.time_stop_et_minutes % 60).padStart(2, "0")} ET`);
  console.log(line());

  // Grade only the production board (top-N directional candidates) — that's what would actually
  // have been published and traded that day.
  const toGrade = scoredCandidates.filter((c) => c.score >= 35).slice(0, DETERMINISTIC_EDITION_TARGET * 2);
  const results = [];
  for (const c of toGrade) {
    const side = c.direction === "long" ? "call" : "put";
    const spot = await spotAtEntryOnDate(c.ticker, GRADE_DATE);
    if (spot == null) {
      results.push({ ticker: c.ticker, side, outcome: "no_data", note: "no underlying bars" });
      continue;
    }
    const atm = await probeAtm0dte(c.ticker, GRADE_DATE, side, spot);
    if (!atm) {
      results.push({ ticker: c.ticker, side, spot, outcome: "no_0dte", note: "no 0DTE contract (non-daily-expiry name)" });
      continue;
    }
    const entryBar = atm.bars.find((b) => etMinOfBar(b.t) >= ENTRY_ET_MIN) ?? atm.bars[0];
    const entryPremium = entryBar.c;
    const grade = gradePlanFromBars(atm.bars, entryPremium, entryBar.t);
    // MFE / green-exit availability: the BEST (mfe) and WORST (mae) the contract ever marked after
    // entry, RTH-capped at 16:00 ET (bars are extended-hours; a 0DTE option is done at the PM close).
    // mfe answers "could this play EVER have been sold green, and by how much?" — the never-red goal.
    let mfe = 0, mae = 0;
    for (const b of atm.bars) {
      if (b.t < entryBar.t || etMinOfBar(b.t) > 960) continue;
      const up = ((b.h - entryPremium) / entryPremium) * 100;
      const dn = ((b.l - entryPremium) / entryPremium) * 100;
      if (up > mfe) mfe = up;
      if (dn < mae) mae = dn;
    }
    // Grade the SAME play through the SHIPPED ratchet exit engine (evaluateExitState) — the exit the
    // board actually runs — so we measure realized EV under the live rule, not just hold-to-stop/target.
    const planStop = entryPremium * (1 + PLAN_RULES.stop_pct / 100);
    const planTarget = entryPremium * (1 + PLAN_RULES.target_pct / 100);
    const rex = gradeThroughExitEngine(atm.bars, entryPremium, planStop, planTarget, entryBar.t);
    // Offline ratchet-param sweep: dump the RTH bar path + plan levels so many exit configs can be
    // graded without re-fetching (RATCHET_DUMP=<path>). Diagnostic only, off unless the env is set.
    if (process.env.RATCHET_DUMP) {
      const rth = atm.bars.filter((b) => b.t >= entryBar.t && etMinOfBar(b.t) <= 960).map((b) => ({ t: b.t, h: b.h, l: b.l, c: b.c }));
      if (rth.length) appendFileSync(process.env.RATCHET_DUMP, JSON.stringify({ date: GRADE_DATE, ticker: c.ticker, entry: entryPremium, planStop, planTarget, bars: rth }) + "\n");
    }
    results.push({ ticker: c.ticker, occ: atm.occ, side, strike: atm.strike, spot, entryPremium, outcome: grade.outcome, pnl_pct: grade.pnl_pct, mfe_pct: Math.round(mfe * 10) / 10, mae_pct: Math.round(mae * 10) / 10, ratchet_pnl_pct: rex?.pnl_pct ?? null, ratchet_outcome: rex?.outcome ?? null });
  }

  console.log(`    ${pad("TICKER", 8)}${pad("SIDE", 6)}${padL("STRIKE", 7)}${padL("ENTRY$", 8)}  ${pad("OUTCOME", 12)}${padL("P/L%", 8)}  contract`);
  console.log(`    ${line("·", 88)}`);
  for (const r of results) {
    if (r.outcome === "no_data" || r.outcome === "no_0dte") {
      console.log(`    ${pad(r.ticker, 8)}${pad(r.side ?? "—", 6)}${padL("—", 7)}${padL("—", 8)}  ${pad(r.outcome, 12)}${padL("—", 8)}  ${r.note ?? ""}`);
      continue;
    }
    console.log(
      `    ${pad(r.ticker, 8)}${pad(r.side, 6)}${padL(r.strike, 7)}${padL(r.entryPremium?.toFixed(2) ?? "—", 8)}  ${pad(r.outcome, 12)}${padL(r.pnl_pct ?? "—", 8)}  ${r.occ}`
    );
  }

  const graded = results.filter((r) => r.outcome && !["no_data", "no_0dte", "ungradeable"].includes(r.outcome));
  const wins = graded.filter((r) => r.outcome === "doubled").length;
  const stops = graded.filter((r) => r.outcome === "stopped").length;
  const times = graded.filter((r) => r.outcome === "time_stop").length;
  const avgPnl = graded.length ? graded.reduce((s, r) => s + (r.pnl_pct ?? 0), 0) / graded.length : null;
  // Green-exit availability: of the plays printed, how many EVER offered a +X% sell (MFE), and how
  // many never traded green at all (the irreducible instant-loser tail). This is the "never red" lens.
  const withMfe = graded.filter((r) => r.mfe_pct != null);
  const availAt = (x) => (withMfe.length ? (withMfe.filter((r) => r.mfe_pct >= x).length / withMfe.length) * 100 : null);
  const neverGreen = withMfe.length ? (withMfe.filter((r) => r.mfe_pct <= 0).length / withMfe.length) * 100 : null;
  const pctOr = (v) => (v == null ? "—" : v.toFixed(0) + "%");
  // Realized EV under the SHIPPED ratchet exit engine (evaluateExitState) vs the hold-to-stop/target
  // plan grade — the load-bearing comparison: does the live ratchet/trim/flat exit beat holding?
  const withRex = graded.filter((r) => r.ratchet_pnl_pct != null);
  const rexWin = withRex.length ? (withRex.filter((r) => r.ratchet_pnl_pct > 0).length / withRex.length) * 100 : null;
  const rexAvg = withRex.length ? withRex.reduce((s, r) => s + r.ratchet_pnl_pct, 0) / withRex.length : null;
  const planAvgOnRex = withRex.length ? withRex.reduce((s, r) => s + (r.pnl_pct ?? 0), 0) / withRex.length : null;
  console.log(`\n${line("═")}`);
  console.log(`  BACKTEST ${GRADE_DATE}: ${graded.length} gradeable plays · ${wins} doubled · ${stops} stopped · ${times} time-stop`);
  console.log(`  win-rate ${graded.length ? ((wins / graded.length) * 100).toFixed(1) : "—"}% · avg P/L ${avgPnl != null ? avgPnl.toFixed(1) + "%" : "—"} · ${results.length - graded.length} no-data/ungradeable`);
  console.log(`  RATCHET EXIT (shipped engine): win ${rexWin != null ? rexWin.toFixed(1) + "%" : "—"} · avg P/L ${rexAvg != null ? rexAvg.toFixed(1) + "%" : "—"}  (vs hold ${planAvgOnRex != null ? planAvgOnRex.toFixed(1) + "%" : "—"} on same n=${withRex.length})`);
  console.log(`  GREEN-EXIT AVAILABILITY (MFE): +10% ${pctOr(availAt(10))} · +25% ${pctOr(availAt(25))} · +50% ${pctOr(availAt(50))} · +100% ${pctOr(availAt(100))} · NEVER-green ${pctOr(neverGreen)}`);
  console.log(line("═"));

  if (EMIT_JSON) {
    console.log("\n<<<JSON>>>");
    console.log(JSON.stringify({ gradeDate: GRADE_DATE, results, summary: { gradeable: graded.length, wins, stops, times, avgPnl, ratchet_win: rexWin, ratchet_avg_pnl: rexAvg, plan_avg_on_rex: planAvgOnRex, green_avail_10: availAt(10), green_avail_25: availAt(25), green_avail_50: availAt(50), green_avail_100: availAt(100), never_green: neverGreen } }, null, 2));
  }
}
