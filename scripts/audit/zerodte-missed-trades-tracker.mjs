/**
 * 0DTE MISSED-TRADES / FALSE-ALERTS TRACKER — real win rate, avg gain/loss, drawdown,
 * missed trades, and false alerts, under REALISTIC costs, with an explicit TRAIN/VALIDATION split.
 * ============================================================================================
 * WHY THIS EXISTS (2026-10-20, member directive: "keep pushing toward catching Swift-style
 * setups early and consistently... track missed trades, false alerts, win rate, average gains
 * and losses, and drawdown after realistic spreads and slippage... validate improvements on
 * unseen data... don't force daily trades, weaken risk controls, or overfit")
 * ------------------------------------------------------------------------------------------
 * Two prior tools in this toolkit each did HALF of this:
 *   - zerodte-gate-rejection-trace.mjs: per-setup, point-in-time (no look-ahead) gate verdicts —
 *     but only reports WHICH gate blocked a setup, never what would have HAPPENED to it.
 *   - zerodte-confluence-floor-real-cost-backtest.mjs: real option premium + real spread +
 *     realistic entry delay grading — but only for a confluence-tier A/B question, and only ever
 *     graded setups that already survived the evidence gates (never asked what the BLOCKED ones
 *     would have done).
 * This tool combines both: for EVERY real FLOW-origin setup in the window — committed AND
 * blocked alike — it determines the real point-in-time gate verdict AND grades the real forward
 * outcome under realistic costs. That lets it answer the actual question "catching setups early
 * and consistently" needs answered: of what the board actually committed, what was the REAL win
 * rate/avg gain/avg loss/drawdown (false alerts = real losers); of what it blocked, how many
 * would ACTUALLY have been winners (missed trades) vs. were correctly avoided.
 *
 * TRAIN/VALIDATION SPLIT (explicit, per the "validate on unseen data... don't overfit"
 * instruction): the window is split chronologically in half — OLDER half = TRAIN (look for
 * patterns here), NEWER half = VALIDATION (the held-out check). A pattern that only shows up in
 * TRAIN is NOT reported as a finding — this script prints both halves separately and never
 * blends them into one number that could hide a TRAIN-only artifact.
 *
 * WHAT'S REAL vs. APPROXIMATED (identical disclosure to the two tools above — see their headers):
 * REAL: deriveZeroDteSetups, evaluateZeroDteGates, computeConfluence/computeIntradayRead, the
 *   setup's own strike/expiry, real Polygon NBBO quotes + option minute bars, PLAN_RULES -50/+100.
 * APPROXIMATED: G-5/G-6/G-7/G-8/G-9(plan-quality)/G-11/G-20/G-21/G-23/Cortex veto are NOT
 *   measured (same scope as zerodte-gate-compound-funnel.mjs — this can only ever OVER-count
 *   "would have committed," never under-count); stop/target touch is bar-close-resolution on the
 *   walk-forward leg; ENTRY_DELAY_SEC is one fixed assumption, not a measured distribution.
 *
 * THIS SCRIPT NEVER CHANGES A GATE OR THRESHOLD. Evidence-gathering only.
 *
 * USAGE
 *   POLYGON_API_BASE=https://api.massive.com \
 *   env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY \
 *   node --import tsx scripts/audit/zerodte-missed-trades-tracker.mjs [options]
 * OPTIONS
 *   --days=N            multi-day flow lookback (default 20 — split in half TRAIN/VALIDATION)
 *   --min-premium=N     min alert premium (default 250000)
 *   --max-setups=N      cap on setups graded PER HALF (default 30)
 *   --entry-delay=SEC   realistic entry delay in seconds (default 90)
 *   --hold-minutes=N    max holding window in minutes (default 90)
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
const DAYS = Math.max(2, Number(argv.days ?? 20));
const MIN_PREMIUM = Math.max(0, Number(argv["min-premium"] ?? 250_000));
const MAX_SETUPS_PER_HALF = Math.max(1, Number(argv["max-setups"] ?? 30));
const ENTRY_DELAY_SEC = Math.max(0, Number(argv["entry-delay"] ?? 90));
const HOLD_MINUTES = Math.max(5, Number(argv["hold-minutes"] ?? 90));
const EMIT_JSON = Boolean(argv.json);

const { fetchMarketFlowAlertRows } = await import(`${SRC}lib/providers/unusual-whales.ts`);
const { extractChainFieldsFromRaw } = await import(`${SRC}lib/flow-raw-fields.ts`);
const { dteFromExpiry } = await import(`${SRC}lib/flow-dte.ts`);
const { deriveZeroDteSetups } = await import(`${SRC}lib/zerodte/board.ts`);
const { evaluateZeroDteGates } = await import(`${SRC}lib/zerodte/gates.ts`);
const { computeConfluence } = await import(`${SRC}lib/zerodte/confluence.ts`);
const { computeIntradayRead, marketBias, intradayScoreAdjust } = await import(`${SRC}lib/zerodte/intraday.ts`);
const { fetchStockMinuteBars, fetchOptionMinuteBars } = await import(`${SRC}lib/providers/polygon.ts`);
const { fetchAggBars } = await import(`${SRC}lib/providers/polygon-largo.ts`);
const { PLAN_RULES } = await import(`${SRC}lib/zerodte/plan.ts`);

const POLYGON_BASE = process.env.POLYGON_API_BASE;
const POLYGON_KEY = process.env.POLYGON_API_KEY;

const fmtUsd = (n) => (n == null ? "—" : n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(0)}k` : `$${n.toFixed(0)}`);
const pad = (s, w) => String(s).padEnd(w);
const padL = (s, w) => String(s).padStart(w);
const line = (c = "─", w = 112) => c.repeat(w);
function etYmd(ms) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
}
function etClock(ms) {
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(ms));
}
function etMinutesOf(ms) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "numeric", hour12: false }).formatToParts(new Date(ms));
  return Number(parts.find((p) => p.type === "hour")?.value ?? 0) * 60 + Number(parts.find((p) => p.type === "minute")?.value ?? 0);
}
function buildOcc(ticker, expiryYmd, direction, strike) {
  const [y, m, d] = expiryYmd.split("-");
  const cp = direction === "long" ? "C" : "P";
  const strikeStr = String(Math.round(strike * 1000)).padStart(8, "0");
  return `O:${ticker}${y.slice(2)}${m}${d}${cp}${strikeStr}`;
}
async function fetchQuoteNear(occ, atMs, windowMs = 120_000) {
  const from = (atMs - windowMs) * 1e6;
  const to = (atMs + windowMs) * 1e6;
  const url = `${POLYGON_BASE}/v3/quotes/${encodeURIComponent(occ)}?timestamp.gte=${from}&timestamp.lte=${to}&order=asc&limit=50000&apiKey=${POLYGON_KEY}`;
  const res = await fetch(url);
  const data = await res.json().catch(() => null);
  if (!data?.results?.length) return null;
  let best = null;
  let bestDiff = Infinity;
  for (const q of data.results) {
    const t = Math.floor(q.sip_timestamp / 1e6);
    const diff = Math.abs(t - atMs);
    if (diff < bestDiff) { bestDiff = diff; best = q; }
  }
  return best ? { bid: best.bid_price, ask: best.ask_price } : null;
}

async function fetchMultiDayFlow(endMs, days, minPremium) {
  const cutoffMs = endMs - days * 86_400_000;
  const rows = [];
  const seen = new Set();
  let olderThan = new Date(endMs).toISOString();
  for (let page = 0; page < 32; page++) {
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

const nowMs = Date.now();
console.log(line("═"));
console.log(`  0DTE MISSED-TRADES / FALSE-ALERTS TRACKER — real costs, point-in-time, TRAIN/VALIDATION split`);
console.log(`  window ${DAYS}d · min premium ${fmtUsd(MIN_PREMIUM)} · cap ${MAX_SETUPS_PER_HALF} setups/half · entry delay ${ENTRY_DELAY_SEC}s · hold ${HOLD_MINUTES}min`);
console.log(line("═"));

console.log(`\n[1] Fetching multi-day UW flow…`);
const mrows = await fetchMultiDayFlow(nowMs, DAYS, MIN_PREMIUM);
console.log(`    ${mrows.length} raw alerts`);

const byDay = new Map();
for (const mr of mrows) {
  const f = mr.flow;
  const raw = mr.raw ?? {};
  if (!f?.ticker || !f.option_type || f.option_type === "UNKNOWN") continue;
  const chain = extractChainFieldsFromRaw(raw, { strike: f.strike, option_type: f.option_type });
  const alertMs = Date.parse(f.alerted_at ?? "");
  if (!Number.isFinite(alertMs)) continue;
  const day = etYmd(alertMs);
  const row = {
    ticker: f.ticker, premium: f.premium, option_type: f.option_type, strike: f.strike, expiry: f.expiry,
    dte: f.expiry ? dteFromExpiry(f.expiry) ?? undefined : undefined,
    alert_rule: chain.alert_rule ?? f.alert_rule ?? undefined, ask_pct: chain.ask_pct,
    underlying_price: chain.underlying_price, fill_price: chain.fill_price, open_interest: chain.open_interest,
    alerted_at: f.alerted_at,
  };
  (byDay.get(day) ?? byDay.set(day, []).get(day)).push(row);
}
const sortedDays = [...byDay.keys()].sort();
console.log(`    spread across ${sortedDays.length} session days: ${sortedDays.join(", ")}`);
if (sortedDays.length < 2) {
  console.log("\n  Fewer than 2 session days in window — cannot split TRAIN/VALIDATION. Widen --days.");
  process.exit(0);
}
const splitIdx = Math.ceil(sortedDays.length / 2);
const trainDays = new Set(sortedDays.slice(0, splitIdx));
const validationDays = new Set(sortedDays.slice(splitIdx));
console.log(`    TRAIN (older): ${[...trainDays].join(", ")}`);
console.log(`    VALIDATION (newer, held-out): ${[...validationDays].join(", ")}`);

console.log(`\n[2] Tracing each ticker/direction across EVERY one of its own real print instants (no look-ahead on EITHER the evidence gates or the hard gates)…`);
// CORRECTNESS NOTE (caught live building this script, 2026-10-20): deriveZeroDteSetups
// AGGREGATES every row it's given into one scored setup per ticker/direction for "today" — so
// calling it once with the WHOLE day's rows (as an earlier version of this tool, and the
// original zerodte-gate-rejection-trace.mjs, both did) silently leaks every LATER print into the
// evidence-gate math (score/gross_premium/aggr_share/dominance/max_itm_pct) used to judge an
// EARLIER decision instant. Caught via a real discrepancy: production committed TSLA 2026-10-19
// at 10:21 ET off a real score of 91, but a full-day-aggregated replica REJECTED it outright on
// max_itm_pct — because prints through 19:21 UTC pushed the aggregate OTM% past the threshold,
// a fact that didn't exist yet at 10:21 ET.
//
// A FIRST fix (still visible in this file's git history) stopped at finding the FIRST
// evidence-qualifying instant per ticker/direction — but that understates real conviction:
// re-testing against the same TSLA example, "first qualifying instant" landed at 09:31 ET
// score=44 (production's real commit was 10:21 ET score=91) — a real setup production's own
// continuous re-scanning legitimately would not have committed on, since gates can still block
// an early, low-score instant even once the evidence gates alone are satisfied. Fixed the same
// way zerodte-gate-rejection-trace.mjs was fixed: walk EVERY one of the ticker's own print
// instants, evaluate the FULL evaluateZeroDteGates stack at each (not just the evidence gates),
// and keep the EARLIEST instant that actually reaches COMMIT — or, if none ever does, the LAST
// (most mature) instant, which is the real, honest "never cleared gates even with its own full
// day of flow" case. The expensive per-day fetches (SPY bars, ticker bars, VIX) happen ONCE per
// ticker/day; only the pure recomputation (derive/confluence/gates) repeats per instant.
const vixByDate = new Map();
async function vixDayOpenFor(dateYmd) {
  if (vixByDate.has(dateYmd)) return vixByDate.get(dateYmd);
  const bar = await fetchAggBars("I:VIX", 1, "day", dateYmd, dateYmd).catch(() => []);
  const v = Array.isArray(bar) && bar[0]?.o != null ? Number(bar[0].o) : null;
  vixByDate.set(dateYmd, v);
  return v;
}

const allCandidates = [];
for (const day of sortedDays) {
  const rows = byDay.get(day);
  const byTickerDir = new Map();
  for (const r of rows) {
    const dir = r.option_type === "CALL" ? "long" : "short";
    const key = `${r.ticker}:${dir}`;
    (byTickerDir.get(key) ?? byTickerDir.set(key, []).get(key)).push(r);
  }
  const vixDayOpen = await vixDayOpenFor(day);
  for (const [key, tdRows] of byTickerDir) {
    const [ticker, dir] = key.split(":");
    const ownPrints = [...tdRows]
      .map((r) => Date.parse(r.alerted_at))
      .filter((ms) => Number.isFinite(ms))
      .sort((a, b) => a - b);
    if (!ownPrints.length) continue;

    // Expensive fetches ONCE per ticker/day — truncated per-instant below, never re-fetched.
    const spyBarsAll = await fetchStockMinuteBars("SPY", day, day).catch(() => []);
    const tkBarsAll = await fetchStockMinuteBars(ticker, day, day).catch(() => []);

    let best = null; // earliest COMMIT, if any
    let last = null; // last instant's result, if never COMMIT
    for (const cutoffMs of ownPrints) {
      const truncated = rows.filter((r) => (Date.parse(r.alerted_at) || Infinity) <= cutoffMs);
      const setups = deriveZeroDteSetups(truncated, { maxSetups: 200, nowMs: cutoffMs, todayYmd: day, rejections: [] });
      const s = setups.find((x) => x.ticker === ticker && x.direction === dir && x.expiry && x.top_strike);
      if (!s) continue;

      const decisionEtMinutes = etMinutesOf(cutoffMs);
      const spyBarsUpToNow = (spyBarsAll ?? []).filter((b) => b.t <= cutoffMs);
      const spyRead = computeIntradayRead(spyBarsUpToNow.map((b) => ({ t: b.t, h: b.h, l: b.l, c: b.c, v: b.v })));
      const bias = marketBias(spyRead);
      const tkBarsUpToNow = (tkBarsAll ?? []).filter((b) => b.t <= cutoffMs);
      const read = tkBarsUpToNow.length ? computeIntradayRead(tkBarsUpToNow.map((b) => ({ t: b.t, h: b.h, l: b.l, c: b.c, v: b.v }))) : null;
      const marketAligned = bias == null || bias === "flat" ? null : (bias === "up") === (s.direction === "long");
      const intradayConflict = read ? intradayScoreAdjust(s.direction, read).conflict : false;
      const confluence = computeConfluence({ direction: s.direction, intraday: read, market_aligned: marketAligned }, decisionEtMinutes);

      const verdict = evaluateZeroDteGates({
        ticker: s.ticker, direction: s.direction, score: s.score, discovery_origin: ["FLOW"],
        nowEtMinutes: decisionEtMinutes, nowMs: cutoffMs, bias, biasAsOfMs: spyRead.last_bar_ms ?? null,
        governor: { open_plans: [], stops: [] }, vixDayOpen, vixUnavailable: vixDayOpen == null,
        slayerLive: null, nighthawkTake: null, macroEvents: [], plan: null, deferPlanQualityGates: true,
        contractHorizon: "ZERO_DTE", intradayConflict, market_aligned: marketAligned,
        halted: false, haltFeedStale: false, earnings: null, earningsUnavailable: false, confluence,
      });

      const result = { setup: s, decisionMs: cutoffMs, verdict: verdict.verdict, blocks: verdict.blocks.map((b) => b.code) };
      last = result;
      if (verdict.verdict === "COMMIT") { best = result; break; }
    }
    const chosen = best ?? last;
    if (chosen) {
      allCandidates.push({
        setup: chosen.setup, day, decisionMs: chosen.decisionMs, verdict: chosen.verdict, blocks: chosen.blocks,
        half: trainDays.has(day) ? "TRAIN" : "VALIDATION",
      });
    }
    // Never qualified even with its OWN full day of prints → excluded (nothing to grade).
  }
}
allCandidates.sort((a, b) => a.decisionMs - b.decisionMs);
const trainSample = allCandidates.filter((c) => c.half === "TRAIN").slice(0, MAX_SETUPS_PER_HALF);
const validationSample = allCandidates.filter((c) => c.half === "VALIDATION").slice(0, MAX_SETUPS_PER_HALF);
console.log(`    ${allCandidates.length} total candidates — grading ${trainSample.length} TRAIN + ${validationSample.length} VALIDATION`);

async function gradeCandidate(c) {
  const { setup: s, day, decisionMs, verdict, blocks } = c;

  // Real forward outcome under realistic costs, REGARDLESS of verdict — this is what answers
  // "missed trade" (BLOCKED but would have won) vs "false alert" (COMMIT but lost). The gate
  // verdict itself was already determined point-in-time in phase [2] above (walking every one
  // of this ticker's own print instants) — never recomputed here against look-ahead-contaminated
  // inputs.
  const occ = buildOcc(s.ticker, s.expiry, s.direction, s.top_strike);
  const entryAtMs = decisionMs + ENTRY_DELAY_SEC * 1000;
  const entryQuote = await fetchQuoteNear(occ, entryAtMs);
  if (!entryQuote || !(entryQuote.bid > 0) || !(entryQuote.ask > 0)) {
    return { ticker: s.ticker, day, score: s.score, verdict, blocks, outcome: "NO_QUOTE" };
  }
  const entryPx = s.direction === "long" ? entryQuote.ask : entryQuote.bid;
  const timeStopMs = Date.parse(`${day}T19:50:00Z`);
  const holdEndMs = Math.min(entryAtMs + HOLD_MINUTES * 60_000, timeStopMs);
  const bars = await fetchOptionMinuteBars(occ, day, day).catch(() => []);
  const walkBars = bars.filter((b) => b.t > entryAtMs && b.t <= holdEndMs);
  const stopPx = entryPx * (1 + PLAN_RULES.stop_pct / 100);
  const targetPx = entryPx * (1 + PLAN_RULES.target_pct / 100);
  let exitPx = null;
  let exitReason = "time_stop";
  let exitAtMs = holdEndMs;
  for (const b of walkBars) {
    if (b.l <= stopPx) { exitPx = stopPx; exitReason = "stopped"; exitAtMs = b.t; break; }
    if (b.h >= targetPx) { exitPx = targetPx; exitReason = "target"; exitAtMs = b.t; break; }
  }
  if (exitPx == null) {
    const exitQuote = await fetchQuoteNear(occ, exitAtMs);
    if (!exitQuote || !(exitQuote.bid > 0) || !(exitQuote.ask > 0)) {
      return { ticker: s.ticker, day, score: s.score, verdict, blocks, outcome: "NO_EXIT_QUOTE" };
    }
    exitPx = exitQuote.bid;
  }
  const pnlPct = ((exitPx - entryPx) / entryPx) * 100;
  return {
    ticker: s.ticker, day, score: s.score, verdict, blocks,
    entryPx: Math.round(entryPx * 100) / 100, exitPx: Math.round(exitPx * 100) / 100,
    pnlPct: Math.round(pnlPct * 100) / 100, exitReason, outcome: pnlPct > 0 ? "WIN" : "LOSS",
  };
}

console.log(`\n[3] Grading TRAIN half…`);
const trainGraded = [];
for (const c of trainSample) {
  trainGraded.push(await gradeCandidate(c));
  await new Promise((r) => setTimeout(r, 250));
}
console.log(`\n[4] Grading VALIDATION half…`);
const validationGraded = [];
for (const c of validationSample) {
  validationGraded.push(await gradeCandidate(c));
  await new Promise((r) => setTimeout(r, 250));
}

function summarize(label, graded) {
  const gradeable = graded.filter((g) => g.outcome === "WIN" || g.outcome === "LOSS");
  const committed = gradeable.filter((g) => g.verdict === "COMMIT");
  const blocked = gradeable.filter((g) => g.verdict === "BLOCKED");
  const committedWins = committed.filter((g) => g.outcome === "WIN");
  const committedLosses = committed.filter((g) => g.outcome === "LOSS"); // false alerts
  const blockedWins = blocked.filter((g) => g.outcome === "WIN"); // missed trades
  const blockedLosses = blocked.filter((g) => g.outcome === "LOSS"); // correctly avoided

  // Max drawdown over the COMMITTED sequence, in chronological order, as a running sum of
  // realized P&L (a simple equity-curve proxy — real dollar sizing isn't modeled here).
  let running = 0, peak = 0, maxDd = 0;
  for (const g of committed) {
    running += g.pnlPct;
    peak = Math.max(peak, running);
    maxDd = Math.min(maxDd, running - peak);
  }

  console.log(`\n${line()}`);
  console.log(`  ${label}`);
  console.log(line());
  console.log(`    graded: ${gradeable.length}/${graded.length} (${graded.length - gradeable.length} ungradeable — no real quote/bar data, excluded, never fabricated)`);
  console.log(`    COMMITTED (what the board actually would have alerted): n=${committed.length}`);
  if (committed.length) {
    const winRate = (committedWins.length / committed.length) * 100;
    const avgGain = committedWins.length ? committedWins.reduce((s, g) => s + g.pnlPct, 0) / committedWins.length : null;
    const avgLoss = committedLosses.length ? committedLosses.reduce((s, g) => s + g.pnlPct, 0) / committedLosses.length : null;
    console.log(`      win rate: ${winRate.toFixed(1)}%  (${committedWins.length}W / ${committedLosses.length}L)`);
    console.log(`      avg gain (winners): ${avgGain != null ? avgGain.toFixed(1) + "%" : "—"}`);
    console.log(`      avg loss (losers / FALSE ALERTS): ${avgLoss != null ? avgLoss.toFixed(1) + "%" : "—"}`);
    console.log(`      max drawdown (running P&L, chronological): ${maxDd.toFixed(1)}%`);
    console.log(`      FALSE ALERTS (committed, real loss): ${committedLosses.length}/${committed.length} (${((committedLosses.length / committed.length) * 100).toFixed(1)}%)`);
  }
  console.log(`    BLOCKED (what the gates rejected): n=${blocked.length}`);
  if (blocked.length) {
    console.log(`      MISSED TRADES (blocked, would have WON): ${blockedWins.length}/${blocked.length} (${((blockedWins.length / blocked.length) * 100).toFixed(1)}%)`);
    console.log(`      correctly avoided (blocked, would have LOST): ${blockedLosses.length}/${blocked.length} (${((blockedLosses.length / blocked.length) * 100).toFixed(1)}%)`);
    const avgMissedGain = blockedWins.length ? blockedWins.reduce((s, g) => s + g.pnlPct, 0) / blockedWins.length : null;
    const avgAvoidedLoss = blockedLosses.length ? blockedLosses.reduce((s, g) => s + g.pnlPct, 0) / blockedLosses.length : null;
    console.log(`      avg gain on missed winners: ${avgMissedGain != null ? avgMissedGain.toFixed(1) + "%" : "—"}`);
    console.log(`      avg loss correctly avoided: ${avgAvoidedLoss != null ? avgAvoidedLoss.toFixed(1) + "%" : "—"}`);

    // WHICH gate is actually responsible for the missed winners vs the correctly-avoided
    // losers — the diagnostic that turns "X% missed" into an actionable (or non-actionable)
    // finding. A gate that blocks winners and losers in roughly the SAME proportion it blocks
    // everything is doing its job (indiscriminate but net-correct); a gate that disproportionately
    // blocks WINNERS specifically is the one worth real scrutiny.
    const tally = (rows) => {
      const counts = new Map();
      for (const g of rows) for (const code of g.blocks) counts.set(code, (counts.get(code) ?? 0) + 1);
      return counts;
    };
    const winBlockCounts = tally(blockedWins);
    const lossBlockCounts = tally(blockedLosses);
    const allCodes = new Set([...winBlockCounts.keys(), ...lossBlockCounts.keys()]);
    console.log(`      gate-block frequency (missed winners vs correctly-avoided losers):`);
    for (const code of [...allCodes].sort()) {
      const w = winBlockCounts.get(code) ?? 0;
      const l = lossBlockCounts.get(code) ?? 0;
      console.log(
        `        ${code.padEnd(28)} winners-blocked ${String(w).padStart(2)}/${blockedWins.length}  ` +
          `losers-blocked ${String(l).padStart(2)}/${blockedLosses.length}`
      );
    }
  }
  return { committed, blocked, committedWins, committedLosses, blockedWins, blockedLosses, maxDd };
}

const trainSummary = summarize(`TRAIN (${[...trainDays].join(", ")})`, trainGraded);
const validationSummary = summarize(`VALIDATION — HELD-OUT, UNSEEN (${[...validationDays].join(", ")})`, validationGraded);

console.log(`\n${line("═")}`);
console.log(`  CROSS-CHECK: does any TRAIN pattern hold in VALIDATION? (never report a TRAIN-only pattern as a finding)`);
console.log(line("═"));
const trainMissedRate = trainSummary.blocked.length ? (trainSummary.blockedWins.length / trainSummary.blocked.length) * 100 : null;
const validationMissedRate = validationSummary.blocked.length ? (validationSummary.blockedWins.length / validationSummary.blocked.length) * 100 : null;
console.log(`    missed-trade rate: TRAIN ${trainMissedRate?.toFixed(1) ?? "—"}% vs VALIDATION ${validationMissedRate?.toFixed(1) ?? "—"}%`);
const trainFalseAlertRate = trainSummary.committed.length ? (trainSummary.committedLosses.length / trainSummary.committed.length) * 100 : null;
const validationFalseAlertRate = validationSummary.committed.length ? (validationSummary.committedLosses.length / validationSummary.committed.length) * 100 : null;
console.log(`    false-alert rate: TRAIN ${trainFalseAlertRate?.toFixed(1) ?? "—"}% vs VALIDATION ${validationFalseAlertRate?.toFixed(1) ?? "—"}%`);
console.log(`\n  No gate/filter/threshold changed by this run — evidence-gathering only.`);
console.log(line("═"));

if (EMIT_JSON) {
  console.log("\n<<<JSON>>>");
  console.log(JSON.stringify({ trainDays: [...trainDays], validationDays: [...validationDays], trainGraded, validationGraded }, null, 2));
}
