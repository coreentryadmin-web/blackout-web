/**
 * SWING-CADENCE GAP RECALL PROBE
 * ================================
 *
 * WHY THIS EXISTS (NEEDS_MEASUREMENT item 1, Night Hawk Swings outcome-driven improvement mandate)
 * ---------------------------------------------------------------------------------------------
 * `scan-cadence.ts`'s own header states the design plainly: discovery runs in five ET-anchored
 * phase WINDOWS (POST_CLOSE/PRE_OPEN/MIDDAY/POWER_HOUR/OVERNIGHT), and "gaps ... simply map to no
 * phase -> the cron self-skips that firing." Two real gaps exist every session day: **9:15-12:00 ET**
 * (the open through late morning) and **13:00-15:00 ET** (early-to-mid afternoon) — nothing screens
 * FLOW accumulation for roughly 4h45m of every regular session. That is a documented, intentional
 * design (discovery is anchored to session-level checkpoints, not a heartbeat) — but nobody had
 * measured whether real tickers actually cross from neutral to directional INSIDE those gaps, and if
 * so, whether the underlying already made a real move before the NEXT covered phase could ever see
 * it. A gate/cap can be well-calibrated and a cadence gap can still be quietly leaking real recall —
 * they are independent questions, and this is the first measurement of the cadence one.
 *
 * THE QUESTION THIS PROBE ANSWERS: for each real ET session day in the fetched window, and each of
 * the two known gap windows, which tickers were NEUTRAL (no directional multi-day FLOW read) at the
 * gap's start but DIRECTIONAL by the gap's end — and for those, did the underlying's own price
 * already move favorably (in the candidate's own accumulation direction) between the refined
 * qualifying moment and the next covered phase's start, i.e. before discovery could ever act on it?
 * A high favorable-rate says the gap has a real, measurable recall cost; a low one says the gap is
 * cheap in practice even though it exists in the schedule.
 *
 * WHAT'S REAL vs. APPROXIMATED (same disclosure discipline as every other tool in this toolkit)
 * -----------------------------------------------------------------------------------------------
 * REAL (production code, never reimplemented):
 *   - `SWING_SCAN_PHASES` / `resolveScanPhase` (swing/scan-cadence.ts) — the real, deployed phase
 *     windows this probe derives its gap complement from. If scan-cadence.ts's windows ever change,
 *     this probe's gaps change with them automatically (imported, not copied).
 *   - `accumulationSignalsFromFlow` (zerodte/flow-accumulation-context.ts) — the REAL, shared
 *     (0DTE/Swing/Vector/Helix) multi-day FLOW accumulation engine. Run TWICE per gap (once at the
 *     gap's start boundary, once at its end boundary), each time fed ONLY the flow rows with
 *     `alerted_at <= boundary` — the caller-side future-leak guard this engine itself does not
 *     provide (see its own module header: "PURE: ... Deterministic given (rows, nowMs)" — it trusts
 *     the caller to have already windowed `rows`).
 *   - swing's own qualifying predicate (`discovery.ts`: `if (sig.direction !== "neutral")`) — this
 *     probe's "directional" test is the identical predicate, not an approximation of it.
 *   - `fetchStockMinuteBars` (providers/polygon.ts) — real Polygon 1-minute aggs for the qualifying-
 *     moment and catch-up-moment underlying prices.
 *
 * REAL DATA, DIFFERENT FETCH PATH (disclosed, same precedent as every gate-compound-funnel tool):
 * production reads FLOW candidates from a Postgres mirror of the UW flow-alerts feed; this probe
 * queries the same feed directly via REST (`fetchMarketFlowAlertRows`).
 *
 * NOT MEASURED / DISCLOSED SIMPLIFICATIONS (printed every run so a clean pass is never mistaken for
 * exhaustive):
 *   - This does NOT replay the full swing dossier/gate stack (G-S3/G-S4/G-S6/G-S12/G-S14) on a
 *     gap-qualified ticker — it only asks "did FLOW accumulation alone cross into directional inside
 *     the gap, and did the underlying move before the next phase." A ticker this probe flags
 *     "favorable" might still have failed a downstream gate even if discovery had seen it a phase
 *     earlier — this measures the CADENCE's own recall cost in isolation, not an end-to-end backtest
 *     of whether catching it earlier would have produced a better graded trade.
 *   - The catch-up moment is defined as the GAP'S OWN END BOUNDARY (which, by construction of
 *     `deriveGapWindows` as the exact complement of `SWING_SCAN_PHASES`, is identical to the start
 *     of the next covered phase) — the instant discovery would first structurally have a chance to
 *     see the ticker, not the instant a real scan actually ran and committed it (which also depends
 *     on the Tier-0 merge/rank/cap and every commit gate — out of scope here, see above).
 *   - The earliest day(s) in the fetched window have LESS lookback before their own morning gap than
 *     later days (the fetch only reaches `--days` back from now), which can under-count
 *     "already_covered" for a ticker whose real qualifying accumulation began before the fetch
 *     window — a HARNESS-FETCH-WINDOW artifact, not a cadence-design one. Disclosed per-day rather
 *     than dropping early days outright (dropping them would silently shrink the sample on exactly
 *     the days a first run most needs to see).
 *   - `--max-tickers` bounds how many gap-qualified tickers get a real Polygon minute-bar fetch per
 *     run (cost/rate-limit budget) — every ticker beyond the budget is named as SKIPPED (BUDGET),
 *     never silently dropped, per this toolkit's "no silent caps" convention.
 *   - A ticker whose own alert timestamps inside the gap are ALL already directional at the very
 *     first one tested still gets `findFirstDirectionalMs`'s exact-boundary answer — this is not
 *     approximated, it is the real per-alert-timestamp re-test the pure helper is built for.
 *
 * USAGE
 *   POLYGON_API_BASE=https://api.massive.com \
 *   env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY \
 *   node --import tsx scripts/audit/swing-cadence-gap-recall-probe.mjs [options]
 *
 * OPTIONS
 *   --days=N          multi-day FLOW lookback fetched from now (default 10 — enough to cover several
 *                     full ET session days plus the accumulation engine's own multi-day window)
 *   --min-premium=N   min alert premium for the raw UW fetch (default 250000 — matches
 *                     MULTI_DAY_MIN_PREMIUM, the real floor the shared accumulation engine assumes)
 *   --fav=N           favorable-move threshold in PERCENT (default 1.5 — a move must clear this,
 *                     sign-aligned to the candidate's own direction, to count as a real forgone edge
 *                     rather than noise)
 *   --max-tickers=N   harness budget on real Polygon minute-bar fetches for gap-qualified tickers
 *                     per run (default 60)
 *   --json            also print a machine-readable JSON summary at the end
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
const DAYS = Math.max(1, Number(argv.days ?? 10));
const MIN_PREMIUM = Math.max(0, Number(argv["min-premium"] ?? 250_000));
const FAV_THRESHOLD_PCT = Number(argv.fav ?? 1.5);
const MAX_TICKERS = Math.max(1, Number(argv["max-tickers"] ?? 60));
const EMIT_JSON = Boolean(argv.json);
const BARS_CONCURRENCY = 8;

const { fetchMarketFlowAlertRows } = await import(`${SRC}lib/providers/unusual-whales.ts`);
const { extractChainFieldsFromRaw } = await import(`${SRC}lib/flow-raw-fields.ts`);
const { dteFromExpiry } = await import(`${SRC}lib/flow-dte.ts`);
const { accumulationSignalsFromFlow } = await import(`${SRC}lib/zerodte/flow-accumulation-context.ts`);
const { SWING_SCAN_PHASES } = await import(`${SRC}lib/swing/scan-cadence.ts`);
const { fetchStockMinuteBars, fetchIndexMinuteBars } = await import(`${SRC}lib/providers/polygon.ts`);

// Index/non-equity instruments the equity minute-bar path can't price (ETFs like SPY/QQQ/IWM DO
// resolve as plain equities, so they stay off this list) — same set `zerodte-sim.mjs` uses. These
// need the `I:` prefix and the index-specific endpoint instead.
const INDEX_INSTRUMENTS = new Set(["SPX", "SPXW", "VIX", "VIXW", "NDX", "RUT", "XSP", "VVIX", "DJX"]);
const {
  deriveGapWindows,
  classifyGapTransition,
  findFirstDirectionalMs,
  gradeForgoneMove,
  etWallClockToUtcMs,
} = await import("./lib/swing-cadence-gap-eval.mjs");

const fmtPct = (n) => (n == null ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`);
const fmtHm = (mins) => `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
const pad = (s, w) => String(s).padEnd(w);
const line = (c = "─", w = 100) => c.repeat(w);
function etYmd(ms) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
}

/** Paginate UW flow-alerts backward via `older_than` until the window is covered — identical
 *  pagination contract to `swing-gate-compound-funnel.mjs`'s own `fetchMultiDayFlow`. */
async function fetchMultiDayFlow(endMs, days, minPremium) {
  const cutoffMs = endMs - days * 86_400_000;
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

/** Bounded-concurrency map — preserves input order. Identical helper to the sibling gate-compound
 *  funnels (kept as a local copy rather than a shared import — these harness scripts intentionally
 *  stay standalone/single-file per this toolkit's existing convention). */
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
console.log("  SWING-CADENCE GAP RECALL PROBE");
console.log(`  flow window ${DAYS}d back from now · raw fetch floor $${(MIN_PREMIUM / 1000).toFixed(0)}k · fav threshold ${FAV_THRESHOLD_PCT}% · bar-fetch budget ${MAX_TICKERS} tickers`);
console.log(line("═"));

// 1) MULTI-DAY FLOW (real UW feed, real REST path — see header disclosure).
console.log(`\n[1] Fetching multi-day UW flow (${DAYS}d back, min $${(MIN_PREMIUM / 1000).toFixed(0)}k)…`);
const mrows = await fetchMultiDayFlow(nowMs, DAYS, MIN_PREMIUM);
console.log(`    ${mrows.length} raw alerts fetched`);
if (!mrows.length) {
  console.log("\n  No flow in window (off-hours + empty cache, or UW unreachable). Nothing to measure.");
  process.exit(0);
}

// 2) MAP → MinimalFlowRow (identical recipe to swing-gate-compound-funnel.mjs), plus a resolved
//    `alertMs` field this probe needs for boundary filtering.
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
    dte: f.expiry ? dteFromExpiry(f.expiry) ?? undefined : undefined,
    alert_rule: chain.alert_rule ?? f.alert_rule ?? undefined,
    ask_pct: chain.ask_pct,
    open_interest: chain.open_interest,
    alerted_at: f.alerted_at,
    alertMs,
  });
}
console.log(`    ${flowRows.length} usable directional rows after CALL/PUT parse`);

// 3) Group by ET session day; drop TODAY (in-progress — its later phases/gaps haven't happened yet,
//    so grading them would leak the future into what should be a historical read).
const dayMap = new Map();
for (const r of flowRows) {
  const d = etYmd(r.alertMs);
  if (d === todayYmd) continue;
  if (!dayMap.has(d)) dayMap.set(d, []);
  dayMap.get(d).push(r);
}
const days = [...dayMap.keys()].sort();
console.log(`\n[2] ${days.length} complete ET session day(s) in window: ${days.join(", ") || "(none)"}`);
if (!days.length) {
  console.log("\n  Only today's (in-progress) session has flow in this window — nothing gradeable yet.");
  process.exit(0);
}

const gapWindows = deriveGapWindows(SWING_SCAN_PHASES.map((w) => ({ startMin: w.startMin, endMin: w.endMin })));
console.log(`\n[3] Gap windows derived from the REAL SWING_SCAN_PHASES (imported, not copied):`);
for (const g of gapWindows) console.log(`    ${fmtHm(g.startMin)}–${fmtHm(g.endMin)} ET`);

// 4) Per day × per gap: classify every ticker's transition, refine gap-qualified moments.
const tally = { already_covered: 0, never_qualified: 0, gap_qualified: 0, could_not_refine: 0 };
const gradeCandidates = []; // { ticker, day, gapLabel, refinedMs, catchUpMs, direction }

for (const day of days) {
  for (const gap of gapWindows) {
    const gapStartMs = etWallClockToUtcMs(day, gap.startMin);
    const gapEndMs = etWallClockToUtcMs(day, gap.endMin);
    if (gapEndMs > nowMs) continue; // guard: never grade a boundary still in the future

    const rowsAtStart = flowRows.filter((r) => r.alertMs <= gapStartMs);
    const rowsAtEnd = flowRows.filter((r) => r.alertMs <= gapEndMs);
    const accStart = accumulationSignalsFromFlow(rowsAtStart, gapStartMs);
    const accEnd = accumulationSignalsFromFlow(rowsAtEnd, gapEndMs);

    for (const [ticker, sigEnd] of accEnd) {
      const sigStart = accStart.get(ticker);
      const cls = classifyGapTransition({
        directionalAtGapStart: (sigStart?.direction ?? "neutral") !== "neutral",
        directionalAtGapEnd: sigEnd.direction !== "neutral",
      });
      tally[cls] += 1;
      if (cls !== "gap_qualified") continue;

      // Refine the exact qualifying moment by walking THIS ticker's own alert timestamps inside
      // the gap, ascending, re-testing the real engine at each one.
      const candidateMs = flowRows
        .filter((r) => r.ticker === ticker && r.alertMs > gapStartMs && r.alertMs <= gapEndMs)
        .map((r) => r.alertMs)
        .sort((a, b) => a - b);
      const refinedMs = findFirstDirectionalMs(candidateMs, (ms) => {
        const rowsAsOf = flowRows.filter((r) => r.alertMs <= ms);
        const sig = accumulationSignalsFromFlow(rowsAsOf, ms).get(ticker);
        return sig != null && sig.direction !== "neutral";
      });
      if (refinedMs == null) {
        tally.could_not_refine += 1;
        continue;
      }
      gradeCandidates.push({
        ticker,
        day,
        gapLabel: `${fmtHm(gap.startMin)}–${fmtHm(gap.endMin)}`,
        refinedMs,
        catchUpMs: gapEndMs,
        direction: sigEnd.direction,
      });
    }
  }
}

console.log(`\n[4] Transition tally across ${days.length} day(s) × ${gapWindows.length} gap window(s):`);
console.log(`    already_covered=${tally.already_covered}  never_qualified=${tally.never_qualified}  gap_qualified=${tally.gap_qualified}  could_not_refine=${tally.could_not_refine}`);

// 5) Grade forgone moves for gap-qualified candidates, budget-capped on real Polygon bar fetches.
const budgeted = gradeCandidates.slice(0, MAX_TICKERS);
const skippedForBudget = gradeCandidates.length - budgeted.length;
if (skippedForBudget > 0) {
  console.log(`\n[5] ${gradeCandidates.length} gap-qualified candidates found; ${skippedForBudget} SKIPPED (BUDGET) beyond --max-tickers=${MAX_TICKERS} — never silently dropped, named here.`);
} else {
  console.log(`\n[5] Grading ${budgeted.length} gap-qualified candidate(s) against real Polygon minute bars…`);
}

const graded = await mapPool(budgeted, BARS_CONCURRENCY, async (cand) => {
  let bars;
  try {
    bars = INDEX_INSTRUMENTS.has(cand.ticker)
      ? await fetchIndexMinuteBars(`I:${cand.ticker}`, cand.day, cand.day)
      : await fetchStockMinuteBars(cand.ticker, cand.day, cand.day);
  } catch (e) {
    return { ...cand, error: e instanceof Error ? e.message : String(e) };
  }
  if (!bars?.length) return { ...cand, error: "no bars returned" };

  // Last bar at or before the target instant; falls back to the first bar if the target predates
  // every bar returned (can happen right at the session's very first minute).
  const priceAt = (targetMs) => {
    let best = null;
    for (const b of bars) {
      if (b.t == null || !Number.isFinite(b.c)) continue;
      if (b.t <= targetMs) {
        if (best == null || b.t > best.t) best = b;
      }
    }
    return best?.c ?? bars[0]?.c ?? null;
  };

  const qualifyingPrice = priceAt(cand.refinedMs);
  const catchUpPrice = priceAt(cand.catchUpMs);
  const grade = gradeForgoneMove({ qualifyingPrice, catchUpPrice, direction: cand.direction, favThresholdPct: FAV_THRESHOLD_PCT });
  return { ...cand, qualifyingPrice, catchUpPrice, grade };
});

const gradedOk = graded.filter((g) => g.grade != null);
const favorable = gradedOk.filter((g) => g.grade.favorable);
const errored = graded.filter((g) => g.error || g.grade == null);

console.log(`\n${line()}`);
console.log("  GAP-QUALIFIED CANDIDATES — FORGONE MOVE (qualifying moment → next covered phase)");
console.log(line());
console.log(`  ${pad("TICKER", 8)}${pad("DAY", 12)}${pad("GAP", 14)}${pad("DIR", 6)}${pad("MOVE%", 10)}${pad("FAV?", 6)}NOTE`);
for (const g of graded) {
  const note = g.error ? g.error : g.grade == null ? "invalid price(s)" : "";
  console.log(
    `  ${pad(g.ticker, 8)}${pad(g.day, 12)}${pad(g.gapLabel, 14)}${pad(g.direction, 6)}${pad(g.grade ? fmtPct(g.grade.movePct) : "—", 10)}${pad(g.grade ? (g.grade.favorable ? "YES" : "no") : "—", 6)}${note}`
  );
}

console.log(`\n${line()}`);
console.log("  SUMMARY");
console.log(line());
console.log(`  Days measured:            ${days.length} (${days.join(", ")})`);
console.log(`  Gap windows:              ${gapWindows.map((g) => `${fmtHm(g.startMin)}–${fmtHm(g.endMin)}`).join(", ")}`);
console.log(`  already_covered:          ${tally.already_covered}`);
console.log(`  never_qualified:          ${tally.never_qualified}`);
console.log(`  gap_qualified:            ${tally.gap_qualified}  (${tally.could_not_refine} could not be refined to an exact moment)`);
console.log(`  Graded (bars available):  ${gradedOk.length} / ${graded.length} attempted  (${errored.length} errored/invalid, ${skippedForBudget} skipped for budget)`);
if (gradedOk.length > 0) {
  const favPct = (100 * favorable.length) / gradedOk.length;
  const avgMove = gradedOk.reduce((s, g) => s + g.grade.movePct, 0) / gradedOk.length;
  console.log(`  Favorable (move already ran ≥${FAV_THRESHOLD_PCT}% before next phase): ${favorable.length}/${gradedOk.length} (${favPct.toFixed(1)}%)`);
  console.log(`  Mean sign-aligned move:   ${fmtPct(avgMove)}`);
} else {
  console.log("  No gap-qualified candidate could be graded this run (insufficient bar coverage or none found) — INSUFFICIENT DATA, not a zero finding.");
}
console.log(line("═"));

if (EMIT_JSON) {
  console.log(JSON.stringify({
    days,
    gapWindows: gapWindows.map((g) => ({ startMin: g.startMin, endMin: g.endMin })),
    tally,
    graded: graded.map((g) => ({
      ticker: g.ticker, day: g.day, gapLabel: g.gapLabel, direction: g.direction,
      movePct: g.grade?.movePct ?? null, favorable: g.grade?.favorable ?? null, error: g.error ?? null,
    })),
    summary: gradedOk.length > 0 ? {
      gradedCount: gradedOk.length,
      favorableCount: favorable.length,
      favorablePct: (100 * favorable.length) / gradedOk.length,
      meanMovePct: gradedOk.reduce((s, g) => s + g.grade.movePct, 0) / gradedOk.length,
    } : null,
  }, null, 2));
}
