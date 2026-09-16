/**
 * 0DTE 65-69 BAND CORROBORATION OUTCOME A/B — does a well-corroborated score-68 setup grade the
 * same as a weakly-corroborated one, or is G-17's flat "no admission path" for the whole 65-69
 * band throwing away real winners?
 * ============================================================================================
 *
 * WHY THIS EXISTS (2026-09-16, live operator observation)
 * ----------------------------------------------------------
 * `gates.ts` G-17 (`single_rail_corroboration`) rejects EVERY FLOW-origin setup scoring 65-69
 * unconditionally, with no corroboration check in that branch at all — live-verified same day:
 * TSLA scored 68 with all three rails fired (FLOW+MOMENTUM+CATALYST), triple-confirmed confluence
 * (timing+VWAP+market), HELIX and VECTOR both "aligned" — and was blocked outright, `rank_tier:
 * "WATCH"`, no path to commit. The gate's own 2026-09-09 rationale (measured 2026-08-28) is that
 * "multi-rail/FLOW in 65-74 ran 35.7% WR" — but that measurement only tested whether the 70-74
 * sub-band could be conditionally admitted with confluence; it never isolated whether a
 * GENUINELY well-corroborated 65-69 setup performs differently from a weakly-corroborated one.
 * The 65-69 reject was left flat "because no evidence supports admitting it under any condition"
 * — absence of evidence, not evidence of absence, for the well-corroborated slice specifically.
 *
 * This tool closes that gap: pulls the real historical 65-69-band FLOW-origin setup population,
 * splits by corroboration strength (rails fired count, confluence tier), and grades each via the
 * SAME −50%/+100%/15:50-time-stop payoff G-3's own floor was calibrated against (`gradePlanFromBars`,
 * `plan.ts` — unmodified production grader) on real Polygon 0DTE minute bars.
 *
 * WHAT'S REAL vs. APPROXIMATED (same disclosure discipline as zerodte-gate-compound-funnel.mjs)
 * -----------------------------------------------------------------------------------------------
 * REAL: deriveZeroDteSetups + score formula (board.ts), computeIntradayRead/marketBias (intraday.ts,
 * fed real Polygon minute bars), computeConfluence (confluence.ts), attachThesisFirstLive
 * (thesis/live-pipeline.ts — the EXACT function scan.ts calls live, gives real rail_scores/
 * rails_fired/confluence), gradePlanFromBars + PLAN_RULES (plan.ts — the real −50/+100/time-stop
 * grader), real UW flow-alerts (direct REST, same disclosed swap as every sibling A/B tool in this
 * toolkit — Postgres is blocked from this sandbox).
 * APPROXIMATED: contract selection walks a small ATM strike ladder for the FIRST liquid 0DTE
 * contract that actually traded that day (`probeAtm0dte`, copied verbatim from zerodte-sim.mjs) —
 * not necessarily byte-identical to whichever specific contract `pickChainContract` would have
 * picked live, but the same selection PRINCIPLE (nearest tradeable ATM 0DTE strike).
 * NOT MEASURED: the rest of the gate stack (G-1..G-23) is not evaluated here — a setup landing in
 * 65-69 may also have been blocked by an unrelated gate live; this tool asks only "does raw score +
 * corroboration in this band predict forward P&L," not "would this specific setup have committed."
 *
 * Usage:
 *   node --import tsx scripts/audit/zerodte-6569-corroboration-outcome-ab.mjs [options]
 * Flags: --days=N (default 10, trading days back, excludes today — unresolved) --min-premium=N
 *        --max-tickers=N (per day) --min-n=N (default 5, per-bucket disclosure floor) --json
 * Self-defaults POLYGON_API_BASE. Run with `env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY`.
 */

if (!process.env.POLYGON_API_BASE || !/^https?:\/\//.test(process.env.POLYGON_API_BASE)) {
  process.env.POLYGON_API_BASE = "https://api.massive.com";
}
process.env.ZERODTE_THESIS_FIRST = "1";

const SRC = new URL("../../src/", import.meta.url).pathname;

const argv = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    return m ? [m[1], m[2] ?? "true"] : [a, "true"];
  })
);
const DAYS = Math.max(1, Number(argv.days ?? 10));
const MIN_PREMIUM = Math.max(0, Number(argv["min-premium"] ?? 250_000));
const MAX_TICKERS = Math.max(1, Number(argv["max-tickers"] ?? 60));
const MIN_N = Math.max(1, Number(argv["min-n"] ?? 5));
const EMIT_JSON = Boolean(argv.json);

const { fetchMarketFlowAlertRows } = await import(`${SRC}lib/providers/unusual-whales.ts`);
const { extractChainFieldsFromRaw } = await import(`${SRC}lib/flow-raw-fields.ts`);
const { dteFromExpiry } = await import(`${SRC}lib/flow-dte.ts`);
const { deriveZeroDteSetups } = await import(`${SRC}lib/zerodte/board.ts`);
const { computeConfluence } = await import(`${SRC}lib/zerodte/confluence.ts`);
const { computeIntradayRead, marketBias, intradayScoreAdjust } = await import(
  `${SRC}lib/zerodte/intraday.ts`
);
const { fetchStockMinuteBars } = await import(`${SRC}lib/providers/polygon.ts`);
const { fetchAggBars } = await import(`${SRC}lib/providers/polygon-largo.ts`);
const { attachThesisFirstLive } = await import(`${SRC}lib/zerodte/thesis/live-pipeline.ts`);
const { gradePlanFromBars, PLAN_RULES } = await import(`${SRC}lib/zerodte/plan.ts`);

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
const ENTRY_ET_MIN = 9 * 60 + 45;
function occSymbol(ticker, expiryYmd, side, strike) {
  const yymmdd = expiryYmd.slice(2).replace(/-/g, "");
  const cp = side === "put" ? "P" : "C";
  const strikeInt = String(Math.round(strike * 1000)).padStart(8, "0");
  return `O:${ticker.toUpperCase()}${yymmdd}${cp}${strikeInt}`;
}
function strikeIncrement(spot) {
  if (spot < 25) return 0.5;
  if (spot < 100) return 1;
  if (spot < 250) return 2.5;
  return 5;
}
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

/** Fetch UW flow alerts within [startMs, endMs), paginating backward. */
async function fetchFlowWindow(endMs, startMs, minPremium) {
  const rows = [];
  const seen = new Set();
  let olderThan = new Date(endMs).toISOString();
  const MAX_PAGES = 24;
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
      if (Number.isFinite(ms) && ms >= startMs && ms < endMs) rows.push(mr);
    }
    if (!oldestIso || oldestMs === Infinity) break;
    if (oldestMs < startMs) break;
    if (oldestIso === olderThan) break;
    olderThan = oldestIso;
  }
  return rows;
}

// `confluence` lives at the top level of the setup object (computed and attached in the
// enrichment loop above), NOT nested under `thesis_first` — verified against a live board
// capture (2026-09-16 TSLA setup): `{ confluence: {tier: "triple", ...}, thesis_first: {thesis:
// {rails_fired: [...]}} }` are siblings, not thesis_first.confluence.
function corroborationBucket(setup) {
  const railsFired = setup?.thesis_first?.thesis?.rails_fired?.length ?? 0;
  const confluenceTier = setup?.confluence?.tier ?? null;
  return { railsFired, confluenceTier };
}

// gradePlanFromBars returns "doubled" (target hit), "stopped" (hard stop hit), "time_stop"
// (15:50 flat exit — could be net positive or negative), or "ungradeable" (no bars in window).
// A win is any positive realized P&L (matches record.ts's isZeroDteWin convention — "doubled" is
// always positive by construction, "time_stop" needs the sign checked, an exact 0% counts as a
// loss/non-win, same "breakeven is not a win" convention this repo's own graders use elsewhere).
function summarizeBucket(rows) {
  const graded = rows.filter((r) => r.outcome === "doubled" || r.outcome === "stopped" || r.outcome === "time_stop");
  const wins = graded.filter((r) => (r.pnlPct ?? 0) > 0).length;
  const n = graded.length;
  const avgPnl = n ? graded.reduce((s, r) => s + (r.pnlPct ?? 0), 0) / n : null;
  return { n, wins, wr: n ? (wins / n) * 100 : null, avgPnl };
}

// ── MAIN ─────────────────────────────────────────────────────────────────────────
const nowMs = Date.now();
const today = etYmd(nowMs);

console.log(line("═"));
console.log(`  0DTE 65-69 BAND CORROBORATION OUTCOME A/B`);
console.log(`  ${DAYS} trading days back (excludes today) · min premium ${fmtUsd(MIN_PREMIUM)} · cap ${MAX_TICKERS} tickers/day`);
console.log(line("═"));

// Build the list of ET trading days to scan (weekdays only — a cheap proxy, doesn't account for
// market holidays; a holiday day will just come back with zero flow and is skipped cleanly).
const days = [];
{
  let cursorMs = nowMs - 24 * 60 * 60 * 1000;
  while (days.length < DAYS) {
    const dow = new Date(cursorMs).getUTCDay();
    const ymd = etYmd(cursorMs);
    if (dow !== 0 && dow !== 6 && ymd !== today) days.push(ymd);
    cursorMs -= 24 * 60 * 60 * 1000;
  }
}
console.log(`\n  Days to scan: ${days.slice().reverse().join(", ")}`);

const allRows = [];
let scannedDays = 0;
let daysWithSetups = 0;

for (const day of days.slice().reverse()) {
  const dayStartMs = Date.parse(`${day}T00:00:00-04:00`);
  const dayEndMs = Date.parse(`${day}T20:00:00-04:00`);
  process.stdout.write(`\n  [${day}] fetching flow… `);
  const mrows = await fetchFlowWindow(dayEndMs, dayStartMs, MIN_PREMIUM);
  process.stdout.write(`${mrows.length} alerts`);
  if (!mrows.length) { console.log("  — skip (no flow, likely a holiday)"); continue; }
  scannedDays++;

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

  const rejections = [];
  const rawSetups = deriveZeroDteSetups(flowRows, {
    maxSetups: MAX_TICKERS,
    nowMs: dayEndMs,
    todayYmd: day,
    rejections,
  });
  if (!rawSetups.length) { console.log("  — 0 setups survived evidence gates"); continue; }

  const vixBar = await fetchAggBars("I:VIX", 1, "day", day, day).catch(() => []);
  const vixDayOpen = Array.isArray(vixBar) && vixBar[0]?.o != null ? Number(vixBar[0].o) : null;
  const spyBars = await fetchStockMinuteBars("SPY", day, day).catch(() => []);
  const spyRead = computeIntradayRead((spyBars ?? []).map((b) => ({ t: b.t, h: b.h, l: b.l, c: b.c, v: b.v })));
  const bias = marketBias(spyRead);
  const dayEtMinutes = 660; // fixed 11:00 ET scan-time proxy for gate-clock-sensitive thesis notes

  const enriched = [];
  for (const s of rawSetups) {
    const bars = await fetchStockMinuteBars(s.ticker, day, day).catch(() => []);
    const read = (bars ?? []).length ? computeIntradayRead(bars.map((b) => ({ t: b.t, h: b.h, l: b.l, c: b.c, v: b.v }))) : null;
    const marketAligned = bias == null || bias === "flat" ? null : (bias === "up") === (s.direction === "long");
    const conflict = read ? intradayScoreAdjust(s.direction, read).conflict : false;
    const setupForConfluence = { direction: s.direction, intraday: read, market_aligned: marketAligned };
    const confluence = computeConfluence(setupForConfluence, dayEtMinutes);
    s.confluence = confluence;
    s.market_aligned = marketAligned;
    s.gamma_regime = s.gamma_regime ?? null;
    enriched.push(s);
  }

  attachThesisFirstLive(enriched, dayEtMinutes);

  const band = enriched.filter((s) => s.score >= 65 && s.score < 70);
  console.log(`  — ${rawSetups.length} setups total, ${band.length} in the 65-69 band`);
  if (!band.length) continue;
  daysWithSetups++;

  for (const s of band) {
    const side = s.direction === "long" ? "call" : "put";
    const spot = s.underlying_price ?? null;
    if (spot == null) { allRows.push({ ticker: s.ticker, day, outcome: "no_data" }); continue; }
    const atm = await probeAtm0dte(s.ticker, day, side, spot);
    if (!atm) { allRows.push({ ticker: s.ticker, day, outcome: "no_0dte" }); continue; }
    const entryBar = atm.bars.find((b) => etMinutesOf(b.t) >= ENTRY_ET_MIN) ?? atm.bars[0];
    const entryPremium = entryBar.c;
    const grade = gradePlanFromBars(atm.bars, entryPremium, entryBar.t);
    const { railsFired, confluenceTier } = corroborationBucket(s);
    allRows.push({
      ticker: s.ticker,
      day,
      score: s.score,
      direction: s.direction,
      railsFired,
      confluenceTier,
      outcome: grade.outcome,
      pnlPct: grade.pnl_pct,
    });
  }
}

// ── REPORT ──
console.log(`\n${line("═")}`);
console.log(`  RESULT — ${scannedDays} days with flow, ${daysWithSetups} with a 65-69-band setup, ${allRows.length} candidates graded`);
console.log(`  Payoff rules (same as production G-3 calibration): stop ${PLAN_RULES.stop_pct}% · target +${PLAN_RULES.target_pct}% · time-stop ${Math.floor(PLAN_RULES.time_stop_et_minutes / 60)}:${String(PLAN_RULES.time_stop_et_minutes % 60).padStart(2, "0")} ET`);
console.log(line("═"));

const noData = allRows.filter((r) => r.outcome === "no_data" || r.outcome === "no_0dte").length;
console.log(`\n  Ungraded (no underlying price / no tradeable 0DTE contract that day): ${noData}`);

const aggregate = summarizeBucket(allRows);
console.log(`\n  AGGREGATE (all 65-69-band setups): n=${aggregate.n}${aggregate.n < MIN_N ? " [THIN, below --min-n]" : ""}  WR=${aggregate.wr?.toFixed(1) ?? "—"}%  avgP&L=${aggregate.avgPnl?.toFixed(1) ?? "—"}%`);

console.log(`\n  BY CORROBORATION STRENGTH (rails fired):`);
const singleRail = allRows.filter((r) => r.railsFired != null && r.railsFired <= 1);
const multiRail = allRows.filter((r) => r.railsFired != null && r.railsFired >= 2);
for (const [label, rows] of [["single-rail (≤1 rail fired)", singleRail], ["multi-rail (≥2 rails fired)", multiRail]]) {
  const sm = summarizeBucket(rows);
  console.log(`    ${pad(label, 32)} n=${padL(sm.n, 3)}${sm.n < MIN_N ? " [THIN]" : "      "}  WR=${sm.wr != null ? sm.wr.toFixed(1) + "%" : "—"}  avgP&L=${sm.avgPnl != null ? sm.avgPnl.toFixed(1) + "%" : "—"}`);
}

console.log(`\n  BY CONFLUENCE TIER:`);
const tiers = [...new Set(allRows.map((r) => r.confluenceTier).filter(Boolean))];
for (const tier of tiers) {
  const rows = allRows.filter((r) => r.confluenceTier === tier);
  const sm = summarizeBucket(rows);
  console.log(`    ${pad(tier, 32)} n=${padL(sm.n, 3)}${sm.n < MIN_N ? " [THIN]" : "      "}  WR=${sm.wr != null ? sm.wr.toFixed(1) + "%" : "—"}  avgP&L=${sm.avgPnl != null ? sm.avgPnl.toFixed(1) + "%" : "—"}`);
}

console.log(`\n  VERDICT:`);
if (aggregate.n < MIN_N) {
  console.log(`    INSUFFICIENT DATA — only ${aggregate.n} graded candidates total (need ≥${MIN_N}). Re-run with more --days.`);
} else {
  const smSingle = summarizeBucket(singleRail);
  const smMulti = summarizeBucket(multiRail);
  if (smSingle.n < MIN_N || smMulti.n < MIN_N) {
    console.log(`    INSUFFICIENT DATA per-bucket to compare corroboration strength (single-rail n=${smSingle.n}, multi-rail n=${smMulti.n}, need ≥${MIN_N} each). Aggregate above is the only readable number this run.`);
  } else {
    const delta = (smMulti.wr ?? 0) - (smSingle.wr ?? 0);
    console.log(`    Multi-rail vs single-rail WR delta: ${delta >= 0 ? "+" : ""}${delta.toFixed(1)}pp (multi ${smMulti.wr.toFixed(1)}% vs single ${smSingle.wr.toFixed(1)}%).`);
    console.log(`    ${Math.abs(delta) >= 15 ? "This is a real separation — worth a fix PR carving a conditional admission path for well-corroborated 65-69 setups." : "Not a clean separation at this sample size — the flat 65-69 reject is not obviously wrong on this evidence."}`);
  }
}

if (EMIT_JSON) {
  console.log("\n<<<JSON>>>");
  console.log(JSON.stringify({ scannedDays, daysWithSetups, rows: allRows, aggregate, singleRail: summarizeBucket(singleRail), multiRail: summarizeBucket(multiRail) }, null, 2));
}
