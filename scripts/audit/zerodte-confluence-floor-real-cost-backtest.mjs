/**
 * 0DTE CONFLUENCE_FLOOR (G-12) — REAL-COST OUTCOME BACKTEST
 * ============================================================================================
 * WHY THIS EXISTS (2026-10-20, member audit directive)
 * ------------------------------------------------------
 * `zerodte-confluence-floor-outcome-backtest.mjs` already buckets setups by confirmation count
 * (0/1/2) and grades them — but on a favorable-first UNDERLYING-continuation PROXY, explicitly
 * disclosed as "NOT exact option premium P&L... a deliberate deviation." The operator's own
 * instruction this round is explicit: "Compare current rules against proposed changes, including
 * losing setups, missed trades, SPREADS, and realistic entry delays." This script answers the
 * SAME confluence-tier question with REAL option premium, REAL bid/ask spread cost paid on both
 * entry and exit, and a REALISTIC entry delay (a human/system reaction gap after qualification,
 * not an instantaneous fill at the exact qualifying tick) — closing the proxy script's own
 * disclosed gap rather than duplicating it.
 *
 * METHOD
 * ------
 * For each real FLOW-derived setup (deriveZeroDteSetups, board.ts — real UW flow, real score
 * formula) on each historical session day in the window:
 *   1. Compute the REAL confluence tier (computeConfluence, confluence.ts) AS-OF the setup's own
 *      qualifying instant — bars truncated to that instant, same no-look-ahead discipline as
 *      zerodte-gate-rejection-trace.mjs.
 *   2. Resolve its REAL contract: ticker + top_strike + expiry + direction, exactly as the setup
 *      itself already carries (the same strike/expiry the live board would commit).
 *   3. REALISTIC ENTRY: fetch the REAL NBBO nearest to (qualifying instant + ENTRY_DELAY_SEC) —
 *      a deliberate, disclosed stand-in for "the time a member actually reacts and places an
 *      order," not the instantaneous qualifying tick. Entry price is the real ASK (long) or real
 *      BID (short) at that delayed instant — paying the real spread, never the mid.
 *   4. Walk REAL contract minute bars forward from entry to the EARLIER of a 90-minute holding
 *      window or the 15:50 ET time-stop, applying the real -50%/+100% PLAN_RULES stop/target
 *      against the REAL entry price. On a stop/target touch, the realized exit uses that same
 *      bar's close as a conservative single-sided fill (no second NBBO re-fetch per bar — the
 *      spread cost is already paid once at entry and once at the final exit fetch, below).
 *   5. Final exit (time-stop or walk-through-window) refetches the REAL NBBO at the exit instant
 *      and exits at the real BID (long) or real ASK (short) — the spread cost paid on the way out.
 *
 * WHAT'S REAL vs. APPROXIMATED (disclosed, same discipline as every sibling in this toolkit):
 * REAL: deriveZeroDteSetups, computeConfluence/computeIntradayRead/marketBias, the setup's own
 *   strike/expiry, real Polygon NBBO quotes AND option minute bars, PLAN_RULES' real -50/+100.
 * APPROXIMATED: the stop/target TOUCH is detected on bar close (not true intrabar high/low) for
 *   the walk-forward leg — a real but coarser proxy than a tick-by-tick replay; the realized P&L
 *   number is still real option premium with real spread cost, just the exact touch INSTANT within
 *   a losing/winning bar is approximate. ENTRY_DELAY_SEC is a single fixed assumption (default
 *   90s), not a measured distribution of real member reaction times — printed every run so it's
 *   never mistaken for a calibrated figure.
 *
 * THIS SCRIPT NEVER CHANGES A GATE OR THRESHOLD. Evidence-gathering only.
 *
 * USAGE
 *   POLYGON_API_BASE=https://api.massive.com \
 *   env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY \
 *   node --import tsx scripts/audit/zerodte-confluence-floor-real-cost-backtest.mjs [options]
 * OPTIONS
 *   --days=N            multi-day flow lookback (default 10)
 *   --min-premium=N     min alert premium (default 250000)
 *   --max-setups=N      cap on setups graded (default 25 — each costs 2 real quote fetches + 1
 *                       real minute-bar fetch, keep bounded)
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
const DAYS = Math.max(1, Number(argv.days ?? 10));
const MIN_PREMIUM = Math.max(0, Number(argv["min-premium"] ?? 250_000));
const MAX_SETUPS = Math.max(1, Number(argv["max-setups"] ?? 25));
const ENTRY_DELAY_SEC = Math.max(0, Number(argv["entry-delay"] ?? 90));
const HOLD_MINUTES = Math.max(5, Number(argv["hold-minutes"] ?? 90));
const EMIT_JSON = Boolean(argv.json);

const { fetchMarketFlowAlertRows } = await import(`${SRC}lib/providers/unusual-whales.ts`);
const { extractChainFieldsFromRaw } = await import(`${SRC}lib/flow-raw-fields.ts`);
const { dteFromExpiry } = await import(`${SRC}lib/flow-dte.ts`);
const { deriveZeroDteSetups } = await import(`${SRC}lib/zerodte/board.ts`);
const { computeConfluence } = await import(`${SRC}lib/zerodte/confluence.ts`);
const { computeIntradayRead, marketBias } = await import(`${SRC}lib/zerodte/intraday.ts`);
const { fetchStockMinuteBars, fetchOptionMinuteBars } = await import(`${SRC}lib/providers/polygon.ts`);
const { PLAN_RULES } = await import(`${SRC}lib/zerodte/plan.ts`);

const POLYGON_BASE = process.env.POLYGON_API_BASE;
const POLYGON_KEY = process.env.POLYGON_API_KEY;

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
  return best ? { bid: best.bid_price, ask: best.ask_price, atMs: Math.floor(best.sip_timestamp / 1e6) } : null;
}

async function fetchMultiDayFlow(endMs, days, minPremium) {
  const cutoffMs = endMs - days * 86_400_000;
  const rows = [];
  const seen = new Set();
  let olderThan = new Date(endMs).toISOString();
  for (let page = 0; page < 24; page++) {
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
console.log(`  0DTE CONFLUENCE_FLOOR — REAL-COST OUTCOME BACKTEST`);
console.log(`  window ${DAYS}d · min premium ${fmtUsd(MIN_PREMIUM)} · cap ${MAX_SETUPS} setups · entry delay ${ENTRY_DELAY_SEC}s · hold ${HOLD_MINUTES}min`);
console.log(`  ⚠ stop/target touch detected on BAR CLOSE (coarser than tick-by-tick) — see header`);
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
console.log(`    spread across ${byDay.size} session days`);

console.log(`\n[2] Deriving real setups per day, computing REAL as-of confluence, resolving contracts…`);
const candidates = [];
for (const [day, rows] of byDay) {
  const dayRejections = [];
  const daySetups = deriveZeroDteSetups(rows, { maxSetups: 50, nowMs: Date.parse(`${day}T20:00:00Z`), todayYmd: day, rejections: dayRejections });
  for (const s of daySetups) {
    if (!s.expiry || !s.top_strike) continue;
    const latestAlertMs = rows
      .filter((r) => r.ticker === s.ticker && (r.option_type === "CALL") === (s.direction === "long"))
      .reduce((m, r) => Math.max(m, Date.parse(r.alerted_at) || 0), 0);
    if (!latestAlertMs) continue;
    candidates.push({ setup: s, day, decisionMs: latestAlertMs });
  }
}
candidates.sort((a, b) => a.decisionMs - b.decisionMs);
const sample = candidates.slice(0, MAX_SETUPS);
console.log(`    ${candidates.length} candidates with a resolvable contract — grading first ${sample.length}`);

console.log(`\n[3] Grading each with REAL confluence (as-of) + REAL contract quotes/bars + REAL spread cost…`);
const graded = [];
for (const c of sample) {
  const { setup: s, day, decisionMs } = c;
  try {
    const spyBars = (await fetchStockMinuteBars("SPY", day, day).catch(() => [])).filter((b) => b.t <= decisionMs);
    const spyRead = computeIntradayRead(spyBars.map((b) => ({ t: b.t, h: b.h, l: b.l, c: b.c, v: b.v })));
    const bias = marketBias(spyRead);
    const tkBars = (await fetchStockMinuteBars(s.ticker, day, day).catch(() => [])).filter((b) => b.t <= decisionMs);
    const read = tkBars.length ? computeIntradayRead(tkBars.map((b) => ({ t: b.t, h: b.h, l: b.l, c: b.c, v: b.v }))) : null;
    const marketAligned = bias == null || bias === "flat" ? null : (bias === "up") === (s.direction === "long");
    const confluence = computeConfluence({ direction: s.direction, intraday: read, market_aligned: marketAligned }, etMinutesOf(decisionMs));
    const confCount = confluence?.confirmations ?? 0;

    const occ = buildOcc(s.ticker, s.expiry, s.direction, s.top_strike);
    const entryAtMs = decisionMs + ENTRY_DELAY_SEC * 1000;
    const entryQuote = await fetchQuoteNear(occ, entryAtMs);
    if (!entryQuote || !(entryQuote.bid > 0) || !(entryQuote.ask > 0)) {
      graded.push({ ticker: s.ticker, day, confCount, verdict: "NO_QUOTE" });
      continue;
    }
    const entryPx = s.direction === "long" ? entryQuote.ask : entryQuote.bid; // pay the real spread

    const timeStopMs = Date.parse(`${day}T19:50:00Z`); // 15:50 ET (EDT UTC-4) — same convention as PLAN_RULES' time_stop
    const holdEndMs = Math.min(entryAtMs + HOLD_MINUTES * 60_000, timeStopMs);
    const bars = await fetchOptionMinuteBars(occ, day, day).catch(() => []);
    const walkBars = bars.filter((b) => b.t > entryAtMs && b.t <= holdEndMs);

    const stopPx = entryPx * (1 + PLAN_RULES.stop_pct / 100);
    const targetPx = entryPx * (1 + PLAN_RULES.target_pct / 100);
    let exitPx = null;
    let exitReason = "time_stop";
    let exitAtMs = holdEndMs;
    for (const b of walkBars) {
      if (s.direction === "long") {
        if (b.l <= stopPx) { exitPx = stopPx; exitReason = "stopped"; exitAtMs = b.t; break; }
        if (b.h >= targetPx) { exitPx = targetPx; exitReason = "target"; exitAtMs = b.t; break; }
      } else {
        // short-premium convention not used here — all FLOW setups are long-premium directional
        // bets (call for long underlying thesis, put for short); treat identically to long-premium.
        if (b.l <= stopPx) { exitPx = stopPx; exitReason = "stopped"; exitAtMs = b.t; break; }
        if (b.h >= targetPx) { exitPx = targetPx; exitReason = "target"; exitAtMs = b.t; break; }
      }
    }
    if (exitPx == null) {
      // Walked through the window without touching stop/target — exit at the REAL NBBO (paying the
      // spread again), at the time-stop/window-end instant.
      const exitQuote = await fetchQuoteNear(occ, exitAtMs);
      if (!exitQuote || !(exitQuote.bid > 0) || !(exitQuote.ask > 0)) {
        graded.push({ ticker: s.ticker, day, confCount, verdict: "NO_EXIT_QUOTE" });
        continue;
      }
      exitPx = exitQuote.bid; // closing a long premium position sells into the bid — real spread paid
    }

    const pnlPct = ((exitPx - entryPx) / entryPx) * 100;
    graded.push({
      ticker: s.ticker, day, direction: s.direction, confCount, entryPx: Math.round(entryPx * 100) / 100,
      exitPx: Math.round(exitPx * 100) / 100, pnlPct: Math.round(pnlPct * 100) / 100, exitReason,
      verdict: pnlPct > 0 ? "WIN" : "LOSS",
    });
  } catch (e) {
    graded.push({ ticker: s.ticker, day, confCount: null, verdict: "ERROR", error: e instanceof Error ? e.message : String(e) });
  }
  await new Promise((r) => setTimeout(r, 250)); // pace vs shared UW/Polygon rate limiter
}

console.log(`\n${line()}`);
console.log(`  PER-SETUP REAL-COST GRADE`);
console.log(line());
console.log(`    ${pad("TICKER", 8)}${pad("DAY", 12)}${pad("CONF", 6)}${pad("ENTRY", 9)}${pad("EXIT", 9)}${pad("PNL%", 9)}${pad("REASON", 11)}VERDICT`);
for (const g of graded) {
  if (g.verdict === "NO_QUOTE" || g.verdict === "NO_EXIT_QUOTE" || g.verdict === "ERROR") {
    console.log(`    ${pad(g.ticker, 8)}${pad(g.day, 12)}${pad(String(g.confCount ?? "—"), 6)}${g.verdict}${g.error ? ` (${g.error})` : ""}`);
    continue;
  }
  console.log(`    ${pad(g.ticker, 8)}${pad(g.day, 12)}${pad(String(g.confCount), 6)}${pad(String(g.entryPx), 9)}${pad(String(g.exitPx), 9)}${pad(String(g.pnlPct), 9)}${pad(g.exitReason, 11)}${g.verdict}`);
}

const byTier = new Map();
for (const g of graded) {
  if (g.verdict !== "WIN" && g.verdict !== "LOSS") continue;
  const tier = byTier.get(g.confCount) ?? { n: 0, wins: 0, pnlSum: 0 };
  tier.n++;
  if (g.verdict === "WIN") tier.wins++;
  tier.pnlSum += g.pnlPct;
  byTier.set(g.confCount, tier);
}
console.log(`\n${line("═")}`);
console.log(`  REAL-COST RESULT BY CONFLUENCE TIER (entry delay ${ENTRY_DELAY_SEC}s, real spread both sides)`);
console.log(line("═"));
for (const [tier, t] of [...byTier.entries()].sort((a, b) => a[0] - b[0])) {
  console.log(`    ${tier}-confirmation: n=${t.n}  win_rate=${((t.wins / t.n) * 100).toFixed(1)}%  mean_pnl=${(t.pnlSum / t.n).toFixed(1)}%`);
}
const noData = graded.filter((g) => g.verdict === "NO_QUOTE" || g.verdict === "NO_EXIT_QUOTE" || g.verdict === "ERROR").length;
console.log(`    ${noData}/${graded.length} ungradeable (no real quote/bar data) — excluded from the tiers above, never fabricated`);
console.log(line("═"));

if (EMIT_JSON) {
  console.log("\n<<<JSON>>>");
  console.log(JSON.stringify({ entryDelaySec: ENTRY_DELAY_SEC, holdMinutes: HOLD_MINUTES, graded, byTier: Object.fromEntries(byTier) }, null, 2));
}
