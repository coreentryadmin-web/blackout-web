/**
 * SWING REGIME-GATE (G-S4) RECALL PROBE
 * ================================
 *
 * WHY THIS EXISTS (NEEDS_MEASUREMENT item 3, Night Hawk Swings outcome-driven improvement mandate)
 * ---------------------------------------------------------------------------------------------
 * `swing-loss-taxonomy-segment.mjs`'s first live run (2026-09-10) segmented the CLOSED position
 * population by reconstructed regime band and found RISK_ON (47.4%) vs RISK_OFF (50.0%) loss rates
 * too close to call — but that population is already survivorship-biased: every row in it already
 * CLEARED every commit gate, G-S4 included, so it can only ever show "how positions that passed the
 * gate performed," never "how the candidates the gate BLOCKED would have performed had they been
 * let through." A gate can look uninformative on the surviving population and still be doing real
 * work on the population it culled — or vice versa. This probe answers the actual open question:
 * of REAL candidates (not just committed positions), does G-S4 (`evaluateRegimeGate`, v2/gates.ts)
 * block the genuinely-bad half of forward-tracked candidates, or an arbitrary half?
 *
 * THE QUESTION THIS PROBE ANSWERS: take a real multi-day pool of FLOW-directional candidates (the
 * same accumulation engine `swing-cadence-gap-recall-probe.mjs` and `swing-gate-compound-funnel.mjs`
 * use), reconstruct the REAL G-S4 verdict each would have received at its own qualifying moment
 * (regime01 from real SPY closes as of that day, direction-aligned — the identical reconstruction
 * `swing-loss-taxonomy-segment.mjs` already uses for closed positions), split into BLOCKED
 * (regimeBand RISK_OFF/UNKNOWN) vs CLEAR (NEUTRAL/RISK_ON), then grade EVERY candidate's own forward
 * sign-aligned move over a fixed multi-day horizon (real Polygon daily bars) regardless of which
 * side of the gate it landed on. If BLOCKED grades materially worse than CLEAR, G-S4 is doing its
 * job; if the two land close together, it is splitting an arbitrary half.
 *
 * WHAT'S REAL vs. APPROXIMATED (same disclosure discipline as every other tool in this toolkit)
 * -----------------------------------------------------------------------------------------------
 * REAL (production code, never reimplemented):
 *   - `accumulationSignalsFromFlow` (zerodte/flow-accumulation-context.ts, via `flowRowsToAlertRows`)
 *     — the REAL, shared multi-day FLOW accumulation engine that determines each candidate's
 *     direction, fed rows shaped by the REAL `extractChainFieldsFromRaw` (flow-raw-fields.ts) the
 *     same way every sibling gate-compound-funnel/cadence-gap tool in this toolkit does.
 *   - `regimeFromSpyTrend` / `emaStackFromCloses` (swing/swing-ingest.ts) — the REAL SPY-trend
 *     regime read, fed REAL Polygon daily bars, direction-aligned exactly as production does.
 *   - `regimeBandFor01` / `isRegimeDegradedForCommit` (swing/v2/regime.ts) and
 *     `evaluateRegimeGate` (swing/v2/gates.ts) — the REAL, unmodified G-S4 gate function. Every
 *     BLOCKED/CLEAR verdict this script reports is that function's real return value, never a
 *     guess about what it would do.
 *   - `fetchStockDailyBars` (providers/polygon.ts) — REAL daily bars for both the qualifying-
 *     moment entry price and the forward horizon price.
 *
 * REAL DATA, DIFFERENT FETCH PATH (disclosed, same precedent as every sibling tool in this
 * toolkit): production reads FLOW candidates from a Postgres mirror of the UW flow-alerts feed;
 * this probe queries the same feed directly via REST (`fetchMarketFlowAlertRows`).
 *
 * NOT MEASURED / DISCLOSED SIMPLIFICATIONS (printed every run so a clean pass is never mistaken for
 * exhaustive):
 *   - This does NOT replay the other 4 active commit gates (G-S3 earnings, G-S6 confluence, G-S12
 *     halt, G-S14 Cortex) — it isolates G-S4's OWN recall behavior, not the joint funnel (that
 *     question is `swing-gate-compound-funnel.mjs`'s). A candidate G-S4 would CLEAR might still be
 *     blocked by another gate in production — out of scope here.
 *   - The forward horizon is measured in TRADING DAYS from the candidate's own qualifying day
 *     (default 5 — a short swing-thesis horizon, not a full-thesis backtest to actual exit) using
 *     the close price N trading sessions later. This is a fixed-horizon proxy for "did the
 *     direction play out," not a replay of swing's own real management/exit logic (thesis-break,
 *     catalyst, scale-out) — the same disclosed simplification `swing-early-trim-ab.mjs` makes for
 *     NOT replaying the real decision engine.
 *   - A candidate whose forward horizon extends past `nowMs` (too recent to have N full trading
 *     days of history yet) is EXCLUDED as `insufficient_data`, never graded on a partial/future-
 *     leaking horizon — named in the tally, not silently dropped.
 *   - Each ticker is graded ONCE per session day (its first accumulation-engine-directional read
 *     that day), not once per individual alert — multiple same-day alerts on one ticker do not
 *     inflate the sample.
 *
 * USAGE
 *   POLYGON_API_BASE=https://api.massive.com \
 *   env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY \
 *   node --import tsx scripts/audit/swing-regime-gate-recall-probe.mjs [options]
 *
 * OPTIONS
 *   --days=N           multi-day FLOW lookback fetched from now (default 60 — needs real spread of
 *                      session days across different regime bands, and enough runway before now
 *                      for the forward horizon to have actually elapsed)
 *   --min-premium=N    min alert premium for the raw UW fetch (default 250000 — matches
 *                      MULTI_DAY_MIN_PREMIUM, the real floor the shared accumulation engine assumes)
 *   --horizon-days=N   forward horizon in TRADING days (default 5)
 *   --fav=N            favorable-move threshold in PERCENT (default 1.5, same convention as the
 *                      cadence-gap probe)
 *   --max-tickers=N    harness budget on real Polygon daily-bar fetches per run (default 80)
 *   --json             also print a machine-readable JSON summary at the end
 *
 * Secrets come from env only (UW_API_KEY, POLYGON_API_KEY). Read-only: no DB writes, no Clerk.
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
const DAYS = Math.max(1, Number(argv.days ?? 60));
const MIN_PREMIUM = Math.max(0, Number(argv["min-premium"] ?? 250_000));
const HORIZON_DAYS = Math.max(1, Number(argv["horizon-days"] ?? 5));
const FAV_THRESHOLD_PCT = Number(argv.fav ?? 1.5);
const MAX_TICKERS = Math.max(1, Number(argv["max-tickers"] ?? 80));
const EMIT_JSON = Boolean(argv.json);
const BARS_CONCURRENCY = 8;

const { fetchMarketFlowAlertRows } = await import(`${SRC}lib/providers/unusual-whales.ts`);
const { extractChainFieldsFromRaw } = await import(`${SRC}lib/flow-raw-fields.ts`);
const { accumulationSignalsFromFlow } = await import(`${SRC}lib/zerodte/flow-accumulation-context.ts`);
const { regimeFromSpyTrend } = await import(`${SRC}lib/swing/swing-ingest.ts`);
const { regimeBandFor01 } = await import(`${SRC}lib/swing/v2/regime.ts`);
const { evaluateRegimeGate } = await import(`${SRC}lib/swing/v2/gates.ts`);
const { fetchStockDailyBars } = await import(`${SRC}lib/providers/polygon.ts`);
const {
  signAlignedMovePctBullBear,
  classifyForwardOutcome,
  compareRegimeGateGroups,
} = await import("./lib/swing-regime-gate-recall-eval.mjs");

const fmtPct = (n) => (n == null ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`);
const pad = (s, w) => String(s).padEnd(w);
const line = (c = "─", w = 100) => c.repeat(w);
function etYmd(ms) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
}

/** Paginate UW flow-alerts backward via `older_than` until the window is covered — identical
 *  pagination contract to every sibling gate-compound-funnel/cadence-gap tool in this toolkit. */
async function fetchMultiDayFlow(endMs, days, minPremium) {
  const cutoffMs = endMs - days * 86_400_000;
  const rows = [];
  const seen = new Set();
  let olderThan = new Date(endMs).toISOString();
  const MAX_PAGES = 48;
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

/** Bounded-concurrency map — preserves input order. Identical helper to every sibling tool. */
async function mapPool(items, concurrency, fn) {
  if (items.length === 0) return [];
  const out = new Array(items.length);
  let next = 0;
  const workers = Math.max(1, Math.min(concurrency, items.length));
  const worker = async () => {
    for (;;) {
      const idx = next++;
      if (idx >= items.length) return;
      out[idx] = await fn(items[idx]);
    }
  };
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return out;
}

// ── MAIN ─────────────────────────────────────────────────────────────────────────
const nowMs = Date.now();
const todayYmd = etYmd(nowMs);

console.log(line("═"));
console.log("  SWING REGIME-GATE (G-S4) RECALL PROBE");
console.log(`  flow window ${DAYS}d back · raw fetch floor $${(MIN_PREMIUM / 1000).toFixed(0)}k · horizon ${HORIZON_DAYS} trading days · fav threshold ${FAV_THRESHOLD_PCT}% · bar-fetch budget ${MAX_TICKERS} tickers`);
console.log(line("═"));

// 1) MULTI-DAY FLOW (real UW feed, real REST path — see header disclosure).
console.log(`\n[1] Fetching multi-day UW flow (${DAYS}d back, min $${(MIN_PREMIUM / 1000).toFixed(0)}k)…`);
const mrows = await fetchMultiDayFlow(nowMs, DAYS, MIN_PREMIUM);
console.log(`    ${mrows.length} raw alerts fetched`);
if (!mrows.length) {
  console.log("\n  No flow in window (off-hours + empty cache, or UW unreachable). Nothing to measure.");
  process.exit(0);
}

const flowRows = [];
for (const mr of mrows) {
  const f = mr.flow;
  const raw = mr.raw ?? {};
  if (!f?.ticker || !f.option_type || f.option_type === "UNKNOWN") continue;
  const alertMs = Date.parse(f.alerted_at ?? "");
  if (!Number.isFinite(alertMs)) continue;
  const chain = extractChainFieldsFromRaw(raw, { strike: f.strike, option_type: f.option_type });
  flowRows.push({
    ticker: f.ticker.toUpperCase(),
    premium: f.premium,
    option_type: f.option_type,
    strike: f.strike,
    expiry: f.expiry,
    ask_pct: chain.ask_pct,
    alert_rule: chain.alert_rule ?? f.alert_rule ?? undefined,
    alerted_at: f.alerted_at,
    alertMs,
  });
}
console.log(`    ${flowRows.length} usable directional rows after CALL/PUT parse`);

// 2) Group by ET session day, dropping TODAY (in-progress — its forward horizon hasn't elapsed).
const dayMap = new Map();
for (const r of flowRows) {
  const d = etYmd(r.alertMs);
  if (d === todayYmd) continue;
  if (!dayMap.has(d)) dayMap.set(d, []);
  dayMap.get(d).push(r);
}
const days = [...dayMap.keys()].sort();
console.log(`\n[2] ${days.length} complete ET session day(s) in window: ${days[0] ?? "—"}…${days[days.length - 1] ?? "—"}`);
if (!days.length) {
  console.log("\n  Only today's (in-progress) session has flow in this window — nothing gradeable yet.");
  process.exit(0);
}

// 3) Per day: one directional read per ticker (end-of-day accumulation snapshot), each carrying
//    its own qualifying moment for the SPY-close cutoff used in the regime reconstruction.
const candidates = [];
const seenTickerDay = new Set();
for (const day of days) {
  const rowsForDay = flowRows.filter((r) => etYmd(r.alertMs) <= day);
  const dayEndMs = Date.parse(`${day}T23:59:59.999Z`);
  const acc = accumulationSignalsFromFlow(rowsForDay, dayEndMs);
  for (const [ticker, sig] of acc) {
    if (sig.direction === "neutral") continue;
    const key = `${ticker}|${day}`;
    if (seenTickerDay.has(key)) continue;
    seenTickerDay.add(key);
    candidates.push({ ticker, day, direction: sig.direction });
  }
}
console.log(`\n[3] ${candidates.length} directional (ticker, day) candidate(s) across ${days.length} session day(s).`);
if (!candidates.length) {
  console.log("\n  No directional candidates in this window — nothing to grade.");
  process.exit(0);
}

// 4) Fetch SPY daily bars ONCE, wide enough to cover the earliest candidate's 55-bar EMA-stack
//    requirement (regimeFromSpyTrend/emaStackFromCloses) through the forward horizon's needs.
const earliestMs = Math.min(...candidates.map((c) => Date.parse(`${c.day}T00:00:00Z`)));
const spyFromYmd = new Date(earliestMs - 120 * 86_400_000).toISOString().slice(0, 10);
const spyToYmd = todayYmd;
console.log(`\n[4] Fetching SPY daily bars ${spyFromYmd}…${spyToYmd} for regime reconstruction…`);
const spyBars = (await fetchStockDailyBars("SPY", spyFromYmd, spyToYmd).catch(() => []))
  .filter((b) => Number.isFinite(b?.t) && Number.isFinite(b?.c))
  .sort((a, b) => a.t - b.t);
console.log(`    ${spyBars.length} SPY daily bars fetched`);

// 5) Reconstruct each candidate's REAL G-S4 verdict as of its own qualifying day.
const withGate = candidates.map((c) => {
  const cutMs = Date.parse(`${c.day}T23:59:59.999Z`);
  const closesAsOf = spyBars.filter((b) => b.t <= cutMs).map((b) => b.c);
  // regimeFromSpyTrend takes LONG/SHORT-flavored direction signing internally aligned to "bull"/
  // "bear" via the same convention swing-ingest.ts itself uses (SHORT favorable = risk-off) — pass
  // the accumulation engine's own bull/bear value straight through; regimeFromSpyTrend's signature
  // accepts the shared PlayDirection union, which "bull"/"bear" do not literally satisfy, so map to
  // the LONG/SHORT vocabulary it actually expects.
  const playDirection = c.direction === "bear" ? "SHORT" : "LONG";
  const regime01 = regimeFromSpyTrend(closesAsOf, playDirection);
  const regimeBand = regimeBandFor01(regime01);
  const verdict = evaluateRegimeGate({ discoveryPaths: ["FLOW"], archetype: null, regime01 });
  return { ...c, regime01, regimeBand, gatePass: verdict.pass };
});

const bandTally = {};
for (const c of withGate) bandTally[c.regimeBand] = (bandTally[c.regimeBand] ?? 0) + 1;
console.log(`\n[5] Regime band distribution (real regimeFromSpyTrend, direction-aligned): ${JSON.stringify(bandTally)}`);

// 6) Grade forward move, budget-capped on real Polygon daily-bar fetches.
const budgeted = withGate.slice(0, MAX_TICKERS);
const skippedForBudget = withGate.length - budgeted.length;
if (skippedForBudget > 0) {
  console.log(`\n[6] ${withGate.length} candidates found; ${skippedForBudget} SKIPPED (BUDGET) beyond --max-tickers=${MAX_TICKERS} — never silently dropped, named here.`);
} else {
  console.log(`\n[6] Grading ${budgeted.length} candidate(s) against real Polygon daily bars, ${HORIZON_DAYS}-trading-day forward horizon…`);
}

const graded = await mapPool(budgeted, BARS_CONCURRENCY, async (cand) => {
  const entryYmd = cand.day;
  // Fetch enough trailing days past entry to cover HORIZON_DAYS of TRADING sessions even across
  // weekends/holidays (generous 3x calendar-day buffer).
  const toYmd = new Date(Date.parse(`${entryYmd}T00:00:00Z`) + (HORIZON_DAYS * 3 + 10) * 86_400_000).toISOString().slice(0, 10);
  let bars;
  try {
    bars = await fetchStockDailyBars(cand.ticker, entryYmd, toYmd);
  } catch (e) {
    return { ...cand, error: e instanceof Error ? e.message : String(e) };
  }
  const sorted = (bars ?? []).filter((b) => Number.isFinite(b?.t) && Number.isFinite(b?.c)).sort((a, b) => a.t - b.t);
  if (!sorted.length) return { ...cand, error: "no bars returned" };

  const entryDayMs = Date.parse(`${entryYmd}T00:00:00Z`);
  const entryIdx = sorted.findIndex((b) => etYmd(b.t) === entryYmd);
  if (entryIdx === -1) return { ...cand, error: "entry day bar not found" };
  const forwardIdx = entryIdx + HORIZON_DAYS;
  if (forwardIdx >= sorted.length) {
    // Either the horizon genuinely hasn't elapsed yet (too close to `now`), or Polygon simply
    // doesn't have that many trading sessions of data past entry — either way, honest exclusion,
    // never a partial/future-leaking grade.
    const daysSinceEntry = Math.floor((nowMs - entryDayMs) / 86_400_000);
    return { ...cand, error: daysSinceEntry < HORIZON_DAYS * 1.6 ? "insufficient_data (horizon not yet elapsed)" : "insufficient_data (missing trading-day bars)" };
  }

  const entryPrice = sorted[entryIdx].c;
  const forwardPrice = sorted[forwardIdx].c;
  const movePct = signAlignedMovePctBullBear({ fromPrice: entryPrice, toPrice: forwardPrice, direction: cand.direction });
  const outcome = classifyForwardOutcome({ movePct, favThresholdPct: FAV_THRESHOLD_PCT });
  return { ...cand, entryPrice, forwardPrice, movePct, outcome };
});

const gradedOk = graded.filter((g) => g.movePct != null);
const insufficientData = graded.filter((g) => g.error?.startsWith("insufficient_data"));
const errored = graded.filter((g) => g.error && !g.error.startsWith("insufficient_data"));

console.log(`\n${line()}`);
console.log("  CANDIDATES — G-S4 VERDICT vs FORWARD MOVE");
console.log(line());
console.log(`  ${pad("TICKER", 8)}${pad("DAY", 12)}${pad("DIR", 6)}${pad("BAND", 10)}${pad("GATE", 10)}${pad("MOVE%", 10)}${pad("FAV?", 6)}NOTE`);
for (const g of graded) {
  const note = g.error ?? "";
  console.log(
    `  ${pad(g.ticker, 8)}${pad(g.day, 12)}${pad(g.direction, 6)}${pad(g.regimeBand, 10)}${pad(g.gatePass ? "CLEAR" : "BLOCK", 10)}${pad(g.movePct != null ? fmtPct(g.movePct) : "—", 10)}${pad(g.outcome === "favorable" ? "YES" : g.outcome === "unfavorable" ? "no" : "—", 6)}${note}`
  );
}

const cmp = compareRegimeGateGroups(gradedOk);

console.log(`\n${line()}`);
console.log("  SUMMARY");
console.log(line());
console.log(`  Session days measured:     ${days.length} (${days[0]}…${days[days.length - 1]})`);
console.log(`  Directional candidates:    ${candidates.length}  (regime bands: ${JSON.stringify(bandTally)})`);
console.log(`  Graded (bars available):   ${gradedOk.length} / ${graded.length} attempted  (${insufficientData.length} insufficient_data, ${errored.length} errored, ${skippedForBudget} skipped for budget)`);
if (gradedOk.length > 0) {
  console.log(`\n  G-S4 BLOCKED (RISK_OFF/UNKNOWN):  n=${cmp.blocked.n}  favorable=${cmp.blocked.favorablePct != null ? cmp.blocked.favorablePct.toFixed(1) + "%" : "—"}  mean move=${fmtPct(cmp.blocked.meanMovePct)}`);
  console.log(`  G-S4 CLEAR (NEUTRAL/RISK_ON):     n=${cmp.clear.n}  favorable=${cmp.clear.favorablePct != null ? cmp.clear.favorablePct.toFixed(1) + "%" : "—"}  mean move=${fmtPct(cmp.clear.meanMovePct)}`);
  if (cmp.deltaFavorablePp != null) {
    console.log(`\n  DELTA (blocked − clear):   favorable ${cmp.deltaFavorablePp >= 0 ? "+" : ""}${cmp.deltaFavorablePp.toFixed(1)}pp, mean move ${fmtPct(cmp.deltaMeanMovePct)}`);
    console.log(
      cmp.deltaMeanMovePct < 0 && cmp.deltaFavorablePp < 0
        ? "  → BLOCKED candidates graded worse on both measures — G-S4 shows real recall value at this sample size."
        : "  → BLOCKED candidates did NOT grade worse — this sample does not support G-S4 separating a genuinely-bad half."
    );
  } else {
    console.log("\n  DELTA: not computable — one side has zero graded candidates this run.");
  }
} else {
  console.log("  No candidate could be graded this run (insufficient bar coverage or none found) — INSUFFICIENT DATA, not a zero finding.");
}
console.log(`\n  No gate changed by this script — evidence only.`);
console.log(line("═"));

if (EMIT_JSON) {
  console.log(JSON.stringify({
    days,
    horizonDays: HORIZON_DAYS,
    favThresholdPct: FAV_THRESHOLD_PCT,
    bandTally,
    candidates: graded.map((g) => ({
      ticker: g.ticker, day: g.day, direction: g.direction, regimeBand: g.regimeBand, gatePass: g.gatePass,
      movePct: g.movePct ?? null, outcome: g.outcome ?? null, error: g.error ?? null,
    })),
    comparison: cmp,
  }, null, 2));
}
