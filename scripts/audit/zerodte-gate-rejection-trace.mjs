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

console.log(`\n[2] Running the REAL evidence-gate funnel (deriveZeroDteSetups)…`);
const rejections = [];
const rawSetups = deriveZeroDteSetups(flowRows, { maxSetups: MAX_TICKERS, nowMs, todayYmd: today, rejections });
console.log(`    ${rawSetups.length} setups survived evidence gates`);
if (!rawSetups.length) {
  console.log("\n  No setups survived evidence gates. Trace ends here.");
  process.exit(0);
}

// For each setup, find its own DECISION INSTANT: the latest `alerted_at` among the flow rows that
// evidence-gated it in, i.e. the last moment new information arrived before it would have qualified.
// This is the real "alert time" this trace replays from — never a global, shared "now".
const latestAlertMsByTicker = new Map();
for (const row of flowRows) {
  const ms = Date.parse(row.alerted_at ?? "");
  if (!Number.isFinite(ms)) continue;
  const key = `${row.ticker}:${row.option_type === "CALL" ? "long" : "short"}`;
  const prev = latestAlertMsByTicker.get(key);
  if (prev == null || ms > prev) latestAlertMsByTicker.set(key, ms);
}

console.log(`\n[3] Per-setup VIX day-open (cached, day-level — knowable from the open onward)…`);
const vixByDate = new Map();
async function vixDayOpenFor(dateYmd) {
  if (vixByDate.has(dateYmd)) return vixByDate.get(dateYmd);
  const bar = await fetchAggBars("I:VIX", 1, "day", dateYmd, dateYmd).catch(() => []);
  const v = Array.isArray(bar) && bar[0]?.o != null ? Number(bar[0].o) : null;
  vixByDate.set(dateYmd, v);
  return v;
}

console.log(`\n[4] Tracing ${rawSetups.length} setups — EACH against its OWN decision instant (real per-setup bar fetches, no look-ahead)…`);
const traces = [];
for (const s of rawSetups) {
  const key = `${s.ticker}:${s.direction}`;
  const decisionMs = latestAlertMsByTicker.get(key) ?? nowMs;
  const decisionYmd = etYmd(decisionMs);
  const decisionEtMinutes = etMinutesOf(decisionMs);

  // SPY bias AS OF the decision instant — bars truncated to decisionMs, never later.
  const spyBarsAll = await fetchStockMinuteBars("SPY", decisionYmd, decisionYmd).catch(() => []);
  const spyBarsUpToNow = (spyBarsAll ?? []).filter((b) => b.t <= decisionMs);
  const spyRead = computeIntradayRead(spyBarsUpToNow.map((b) => ({ t: b.t, h: b.h, l: b.l, c: b.c, v: b.v })));
  const bias = marketBias(spyRead);

  // Ticker's own intraday read AS OF the decision instant.
  const tkBarsAll = await fetchStockMinuteBars(s.ticker, decisionYmd, decisionYmd).catch(() => []);
  const tkBarsUpToNow = (tkBarsAll ?? []).filter((b) => b.t <= decisionMs);
  const read = tkBarsUpToNow.length
    ? computeIntradayRead(tkBarsUpToNow.map((b) => ({ t: b.t, h: b.h, l: b.l, c: b.c, v: b.v })))
    : null;
  const marketAligned = bias == null || bias === "flat" ? null : (bias === "up") === (s.direction === "long");
  const intradayConflict = read ? intradayScoreAdjust(s.direction, read).conflict : false;
  const confluence = computeConfluence({ direction: s.direction, intraday: read, market_aligned: marketAligned }, decisionEtMinutes);

  const vixDayOpen = await vixDayOpenFor(decisionYmd);

  const verdict = evaluateZeroDteGates({
    ticker: s.ticker,
    direction: s.direction,
    score: s.score,
    discovery_origin: ["FLOW"],
    nowEtMinutes: decisionEtMinutes,
    nowMs: decisionMs,
    bias,
    biasAsOfMs: spyRead.last_bar_ms ?? null,
    governor: { open_plans: [], stops: [] }, // APPROXIMATED, see header
    vixDayOpen,
    vixUnavailable: vixDayOpen == null,
    slayerLive: null,
    nighthawkTake: null,
    macroEvents: [],
    plan: null,
    deferPlanQualityGates: true,
    contractHorizon: "ZERO_DTE",
    intradayConflict,
    market_aligned: marketAligned,
    halted: false,
    haltFeedStale: false,
    earnings: null,
    earningsUnavailable: false,
    confluence,
  });

  traces.push({
    ticker: s.ticker,
    direction: s.direction,
    score: s.score,
    decisionMs,
    decisionEt: `${decisionYmd} ${etClock(decisionMs)}`,
    verdict: verdict.verdict,
    blocks: verdict.blocks.map((b) => b.code),
  });
  console.log(
    `    ${pad(s.ticker, 7)}${pad(s.direction, 6)} score=${pad(String(s.score), 4)} @ ${traces[traces.length - 1].decisionEt} ET  →  ${verdict.verdict}` +
      (verdict.blocks.length ? `  [${verdict.blocks.map((b) => b.code).join(", ")}]` : "")
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
