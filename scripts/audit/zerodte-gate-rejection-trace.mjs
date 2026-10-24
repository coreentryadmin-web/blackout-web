/**
 * 0DTE PER-SETUP GATE-REJECTION TRACE — "which gate killed THIS setup, and at what moment,
 * using only information that existed at that moment?"
 * ============================================================================================
 *
 * WHY THIS EXISTS (2026-10-20, member audit directive)
 * ------------------------------------------------------
 * `zerodte-gate-compound-funnel.mjs` already measures the JOINT/ISOLATED gate-failure rate
 * across a population of setups — but it evaluates EVERY setup against ONE SHARED "now" snapshot
 * (one VIX read, one SPY bias, one set of per-ticker intraday reads, all fetched once at script
 * start). That is correct for "what would the board show right now," but it is NOT a point-in-time
 * REPLAY: a setup whose flow print landed 40 minutes before this run started gets evaluated
 * against data 40 minutes newer than it could have seen. This script closes that gap: for EACH
 * setup, it re-fetches SPY + the ticker's own minute bars TRUNCATED to that setup's own decision
 * instant (its last qualifying flow print's `alerted_at`), then runs the REAL gate stack with
 * `nowMs` pinned to that same instant — so every verdict reported here is one the board could
 * actually have reached AT THAT MOMENT, never with foresight of what happened afterward.
 *
 * WHAT'S REAL vs. APPROXIMATED — IDENTICAL to zerodte-gate-compound-funnel.mjs's own disclosure
 * (deriveZeroDteSetups, evaluateZeroDteGates, computeConfluence, computeIntradayRead/marketBias
 * are all real, unmodified production functions; G-5/G-6/G-7/G-8/G-9/G-11/G-20/G-21/G-23 remain
 * NOT MEASURED here for the same reasons — see that script's header for the full list). The ONLY
 * difference from that script is WHEN each input is read: here, per-setup and truncated to that
 * setup's own decision instant, not a single shared "now."
 *
 * NOT A RECONSTRUCTION OF ANY PRIOR RUN — this runs against WHATEVER real flow is in the window
 * as of when it's invoked; it cannot regenerate a specific historical run's exact 26 setups
 * (raw UW flow history for an arbitrary past date, replayed against the exact code as it existed
 * that day, is not reachable from this sandbox). Re-run this script itself whenever a fresh
 * point-in-time trace is needed — it IS the reusable tool a prior one-off measurement was missing.
 *
 * USAGE
 *   POLYGON_API_BASE=https://api.massive.com \
 *   env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY \
 *   node --import tsx scripts/audit/zerodte-gate-rejection-trace.mjs [options]
 *
 * OPTIONS
 *   --days=N          multi-day flow lookback (default 3)
 *   --min-premium=N   min alert premium (default 250000)
 *   --max-tickers=N   cap on setups traced (default 20 — each setup costs 2 extra real bar
 *                     fetches vs the shared-snapshot tool, so this stays smaller by default)
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
const DAYS = Math.max(1, Number(argv.days ?? 3));
const MIN_PREMIUM = Math.max(0, Number(argv["min-premium"] ?? 250_000));
const MAX_TICKERS = Math.max(1, Number(argv["max-tickers"] ?? 20));
const EMIT_JSON = Boolean(argv.json);

const { fetchMarketFlowAlertRows } = await import(`${SRC}lib/providers/unusual-whales.ts`);
const { extractChainFieldsFromRaw } = await import(`${SRC}lib/flow-raw-fields.ts`);
const { dteFromExpiry } = await import(`${SRC}lib/flow-dte.ts`);
const { deriveZeroDteSetups } = await import(`${SRC}lib/zerodte/board.ts`);
const { evaluateZeroDteGates } = await import(`${SRC}lib/zerodte/gates.ts`);
const { computeConfluence } = await import(`${SRC}lib/zerodte/confluence.ts`);
const { computeIntradayRead, marketBias, intradayScoreAdjust } = await import(`${SRC}lib/zerodte/intraday.ts`);
const { fetchStockMinuteBars } = await import(`${SRC}lib/providers/polygon.ts`);
const { fetchAggBars } = await import(`${SRC}lib/providers/polygon-largo.ts`);

const fmtUsd = (n) => (n == null ? "—" : n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(0)}k` : `$${n.toFixed(0)}`);
const pad = (s, w) => String(s).padEnd(w);
const line = (c = "─", w = 110) => c.repeat(w);
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

async function fetchMultiDayFlow(endMs, days, minPremium) {
  const cutoffMs = endMs - days * 86_400_000;
  const rows = [];
  const seen = new Set();
  let olderThan = new Date(endMs).toISOString();
  for (let page = 0; page < 16; page++) {
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
const today = etYmd(nowMs);

console.log(line("═"));
console.log(`  0DTE PER-SETUP GATE-REJECTION TRACE (point-in-time replay) — run at ${etClock(nowMs)} ET ${today}`);
console.log(`  flow window ${DAYS}d · min premium ${fmtUsd(MIN_PREMIUM)} · cap ${MAX_TICKERS} setups traced`);
console.log(line("═"));

console.log(`\n[1] Fetching multi-day UW flow…`);
const mrows = await fetchMultiDayFlow(nowMs, DAYS, MIN_PREMIUM);
console.log(`    ${mrows.length} raw alerts fetched`);
if (!mrows.length) {
  console.log("\n  No flow in window. Nothing to trace.");
  process.exit(0);
}

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
console.log(`    ${flowRows.length} usable directional rows`);

console.log(`\n[2] Per-ticker VIX day-open (cached, day-level — knowable from the open onward)…`);
const vixByDate = new Map();
async function vixDayOpenFor(dateYmd) {
  if (vixByDate.has(dateYmd)) return vixByDate.get(dateYmd);
  const bar = await fetchAggBars("I:VIX", 1, "day", dateYmd, dateYmd).catch(() => []);
  const v = Array.isArray(bar) && bar[0]?.o != null ? Number(bar[0].o) : null;
  vixByDate.set(dateYmd, v);
  return v;
}

console.log(`\n[3] Tracing each ticker/direction across EVERY one of its own real print instants (no look-ahead on EITHER the evidence gates or the hard gates)…`);
// CORRECTNESS FIX (2026-10-20, caught live): the original version of this script called
// deriveZeroDteSetups ONCE with the WHOLE day's rows, then evaluated hard gates at a single
// "latest alert" instant — a double look-ahead bug. deriveZeroDteSetups AGGREGATES every row
// it's given into one scored setup per ticker/direction, so feeding it the full day silently
// leaks every LATER print into the evidence-gate math (score/gross_premium/aggr_share/
// dominance/max_itm_pct) used to judge an EARLIER instant. Caught via a real discrepancy
// against production: a real TSLA commit at 10:21 ET (score 91) was REJECTED outright by the
// old full-day-aggregated call on max_itm_pct, because prints through the END of that day
// pushed the aggregate OTM% past the threshold — a fact that did not exist yet at 10:21 ET.
// Fixed below: for each ticker/direction, walk EVERY one of its own real print instants in
// order; at EACH one, re-derive the setup from rows truncated to that exact instant (fixing the
// evidence-gate leak) AND evaluate the full hard-gate stack at that same instant (fixing the
// single-snapshot leak) — this is cheap, since only deriveZeroDteSetups/computeIntradayRead/
// computeConfluence/evaluateZeroDteGates repeat per instant (all pure, no network); the
// EXPENSIVE SPY/ticker bar + VIX fetches still happen ONCE per ticker, reused via in-memory
// truncation. Reports the EARLIEST instant that would have reached COMMIT, or — if it never
// does — the LAST instant (the ticker's own most complete, most mature picture of itself that
// day), so a "never qualifies" verdict reflects the full day's real evidence, not a partial one.
const byTickerDir = new Map();
for (const r of flowRows) {
  const dir = r.option_type === "CALL" ? "long" : "short";
  const key = `${r.ticker}:${dir}`;
  (byTickerDir.get(key) ?? byTickerDir.set(key, []).get(key)).push(r);
}

const traces = [];
for (const [key, tdRows] of byTickerDir) {
  if (traces.length >= MAX_TICKERS) break;
  const [ticker, dir] = key.split(":");
  const ownPrints = [...tdRows]
    .map((r) => Date.parse(r.alerted_at))
    .filter((ms) => Number.isFinite(ms))
    .sort((a, b) => a - b);
  if (!ownPrints.length) continue;

  // Expensive fetches ONCE per ticker — truncated per-instant below, never re-fetched.
  const spyBarsAll = await fetchStockMinuteBars("SPY", today, today).catch(() => []);
  const tkBarsAll = await fetchStockMinuteBars(ticker, today, today).catch(() => []);
  const vixDayOpen = await vixDayOpenFor(today);

  let best = null; // the earliest COMMIT, if any
  let last = null; // the last instant's result, if never COMMIT
  for (const cutoffMs of ownPrints) {
    const truncatedFlow = flowRows.filter((r) => (Date.parse(r.alerted_at) || Infinity) <= cutoffMs);
    const setups = deriveZeroDteSetups(truncatedFlow, { maxSetups: 200, nowMs: cutoffMs, todayYmd: today, rejections: [] });
    const s = setups.find((x) => x.ticker === ticker && x.direction === dir && x.expiry && x.top_strike);
    if (!s) continue; // doesn't even clear evidence gates yet at this instant

    const decisionEtMinutes = etMinutesOf(cutoffMs);
    const spyBarsUpToNow = (spyBarsAll ?? []).filter((b) => b.t <= cutoffMs);
    const spyRead = computeIntradayRead(spyBarsUpToNow.map((b) => ({ t: b.t, h: b.h, l: b.l, c: b.c, v: b.v })));
    const bias = marketBias(spyRead);
    const tkBarsUpToNow = (tkBarsAll ?? []).filter((b) => b.t <= cutoffMs);
    const read = tkBarsUpToNow.length
      ? computeIntradayRead(tkBarsUpToNow.map((b) => ({ t: b.t, h: b.h, l: b.l, c: b.c, v: b.v })))
      : null;
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

    const result = {
      ticker: s.ticker, direction: s.direction, score: s.score, decisionMs: cutoffMs,
      decisionEt: `${today} ${etClock(cutoffMs)}`, verdict: verdict.verdict, blocks: verdict.blocks.map((b) => b.code),
    };
    last = result;
    if (verdict.verdict === "COMMIT") { best = result; break; }
  }
  const chosen = best ?? last;
  if (!chosen) continue; // never even cleared evidence gates at any of its own instants
  traces.push(chosen);
  console.log(
    `    ${pad(chosen.ticker, 7)}${pad(chosen.direction, 6)} score=${pad(String(chosen.score), 4)} @ ${chosen.decisionEt} ET  →  ${chosen.verdict}` +
      (chosen.blocks.length ? `  [${chosen.blocks.join(", ")}]` : "") +
      (best ? "" : "  (shown at its LAST real print instant — never cleared at any point today)")
  );
}

console.log(`\n${line()}`);
console.log(`  PER-SETUP TRACE — WHICH GATE, AND WHEN (point-in-time, no look-ahead)`);
console.log(line());
console.log(`    ${pad("TICKER", 8)}${pad("DIR", 7)}${pad("SCORE", 7)}${pad("DECISION INSTANT (ET)", 24)}${pad("VERDICT", 10)}BLOCKED BY`);
for (const t of traces) {
  console.log(`    ${pad(t.ticker, 8)}${pad(t.direction, 7)}${pad(String(t.score), 7)}${pad(t.decisionEt, 24)}${pad(t.verdict, 10)}${t.blocks.join(", ") || "—"}`);
}

const jointPass = traces.filter((t) => t.verdict === "COMMIT").length;
console.log(`\n${line("═")}`);
console.log(`  ${jointPass}/${traces.length} would have cleared every gate AT THEIR OWN DECISION INSTANT`);
console.log(line("═"));

if (EMIT_JSON) {
  console.log("\n<<<JSON>>>");
  console.log(JSON.stringify({ asOf: today, traces }, null, 2));
}
