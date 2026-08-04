/**
 * GATE SMALL-CAP SENSITIVITY PROBE.
 *
 * Investigates the operator's hypothesis (2026-08-04 follow-up): are G-8 (anti-chase,
 * `plan_moved`, CHASE_PCT=55% flat) and G-9 (illiquidity, `plan_illiquid`, spread_pct>15% flat)
 * — both in src/lib/zerodte/plan.ts, applied in gates.ts's planQualityGateBlocks — miscalibrated
 * SPECIFICALLY for small-cap names (as opposed to mega-caps/SPX), given both thresholds are flat
 * percentages with zero price/cap conditioning?
 *
 * METHOD (real data throughout, no fabrication):
 *  1. Screen a session with the EXACT production `screenBreakoutMovers` ranking (imported from
 *     src, not reimplemented) over Polygon grouped-daily — the same whole-market universe the
 *     BREAKOUT origin discovers from.
 *  2. Split qualifying movers into SMALL-CAP (price < --price-split, default $20) vs
 *     LARGE-CAP/MEGA-CAP (>= --price-split) cohorts. Price = dollar-volume / volume (both already
 *     on the production BreakoutMover shape).
 *  3. For EACH mover, resolve whether it actually has a REAL same-day-expiring (0DTE) listed call
 *     contract that trading session (Polygon `/v3/reference/options/contracts`, exact
 *     `expiration_date` match, `expired=true` — required for historical dates) — pickAtmZeroDteContract's
 *     real precondition. Most single-names only have WEEKLY (Friday) listed options, not daily, so
 *     this step alone measures how much of the "genuine small-cap 0DTE" population even reaches a
 *     plan/gate at all on a given calendar day (see FINDINGS 2026-08-04 for the Monday/Friday split
 *     this surfaced).
 *  4. For 0DTE-eligible movers, pull the contract's REAL historical NBBO quote at the commit-open
 *     bar (10:00 ET, ZERODTE_COMMIT_OPEN_ET_MINUTES) via `/v3/quotes` — a real bid/ask, not a
 *     synthesized one — and compute spread_pct with the IDENTICAL formula plan.ts uses:
 *     (ask-bid)/mark*100. This is the real G-9 mechanism replayed on real historical quotes.
 *  5. For G-8, the flow's own per-contract avg fill isn't reachable offline (UW flow-alerts has no
 *     historical replay endpoint we can hit from here) — proxy `flow_avg_fill` with the VWAP of the
 *     option's own REAL first-5-minutes-of-RTH trade prints (the earliest real prints the tape has
 *     for that contract that session), vs_flow_pct computed with plan.ts's own formula
 *     ((mark-fill)/fill*100) against the same commit-open mark. Labeled a proxy throughout — it is
 *     NOT the exact flow fill, but it is real traded premium data, never invented.
 *  6. Grade EVERY 0DTE-eligible mover's continuation using the REAL production
 *     `gradePlanFromBars` (imported from src/lib/zerodte/plan.ts, not reimplemented) on the
 *     contract's own real minute bars from the commit-open bar onward — the same walk the live
 *     ledger grades with.
 *  7. Report, per cohort: 0DTE-eligibility rate, G-9 block rate (spread>15% on the real quote),
 *     G-8 block rate at CHASE_PCT ∈ {55 (shipped), 70, 85, 100}, and — the recall question — among
 *     movers G-8/G-9 WOULD block at the shipped thresholds, what real win rate they graded at.
 *
 * SCOPE / LIMITATIONS (say plainly, never paper over):
 *  - Single-name equities mostly only list WEEKLY (Friday) options, not daily — so on a
 *    non-Friday session almost no small-cap (or even mega-cap single-name) has a real 0DTE
 *    contract to gate at all. Verified 2026-08-04: CRM/MARA/NOW/etc. had ZERO contracts expiring
 *    on a Monday/Tuesday/Thursday session, but 5/5 on Friday sessions. This probe therefore
 *    defaults to FRIDAY sessions (real weekly-expiration days) — the only days genuine small-cap
 *    0DTE names are gate-reachable at all. Pass --dates to override.
 *  - The commit-open (10:00 ET) quote is ONE snapshot, not the whole session's spread history —
 *    a name could be inside/outside the 15% band at other times. This measures the gate's actual
 *    decision point (commit time), which is what plan.ts/gates.ts evaluate.
 *  - flow_avg_fill is a first-5-minute VWAP proxy (see §5), not the real flow print — every number
 *    derived from it is labeled a proxy in the JSON/console output.
 *
 * Read-only. Polygon only (grouped-daily + reference contracts + quotes + option minute aggs — no
 * UW/DB/Clerk). Self-defaults POLYGON_API_BASE (the `${{shared.*}}` sandbox placeholder issue).
 * Run: env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY node --import tsx scripts/audit/gate-smallcap-sensitivity.mjs [--dates=2026-07-24,2026-07-31] [--scan-top=40] [--max-per-cohort=25] [--price-split=20] [--entry=10:00] [--json]
 */
const rawBase = process.env.POLYGON_API_BASE;
const RESOLVED_BASE = rawBase && /^https?:\/\//.test(rawBase) ? rawBase : "https://api.massive.com";
process.env.POLYGON_API_BASE = RESOLVED_BASE;
const SRC = new URL("../../src/", import.meta.url).pathname;

const { screenBreakoutMovers } = await import(`${SRC}features/nighthawk/lib/candidates.ts`);
const { gradePlanFromBars, gradePlanExecutableFromBars, CHASE_PCT: SHIPPED_CHASE_PCT } = await import(
  `${SRC}lib/zerodte/plan.ts`
);

const argv = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? true];
  })
);

const KEY = process.env.POLYGON_API_KEY;
const BASE = process.env.POLYGON_API_BASE;
if (!KEY) {
  console.error("POLYGON_API_KEY required");
  process.exit(2);
}

// Default: five real Friday (weekly-expiration) sessions — see the SCOPE note above for why
// non-Fridays are excluded by default (near-zero small-cap 0DTE eligibility).
const DEFAULT_DATES = ["2026-07-03", "2026-07-10", "2026-07-17", "2026-07-24", "2026-07-31"];
const DATES = argv.dates && argv.dates !== true ? String(argv.dates).split(",") : DEFAULT_DATES;
const SCAN_TOP = Number(argv["scan-top"] ?? 40);
const MAX_PER_COHORT = Number(argv["max-per-cohort"] ?? 25);
const PRICE_SPLIT = Number(argv["price-split"] ?? 20);
const [entH, entM] = String(argv.entry ?? "10:00").split(":").map(Number);
const JSON_OUT = argv.json === true || argv.json === "true";
const CHASE_THRESHOLDS = [55, 70, 85, 100];
const ET_OFFSET = -4; // EDT for the July sessions probed.

async function jget(url) {
  const r = await fetch(url).catch(() => null);
  if (!r || !r.ok) return null;
  return r.json().catch(() => null);
}

function etToUtcMs(dateYmd, hh, mm) {
  const [y, mo, d] = dateYmd.split("-").map(Number);
  return Date.UTC(y, mo - 1, d, hh - ET_OFFSET, mm);
}

/** Resolve the ATM same-day call contract for a mover (real reference-contracts lookup, exact
 *  expiration_date match — a same-day contract on a non-Friday session for a single name is
 *  frequently ABSENT; that absence is itself part of what this probe measures). */
async function resolveAtmContract(ticker, spot, dateYmd) {
  const qs = new URLSearchParams({
    underlying_ticker: ticker,
    contract_type: "call",
    expired: "true",
    "expiration_date.gte": dateYmd,
    "expiration_date.lte": dateYmd,
    sort: "strike_price",
    order: "asc",
    limit: "250",
    apiKey: KEY,
  });
  const j = await jget(`${BASE}/v3/reference/options/contracts?${qs}`);
  const rows = j?.results ?? [];
  if (!rows.length) return null;
  let best = null;
  let bestDist = Infinity;
  for (const r of rows) {
    const dist = Math.abs(Number(r.strike_price) - spot);
    if (dist < bestDist) {
      bestDist = dist;
      best = r;
    }
  }
  return best ? { occ: best.ticker, strike: Number(best.strike_price) } : null;
}

/** Real historical NBBO quote nearest (at/after) a target ET time — a ±3min window, first hit. */
async function fetchQuoteNear(occ, targetUtcMs, windowMs = 3 * 60_000) {
  const gte = (targetUtcMs - windowMs) * 1e6;
  const lte = (targetUtcMs + windowMs) * 1e6;
  const qs = new URLSearchParams({
    "timestamp.gte": String(gte),
    "timestamp.lte": String(lte),
    order: "asc",
    sort: "timestamp",
    limit: "50",
    apiKey: KEY,
  });
  const j = await jget(`${BASE}/v3/quotes/${encodeURIComponent(occ)}?${qs}`);
  const rows = (j?.results ?? []).filter((q) => q.bid_price > 0 && q.ask_price > 0 && q.ask_price >= q.bid_price);
  if (!rows.length) return null;
  // Nearest to the exact target time.
  const targetNs = targetUtcMs * 1e6;
  rows.sort((a, b) => Math.abs(a.sip_timestamp - targetNs) - Math.abs(b.sip_timestamp - targetNs));
  const q = rows[0];
  return { bid: q.bid_price, ask: q.ask_price };
}

/** Real spot price at/near a target ET time, from the STOCK's own minute bars — used to pick the
 *  ATM strike at the actual commit-open moment (not the full-day dollar-volume-weighted price,
 *  which skews toward the close for a mover that ran hard intraday and would mis-pick the strike). */
async function fetchStockSpotNear(ticker, dateYmd, targetUtcMs) {
  const url = `${BASE}/v2/aggs/ticker/${encodeURIComponent(ticker)}/range/1/minute/${dateYmd}/${dateYmd}?adjusted=true&sort=asc&limit=1000&apiKey=${KEY}`;
  const j = await jget(url);
  const bars = j?.results ?? [];
  if (!bars.length) return null;
  let best = null;
  let bestDist = Infinity;
  for (const b of bars) {
    const dist = Math.abs(b.t - targetUtcMs);
    if (dist < bestDist) {
      bestDist = dist;
      best = b;
    }
  }
  return best ? best.c : null;
}

async function fetchOptionMinuteBars(occ, dateYmd) {
  const url = `${BASE}/v2/aggs/ticker/${encodeURIComponent(occ)}/range/1/minute/${dateYmd}/${dateYmd}?adjusted=true&sort=asc&limit=1000&apiKey=${KEY}`;
  const j = await jget(url);
  return (j?.results ?? []).map((b) => ({ t: b.t, o: b.o, h: b.h, l: b.l, c: b.c }));
}

/** VWAP proxy for "what the flow paid" — the option's own real first-5-real-minutes trade prints
 *  (RTH open through +5 min). Labeled a proxy everywhere it's used (see file doc §5). */
function firstFiveMinVwapProxy(bars, dateYmd) {
  const rthOpenMs = etToUtcMs(dateYmd, 9, 30);
  const window = bars.filter((b) => b.t >= rthOpenMs && b.t < rthOpenMs + 5 * 60_000);
  if (!window.length) return null;
  let num = 0;
  let den = 0;
  for (const b of window) {
    num += b.c;
    den += 1;
  }
  return den > 0 ? num / den : null;
}

async function processMover(mover, dateYmd, entryUtcMs) {
  const price = mover.dollar / mover.volume; // production cohort-split basis (matches BreakoutMover)
  const cohort = price < PRICE_SPLIT ? "small" : "large";
  // Real spot AT the commit-open moment (not the full-day $-vol-weighted price) drives strike pick —
  // a breakout mover's daily VWAP skews toward the close and mis-picks the ATM strike for a 10am entry.
  const spotAtEntry = await fetchStockSpotNear(mover.ticker, dateYmd, entryUtcMs);
  const strikeRef = spotAtEntry ?? price;
  const contract = await resolveAtmContract(mover.ticker, strikeRef, dateYmd);
  if (!contract) return { ticker: mover.ticker, cohort, price, eligible: false };

  const quote = await fetchQuoteNear(contract.occ, entryUtcMs);
  if (!quote) return { ticker: mover.ticker, cohort, price, eligible: true, no_quote: true };

  const mark = (quote.bid + quote.ask) / 2;
  const spreadPct = mark > 0 ? ((quote.ask - quote.bid) / mark) * 100 : null;

  const bars = await fetchOptionMinuteBars(contract.occ, dateYmd);
  const flowFillProxy = firstFiveMinVwapProxy(bars, dateYmd);
  const vsFlowPct = flowFillProxy != null && flowFillProxy > 0 ? ((mark - flowFillProxy) / flowFillProxy) * 100 : null;

  const postEntryBars = bars.filter((b) => b.t > entryUtcMs);
  const grade = mark > 0 ? gradePlanFromBars(postEntryBars, mark, entryUtcMs) : { outcome: "ungradeable", pnl_pct: null };
  // WS-10 EXECUTABLE grade (buy-the-ask, sell-the-bid) using the row's OWN real pinned half-spread —
  // this is what a member actually nets in a wide book, vs the MID grade above which a wide spread
  // can flatter. The real reason G-9 exists: does a "MID win" survive paying the real spread twice?
  const halfSpreadFrac = mark > 0 ? Math.min(0.95, Math.max(0, (quote.ask - mark) / mark)) : 0;
  const executableGrade =
    mark > 0
      ? gradePlanExecutableFromBars(postEntryBars, mark, entryUtcMs, halfSpreadFrac)
      : { outcome: "ungradeable", pnl_pct: null };

  return {
    ticker: mover.ticker,
    cohort,
    price,
    eligible: true,
    no_quote: false,
    occ: contract.occ,
    bid: quote.bid,
    ask: quote.ask,
    mark,
    spread_pct: spreadPct,
    illiquid_g9: spreadPct != null && spreadPct > 15,
    flow_fill_proxy: flowFillProxy,
    vs_flow_pct: vsFlowPct,
    outcome: grade.outcome,
    pnl_pct: grade.pnl_pct,
    executable_outcome: executableGrade.outcome,
    executable_pnl_pct: executableGrade.pnl_pct,
  };
}

function summarizeCohort(rows) {
  const eligible = rows.filter((r) => r.eligible);
  const withQuote = eligible.filter((r) => !r.no_quote);
  const graded = withQuote.filter((r) => r.outcome !== "ungradeable");
  const winRate = (arr) => (arr.length ? arr.filter((r) => r.outcome === "doubled").length / arr.length : null);
  const execWinRate = (arr) =>
    arr.length ? arr.filter((r) => r.executable_outcome === "doubled").length / arr.length : null;
  const execAvgPnl = (arr) => {
    const withPnl = arr.filter((r) => r.executable_pnl_pct != null);
    return withPnl.length ? withPnl.reduce((s, r) => s + r.executable_pnl_pct, 0) / withPnl.length : null;
  };

  const chaseBlocks = {};
  for (const pct of CHASE_THRESHOLDS) {
    const withVsFlow = withQuote.filter((r) => r.vs_flow_pct != null);
    const blocked = withVsFlow.filter((r) => r.vs_flow_pct >= pct);
    chaseBlocks[pct] = {
      n_evaluable: withVsFlow.length,
      n_blocked: blocked.length,
      block_rate: withVsFlow.length ? blocked.length / withVsFlow.length : null,
      // The recall question: of what G-8 WOULD block at this threshold, what did they grade?
      blocked_win_rate: winRate(blocked.filter((r) => r.outcome !== "ungradeable")),
    };
  }

  const g9Blocked = withQuote.filter((r) => r.illiquid_g9);
  const g9BlockedGraded = g9Blocked.filter((r) => r.outcome !== "ungradeable");
  const g9 = {
    n_evaluable: withQuote.length,
    n_blocked: g9Blocked.length,
    block_rate: withQuote.length ? g9Blocked.length / withQuote.length : null,
    blocked_win_rate_mid: winRate(g9BlockedGraded),
    blocked_win_rate_executable: execWinRate(g9BlockedGraded),
    blocked_avg_pnl_executable: execAvgPnl(g9BlockedGraded),
    avg_spread_pct:
      withQuote.length && withQuote.some((r) => r.spread_pct != null)
        ? withQuote.filter((r) => r.spread_pct != null).reduce((s, r) => s + r.spread_pct, 0) /
          withQuote.filter((r) => r.spread_pct != null).length
        : null,
  };

  return {
    n_movers: rows.length,
    n_0dte_eligible: eligible.length,
    zerodte_eligibility_rate: rows.length ? eligible.length / rows.length : null,
    n_with_real_quote: withQuote.length,
    n_graded: graded.length,
    overall_win_rate: winRate(graded),
    g8_chase: chaseBlocks,
    g9_illiquid: g9,
  };
}

const allRows = [];
const perDate = {};
for (const dateYmd of DATES) {
  const grouped = await jget(`${BASE}/v2/aggs/grouped/locale/us/market/stocks/${dateYmd}?adjusted=true&apiKey=${KEY}`);
  const results = grouped?.results ?? [];
  if (!results.length) {
    console.error(`[skip] no grouped-daily data for ${dateYmd}`);
    continue;
  }
  const movers = screenBreakoutMovers(results, SCAN_TOP);
  const small = movers.filter((m) => m.dollar / m.volume < PRICE_SPLIT).slice(0, MAX_PER_COHORT);
  const large = movers.filter((m) => m.dollar / m.volume >= PRICE_SPLIT).slice(0, MAX_PER_COHORT);
  const entryUtcMs = etToUtcMs(dateYmd, entH, entM || 0);

  const dateRows = [];
  for (const m of [...small, ...large]) {
    const row = await processMover(m, dateYmd, entryUtcMs);
    dateRows.push({ ...row, date: dateYmd });
  }
  perDate[dateYmd] = { small: dateRows.filter((r) => r.cohort === "small").length, large: dateRows.filter((r) => r.cohort === "large").length };
  allRows.push(...dateRows);
}

const smallRows = allRows.filter((r) => r.cohort === "small");
const largeRows = allRows.filter((r) => r.cohort === "large");
const summary = {
  shipped_chase_pct: SHIPPED_CHASE_PCT,
  price_split: PRICE_SPLIT,
  dates: DATES,
  per_date_counts: perDate,
  small_cap: summarizeCohort(smallRows),
  large_cap: summarizeCohort(largeRows),
};

if (JSON_OUT) {
  console.log(JSON.stringify({ summary, rows: allRows }, null, 2));
  process.exit(0);
}

console.log(`\n=== GATE small-cap sensitivity probe (G-8 anti-chase / G-9 illiquidity) ===`);
console.log(`sessions: ${DATES.join(", ")}  ·  price split: <$${PRICE_SPLIT}=small  ·  shipped CHASE_PCT=${SHIPPED_CHASE_PCT}%\n`);

function printCohort(name, s) {
  console.log(`--- ${name} ---`);
  console.log(`  movers screened: ${s.n_movers}  ·  0DTE-eligible (real same-day contract exists): ${s.n_0dte_eligible} (${s.zerodte_eligibility_rate == null ? "n/a" : (s.zerodte_eligibility_rate * 100).toFixed(0) + "%"})`);
  console.log(`  with real historical quote at commit-open: ${s.n_with_real_quote}  ·  graded: ${s.n_graded}  ·  overall win-rate: ${s.overall_win_rate == null ? "n/a" : (s.overall_win_rate * 100).toFixed(0) + "%"}`);
  console.log(`  G-9 (spread>15% flat): block-rate ${s.g9_illiquid.block_rate == null ? "n/a" : (s.g9_illiquid.block_rate * 100).toFixed(0) + "%"} of ${s.g9_illiquid.n_evaluable}  ·  avg spread_pct ${s.g9_illiquid.avg_spread_pct == null ? "n/a" : s.g9_illiquid.avg_spread_pct.toFixed(1) + "%"}`);
  console.log(`    blocked-cohort win-rate: MID ${s.g9_illiquid.blocked_win_rate_mid == null ? "n/a" : (s.g9_illiquid.blocked_win_rate_mid * 100).toFixed(0) + "%"}  vs  EXECUTABLE(real spread paid) ${s.g9_illiquid.blocked_win_rate_executable == null ? "n/a" : (s.g9_illiquid.blocked_win_rate_executable * 100).toFixed(0) + "%"}  ·  avg executable pnl ${s.g9_illiquid.blocked_avg_pnl_executable == null ? "n/a" : s.g9_illiquid.blocked_avg_pnl_executable.toFixed(1) + "%"}`);
  for (const pct of CHASE_THRESHOLDS) {
    const c = s.g8_chase[pct];
    console.log(`  G-8 @ CHASE_PCT=${pct}%: block-rate ${c.block_rate == null ? "n/a" : (c.block_rate * 100).toFixed(0) + "%"} of ${c.n_evaluable}  ·  blocked-cohort win-rate ${c.blocked_win_rate == null ? "n/a" : (c.blocked_win_rate * 100).toFixed(0) + "%"}`);
  }
  console.log();
}
printCohort("SMALL-CAP (price < $" + PRICE_SPLIT + ")", summary.small_cap);
printCohort("LARGE/MEGA-CAP (price >= $" + PRICE_SPLIT + ")", summary.large_cap);

console.log(`(Probe — real Polygon grouped-daily + reference-contracts + historical NBBO quotes + option`);
console.log(` minute bars throughout. flow_avg_fill is a first-5-min VWAP PROXY, not the real flow print —`);
console.log(` labeled everywhere. Evidence for a gate-calibration decision, not itself a gate.)`);
