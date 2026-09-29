/**
 * HELIX SWEEP FORWARD-RETURN BACKTEST
 * ====================================
 *
 * WHY THIS EXISTS (operator directive, 2026-09-26): "Pull the backtest first. I want to know how
 * huge single-day sweeps perform as forward directional signals before changing production logic."
 * Full instruction (verbatim, see PR/finding for the complete text): separate CALL/PUT, premium
 * size, DTE, moneyness, volume/OI, repeated-vs-one-off, and underlying trend; measure underlying
 * return AND option performance at 1/2/3/5/10 trading days; do NOT replace or weaken the existing
 * persistence-based `flow-accumulation.ts` engine; compare sweep-origin vs block-origin vs the
 * EXISTING NightHawk accumulation-engine candidate population to determine incremental edge. This
 * script is PURE MEASUREMENT — it reads real UW flow + real Polygon bars, classifies, grades
 * forward outcomes, and reports. It writes nothing, gates nothing, and does not touch any
 * production discovery/scoring path. `flow-accumulation.ts` is imported read-only, never modified.
 *
 * TERMINOLOGY (disclosed, see helix-sweep-eval.mjs header): UW's flow-alerts payload has no literal
 * "is_block" field — `has_floor` (a floor-negotiated/crossed print) is used as the BLOCK proxy
 * throughout, stated once here rather than silently implied.
 *
 * THREE POPULATIONS COMPARED
 *   SWEEP    — every print with has_sweep && premium >= HUGE_PREMIUM_FLOOR ($1M, the codebase's own
 *              pre-existing "whale" threshold).
 *   BLOCK    — every print with has_floor && !has_sweep && premium >= HUGE_PREMIUM_FLOOR.
 *   BASELINE — the EXISTING, REAL, UNMODIFIED `accumulationSignalsFromFlow` (flow-accumulation.ts,
 *              shared with 0DTE/Vector/Helix) run as a rolling day-by-day snapshot over the SAME
 *              fetched rows (future-leak guarded: each day's snapshot sees only rows with
 *              alerted_at <= that day, mirroring swing-cadence-gap-recall-probe.mjs's own
 *              discipline) — one baseline "event" per ticker, on the FIRST day within the window its
 *              direction transitions from neutral to directional (a discovery-like moment, not a
 *              re-count of every day it stays directional).
 *
 * TWO REPORT LEVELS
 *   PRINT-LEVEL   — every qualifying SWEEP/BLOCK print (a ticker can appear many times — this is
 *                   what the repeated-vs-one-off and all other segmentation dimensions need).
 *                   Segments: CALL/PUT, premium-size quantile, DTE quantile, moneyness (|delta|)
 *                   quantile, volume/OI quantile, repeated-vs-one-off (same ticker/expiry/strike/
 *                   side hit 2+ times by a qualifying print of the SAME kind), trend alignment.
 *   POPULATION-LEVEL — first qualifying event PER TICKER for each of SWEEP/BLOCK/BASELINE (an
 *                   apples-to-apples "does this origin add edge" comparison — a ticker hit by 5
 *                   sweeps does not get to dominate the population-level win rate 5x).
 *
 * ENTRY-BAR RESOLUTION: one real Polygon daily-bar series is fetched PER TICKER (bounding API calls
 * to distinct tickers touched, not print count), spanning far enough back for the 20-day trend read
 * and far enough forward for the 10-trading-day horizon. Entry index = the bar whose ET day exactly
 * matches the print/event's own ET day (`etYmd(b.t) === entryYmd`, the same exact-match convention
 * `swing-regime-gate-recall-probe.mjs` uses) — no fallback to a nearby day; "entry day bar not
 * found" is an honest skip, never a fabricated substitute.
 *
 * OPTION-PERFORMANCE CAVEAT (disclosed, see helix-sweep-eval.mjs): a first-order delta+theta LINEAR
 * PROXY, not a real observed option fill — ignores gamma/vega/IV-crush, weakest at the 10d horizon.
 *
 * DATA-AVAILABILITY FINDING (measured 2026-09-26, before this script's first real run — see
 * helix-sweep-eval.mjs's own header): UW's flow-alerts feed only carries live greeks
 * (delta/theta/gamma/vega/rho/iv) for roughly the trailing 3 CALENDAR days of a paginated fetch;
 * every row older than that returns `delta: null`. Because this backtest deliberately looks back
 * far enough to have COMPLETED 10-trading-day forward windows (via FORWARD_BUFFER_DAYS), delta is
 * essentially NEVER available on the population actually graded here. Consequence, disclosed rather
 * than hidden: (1) MONEYNESS is measured via a delta-FREE proxy instead — `otmPctAbs`, computed from
 * strike vs the real underlying price at alert time, which UW does send regardless of alert age;
 * (2) the OPTION-PERFORMANCE PROXY (needs delta) will show near-zero N for this study's real
 * population — this is a genuine upstream data boundary of the flow-alerts feed, not a bug in this
 * script, and the underlying-return measurement (which needs no greeks at all) is therefore the
 * load-bearing half of this backtest's option-performance ask.
 *
 * RATE-LIMIT / PRODUCTION-SAFETY DISCIPLINE (CLAUDE.md, 2026-09-17 incident): this run's own UW
 * flow-alerts pagination and per-ticker Polygon daily-bar fetches share the SAME production rate
 * limiters live discovery/commit depends on. Bounded concurrency (BARS_CONCURRENCY), a hard
 * --max-tickers budget, and no companion heavy backtest should run concurrently with this one.
 *
 * USAGE
 *   POLYGON_API_BASE=https://api.massive.com \
 *   env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY \
 *   node --import tsx scripts/audit/helix-sweep-forward-return-backtest.mjs [options]
 *
 * OPTIONS
 *   --days=N          calendar-day lookback for the UW flow fetch, ending FORWARD_BUFFER_DAYS
 *                      before now so most alerts have a chance at a completed 10d horizon
 *                      (default 30). Prints too close to `now` still honestly report
 *                      insufficient_data at the longer horizons rather than being excluded upfront.
 *   --min-premium=N    raw UW fetch floor (default 250000 — matches MULTI_DAY_MIN_PREMIUM, the
 *                      engine's own real floor, so the BASELINE population sees exactly what
 *                      production's accumulation engine would see).
 *   --huge-premium=N   the SWEEP/BLOCK qualifying floor (default 1000000 — HUGE_PREMIUM_FLOOR).
 *   --max-tickers=N    harness fetch-budget bound on distinct tickers' daily-bar fetches
 *                      (default 150).
 *   --json             also print a machine-readable JSON block at the end.
 *
 * Secrets from env only (UW_API_KEY, POLYGON_API_KEY). Nothing written or committed; read-only.
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
const DAYS = Math.max(1, Number(argv.days ?? 30));
const MIN_PREMIUM = Math.max(0, Number(argv["min-premium"] ?? 250_000));
const HUGE_PREMIUM = Math.max(0, Number(argv["huge-premium"] ?? 1_000_000));
const MAX_TICKERS = Math.max(1, Number(argv["max-tickers"] ?? 150));
const EMIT_JSON = Boolean(argv.json);
const BARS_CONCURRENCY = 5; // paced deliberately — see header's rate-limit discipline note
const HORIZONS = [1, 2, 3, 5, 10];
const FORWARD_BUFFER_DAYS = 16; // ~10 trading days + weekend/holiday margin

const { fetchMarketFlowAlertRows } = await import(`${SRC}lib/providers/unusual-whales.ts`);
const { accumulationSignalsFromFlow } = await import(`${SRC}lib/zerodte/flow-accumulation-context.ts`);
const { fetchStockDailyBars } = await import(`${SRC}lib/providers/polygon.ts`);
const {
  classifyPrint,
  identityKey,
  isHugeSweep,
  isHugeBlock,
  repeatedClassification,
  trendAlignment,
  forwardUnderlyingReturn,
  optionReturnProxy,
  bucketByVariableQuantile,
  bucketedMetricVerdict,
  baselineSummary,
} = await import("./lib/helix-sweep-eval.mjs");

const fmtUsd = (n) =>
  n == null ? "—" : n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(0)}k` : `$${n.toFixed(0)}`;
const pad = (s, w) => String(s).padEnd(w);
const padL = (s, w) => String(s).padStart(w);
const line = (c = "─", w = 104) => c.repeat(w);
function etYmd(ms) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
}

/** Bounded-concurrency map — preserves input order (same shape as the sibling gate-compound tools). */
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

/** Paginate UW flow-alerts backward via `older_than` until [startMs, endMs] is covered. `maxPages`
 *  must scale with the requested day-count — a fixed cap silently under-covers a wide window (a
 *  10d window alone consumed ~42 pages at the $250k floor in a live smoke test), which would read
 *  as "the window is this small" when really it's "pagination stopped early." */
async function fetchWindowFlow(startMs, endMs, minPremium, maxPages) {
  const rows = [];
  const seen = new Set();
  let olderThan = new Date(endMs).toISOString();
  let coveredFullWindow = false;
  let pagesUsed = 0;
  for (let page = 0; page < maxPages; page++) {
    pagesUsed = page + 1;
    let batch;
    try {
      batch = await fetchMarketFlowAlertRows({ limit: 200, min_premium: minPremium, older_than: olderThan });
    } catch (e) {
      console.warn(`  [flow] page ${page + 1} failed: ${e instanceof Error ? e.message : e}`);
      break;
    }
    if (!batch?.length) { coveredFullWindow = true; break; } // real end of tape reached
    let oldestIso = null;
    let oldestMs = Infinity;
    for (const mr of batch) {
      const iso = mr.flow?.alerted_at;
      const ms = Date.parse(iso ?? "");
      if (Number.isFinite(ms) && ms < oldestMs) { oldestMs = ms; oldestIso = iso; }
      const key = `${mr.flow?.ticker}|${mr.flow?.expiry}|${mr.flow?.strike}|${mr.flow?.option_type}|${mr.flow?.alerted_at}|${mr.flow?.premium}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (Number.isFinite(ms) && ms >= startMs && ms <= endMs) rows.push(mr);
    }
    if (!oldestIso || oldestMs === Infinity) { coveredFullWindow = true; break; }
    if (oldestMs < startMs) { coveredFullWindow = true; break; }
    if (oldestIso === olderThan) { coveredFullWindow = true; break; } // no progress, stop
    olderThan = oldestIso;
  }
  return { rows, pagesUsed, coveredFullWindow };
}

// ── MAIN ─────────────────────────────────────────────────────────────────────────
const nowMs = Date.now();
const endMs = nowMs - FORWARD_BUFFER_DAYS * 86_400_000;
const startMs = endMs - DAYS * 86_400_000;
const today = etYmd(nowMs);

console.log(line("═"));
console.log(`  HELIX SWEEP FORWARD-RETURN BACKTEST — as-of ${today}`);
console.log(`  flow window ${etYmd(startMs)}..${etYmd(endMs)} (${DAYS}d, ${FORWARD_BUFFER_DAYS}d forward buffer) · raw fetch floor ${fmtUsd(MIN_PREMIUM)} · huge floor ${fmtUsd(HUGE_PREMIUM)} · ticker budget ${MAX_TICKERS}`);
console.log(line("═"));

console.log(`\n[1] Fetching UW flow (${DAYS}d window, min ${fmtUsd(MIN_PREMIUM)})…`);
// Empirically ~4.2 pages/day at the $250k floor (measured live 2026-09-26: 8409 rows / 10d @ 200/page);
// 8x margin keeps this from silently truncating a wide --days window (see fetchWindowFlow's own header).
const MAX_FLOW_PAGES = Math.max(60, Math.ceil(DAYS * 8));
const { rows: mrows, pagesUsed, coveredFullWindow } = await fetchWindowFlow(startMs, endMs, MIN_PREMIUM, MAX_FLOW_PAGES);
console.log(`    ${mrows.length} raw alerts fetched (${pagesUsed}/${MAX_FLOW_PAGES} pages)${coveredFullWindow ? "" : " — WARNING: page budget exhausted BEFORE reaching the start of the window; the fetched population under-covers --days, raise MAX_FLOW_PAGES or shrink --days"}`);
if (!mrows.length) {
  console.log("\n  No flow in window. Nothing to measure.");
  process.exit(0);
}

// 2) Classify every row (pure, no IO) — this is the full print population before any huge-floor cut.
const allPrints = [];
for (const mr of mrows) {
  const p = classifyPrint(mr.flow, mr.raw ?? {});
  if (p) allPrints.push(p);
}
console.log(`    ${allPrints.length} classifiable prints (ticker+side+expiry+strike+time all present)`);

const sweepPrints = allPrints.filter((p) => isHugeSweep(p, HUGE_PREMIUM));
const blockPrints = allPrints.filter((p) => isHugeBlock(p, HUGE_PREMIUM));
console.log(`\n[2] SWEEP (huge, has_sweep): ${sweepPrints.length}    BLOCK (huge, has_floor proxy): ${blockPrints.length}`);

// 3) Repeated-vs-one-off counts, computed WITHIN each population separately (a sweep repeated 3x
//    vs a block appearing once are different questions).
function withRepeatedFlag(prints) {
  const counts = new Map();
  for (const p of prints) counts.set(identityKey(p), (counts.get(identityKey(p)) ?? 0) + 1);
  return prints.map((p) => ({ ...p, repeated: repeatedClassification(counts.get(identityKey(p))) }));
}
const sweepPrintsR = withRepeatedFlag(sweepPrints);
const blockPrintsR = withRepeatedFlag(blockPrints);

// 4) BASELINE population — the REAL, unmodified accumulation engine, rolling day-by-day snapshot,
//    future-leak guarded (each day's snapshot sees only rows with alerted_at <= that day's end).
//    One event PER TICKER, on the first day it transitions from neutral to directional in-window.
function toMinimalFlowRow(mr) {
  const f = mr.flow;
  const raw = mr.raw ?? {};
  if (!f?.ticker || !f.option_type || f.option_type === "UNKNOWN") return null;
  return {
    ticker: f.ticker,
    premium: f.premium,
    option_type: f.option_type,
    strike: f.strike,
    expiry: f.expiry,
    alert_rule: typeof raw.alert_rule === "string" ? raw.alert_rule : f.alert_rule ?? undefined,
    open_interest: Number(raw.open_interest) || undefined,
    alerted_at: f.alerted_at,
  };
}
const minimalRows = mrows.map(toMinimalFlowRow).filter(Boolean);
const distinctDays = [...new Set(minimalRows.map((r) => etYmd(Date.parse(r.alerted_at))))].sort();
console.log(`\n[3] BASELINE (real accumulationSignalsFromFlow) — rolling day-by-day snapshot across ${distinctDays.length} distinct ET day(s)…`);

const baselineFirstSeen = new Map(); // ticker -> { day, direction }
for (const day of distinctDays) {
  const dayEndMs = Date.parse(`${day}T23:59:59Z`);
  const rowsUpToDay = minimalRows.filter((r) => Date.parse(r.alerted_at) <= dayEndMs);
  const signals = accumulationSignalsFromFlow(rowsUpToDay, dayEndMs);
  for (const [ticker, sig] of signals) {
    if (sig.direction === "neutral") continue;
    if (baselineFirstSeen.has(ticker)) continue; // only the FIRST transition into directional
    baselineFirstSeen.set(ticker, { ticker, day, direction: sig.direction === "bull" ? "bull" : "bear" });
  }
}
console.log(`    ${baselineFirstSeen.size} distinct tickers reached directional accumulation in-window (first-transition events)`);

// 5) Union of tickers needing a real Polygon daily-bar fetch — bounded by --max-tickers.
const tickerFirstTouch = new Map(); // ticker -> earliest ms any population touches it (for budget ordering)
function touch(ticker, ms) {
  const cur = tickerFirstTouch.get(ticker);
  if (cur == null || ms < cur) tickerFirstTouch.set(ticker, ms);
}
for (const p of sweepPrintsR) touch(p.ticker, p.alertedAtMs);
for (const p of blockPrintsR) touch(p.ticker, p.alertedAtMs);
for (const [, ev] of baselineFirstSeen) touch(ev.ticker, Date.parse(`${ev.day}T00:00:00Z`));

const allTickers = [...tickerFirstTouch.entries()].sort((a, b) => a[1] - b[1]).map(([t]) => t);
const budgetedTickers = allTickers.slice(0, MAX_TICKERS);
const skippedTickers = allTickers.length - budgetedTickers.length;
console.log(`\n[4] ${allTickers.length} distinct tickers touched by any population; fetching daily bars for ${budgetedTickers.length}${skippedTickers > 0 ? ` (${skippedTickers} SKIPPED — beyond --max-tickers=${MAX_TICKERS}, never silently dropped, named here)` : ""}`);

const barsByTicker = await mapPool(budgetedTickers, BARS_CONCURRENCY, async (ticker) => {
  const firstTouchMs = tickerFirstTouch.get(ticker);
  const fromYmd = new Date(firstTouchMs - 40 * 86_400_000).toISOString().slice(0, 10); // 40d trailing for the 20d SMA
  const toYmd = new Date(nowMs).toISOString().slice(0, 10); // through today — as much forward history as exists
  try {
    const bars = await fetchStockDailyBars(ticker, fromYmd, toYmd);
    const sorted = (bars ?? []).filter((b) => Number.isFinite(b?.t) && Number.isFinite(b?.c)).sort((a, b) => a.t - b.t);
    return [ticker, sorted];
  } catch (e) {
    console.warn(`  [bars] ${ticker} failed: ${e instanceof Error ? e.message : e}`);
    return [ticker, []];
  }
});
const barsMap = new Map(barsByTicker);
const budgetedSet = new Set(budgetedTickers);

/** Grade one classified print/event against its ticker's own real daily-bar series. Returns null
 *  (never fabricates) when the entry day's own bar is missing or the ticker was budget-skipped. */
function gradeAgainstBars(ticker, entryYmd, direction, extra = {}) {
  if (!budgetedSet.has(ticker)) return null;
  const bars = barsMap.get(ticker) ?? [];
  if (!bars.length) return null;
  const entryIdx = bars.findIndex((b) => etYmd(b.t) === entryYmd);
  if (entryIdx === -1) return null; // honest skip — see header, no fallback to a nearby day
  const closesBefore = bars.slice(0, entryIdx).map((b) => b.c);
  const trend = trendAlignment(closesBefore, direction);
  const row = { ticker, entryYmd, direction, trendAligned: trend?.aligned ?? null, ...extra };
  for (const h of HORIZONS) {
    row[`fwdRet_${h}d`] = forwardUnderlyingReturn(bars, entryIdx, h, direction);
  }
  return row;
}

console.log(`\n[5] Grading PRINT-LEVEL sweep/block populations against real daily bars + delta/theta option proxy…`);
function gradePrintPopulation(prints) {
  const out = [];
  for (const p of prints) {
    const direction = p.aggressorDirection ?? p.sideDirection;
    const entryYmd = etYmd(p.alertedAtMs);
    const graded = gradeAgainstBars(p.ticker, entryYmd, direction, {
      premium: p.premium,
      dte: p.dte,
      otmPctAbs: p.otmPctAbs, // moneyness via strike-vs-spot, not delta — see header finding
      volumeOiRatio: p.volumeOiRatio,
      repeated: p.repeated,
      side: p.side,
    });
    if (!graded) continue;
    const bars = barsMap.get(p.ticker) ?? [];
    const entryIdx = bars.findIndex((b) => etYmd(b.t) === entryYmd);
    for (const h of HORIZONS) {
      graded[`optRet_${h}d`] = optionReturnProxy(p, bars, entryIdx, h);
    }
    out.push(graded);
  }
  return out;
}
const sweepGraded = gradePrintPopulation(sweepPrintsR);
const blockGraded = gradePrintPopulation(blockPrintsR);
console.log(`    SWEEP graded: ${sweepGraded.length}/${sweepPrintsR.length}    BLOCK graded: ${blockGraded.length}/${blockPrintsR.length}  (ungraded = budget-skipped ticker or entry-day bar not found)`);

console.log(`\n[6] Grading POPULATION-LEVEL baseline (first-transition-per-ticker) events…`);
const baselineGraded = [];
for (const [, ev] of baselineFirstSeen) {
  const graded = gradeAgainstBars(ev.ticker, ev.day, ev.direction, {});
  if (graded) baselineGraded.push(graded);
}
console.log(`    BASELINE graded: ${baselineGraded.length}/${baselineFirstSeen.size}`);

// First-qualifying-event-per-ticker views of SWEEP/BLOCK, for the fair population-level comparison.
function firstPerTicker(graded) {
  const seen = new Map();
  for (const r of graded) {
    if (!seen.has(r.ticker) || Date.parse(`${r.entryYmd}T00:00:00Z`) < Date.parse(`${seen.get(r.ticker).entryYmd}T00:00:00Z`)) {
      seen.set(r.ticker, r);
    }
  }
  return [...seen.values()];
}
const sweepPopLevel = firstPerTicker(sweepGraded);
const blockPopLevel = firstPerTicker(blockGraded);

// ── REPORT ───────────────────────────────────────────────────────────────────────
console.log(`\n${line("═")}`);
console.log(`  POPULATION-LEVEL COMPARISON (first qualifying event per ticker — apples-to-apples)`);
console.log(line("═"));
console.log(`    ${pad("population", 12)}${padL("n", 6)}   ` + HORIZONS.map((h) => padL(`${h}d WR%`, 10)).join("") + "  " + HORIZONS.map((h) => padL(`${h}d avg%`, 10)).join(""));
function popRow(label, rows) {
  const stats = HORIZONS.map((h) => baselineSummary(rows, `fwdRet_${h}d`));
  console.log(
    `    ${pad(label, 12)}${padL(rows.length, 6)}   ` +
      stats.map((s) => padL(s.winRate ?? "—", 10)).join("") +
      "  " +
      stats.map((s) => padL(s.avgOutcome ?? "—", 10)).join("")
  );
  return stats;
}
const sweepPopStats = popRow("SWEEP", sweepPopLevel);
const blockPopStats = popRow("BLOCK", blockPopLevel);
const baselinePopStats = popRow("BASELINE", baselineGraded);

console.log(`\n    Reading this table: WR% = % of the population with a positive sign-aligned underlying`);
console.log(`    move at that horizon; avg% = mean sign-aligned return. BASELINE is the EXISTING, real,`);
console.log(`    unmodified flow-accumulation.ts engine's own directional candidates — the bar sweeps/blocks`);
console.log(`    must clear to be worth a SEPARATE discovery path rather than just noise inside the existing one.`);

console.log(`\n${line("═")}`);
console.log(`  PRINT-LEVEL SEGMENTATION — SWEEP population (n=${sweepGraded.length})`);
console.log(line("═"));

function reportSegment(label, rows, variableKey, opts = {}) {
  console.log(`\n  [${label}] bucketed by ${variableKey}:`);
  for (const h of [1, 5, 10]) { // headline horizons in the console report; full 5 horizons in --json
    const buckets = bucketByVariableQuantile(rows, variableKey, `fwdRet_${h}d`, opts);
    const verdict = bucketedMetricVerdict(buckets, "winRate", { minN: opts.minN ?? 5 });
    const bstr = buckets.map((b) => `${b.label}(n=${b.n},WR=${b.winRate ?? "—"}%,avg=${b.avgOutcome ?? "—"}%)`).join("  ");
    console.log(`    ${h}d: ${bstr || "(no usable rows)"}  → ${verdict.verdict}${verdict.rho != null ? ` (rho=${verdict.rho})` : ""}`);
  }
}
function reportCategorical(label, rows, keyFn, horizons = [1, 5, 10]) {
  console.log(`\n  [${label}]:`);
  const groups = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    if (k == null) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  for (const h of horizons) {
    const parts = [...groups.entries()].map(([k, grp]) => {
      const s = baselineSummary(grp, `fwdRet_${h}d`);
      return `${k}(n=${s.n},WR=${s.winRate ?? "—"}%,avg=${s.avgOutcome ?? "—"}%)`;
    });
    console.log(`    ${h}d: ${parts.join("  ") || "(no groups)"}`);
  }
}

reportCategorical("CALL vs PUT", sweepGraded, (r) => r.side);
reportSegment("PREMIUM SIZE", sweepGraded, "premium", { minPerBucket: 5, maxBuckets: 4 });
reportSegment("DTE", sweepGraded, "dte", { minPerBucket: 5, maxBuckets: 4 });
reportSegment("MONEYNESS (|OTM%|, delta-free — see header finding)", sweepGraded, "otmPctAbs", { minPerBucket: 5, maxBuckets: 4 });
reportSegment("VOLUME/OI RATIO", sweepGraded, "volumeOiRatio", { minPerBucket: 5, maxBuckets: 4 });
reportCategorical("REPEATED vs ONE-OFF", sweepGraded, (r) => r.repeated);
reportCategorical("UNDERLYING TREND ALIGNMENT", sweepGraded, (r) => r.trendAligned);

console.log(`\n${line("═")}`);
console.log(`  PRINT-LEVEL SEGMENTATION — BLOCK population (n=${blockGraded.length})`);
console.log(line("═"));
reportCategorical("CALL vs PUT", blockGraded, (r) => r.side);
reportSegment("PREMIUM SIZE", blockGraded, "premium", { minPerBucket: 5, maxBuckets: 4 });
reportSegment("DTE", blockGraded, "dte", { minPerBucket: 5, maxBuckets: 4 });
reportSegment("MONEYNESS (|OTM%|, delta-free — see header finding)", blockGraded, "otmPctAbs", { minPerBucket: 5, maxBuckets: 4 });
reportSegment("VOLUME/OI RATIO", blockGraded, "volumeOiRatio", { minPerBucket: 5, maxBuckets: 4 });
reportCategorical("REPEATED vs ONE-OFF", blockGraded, (r) => r.repeated);
reportCategorical("UNDERLYING TREND ALIGNMENT", blockGraded, (r) => r.trendAligned);

console.log(`\n${line("═")}`);
console.log(`  OPTION-PERFORMANCE PROXY (delta+theta linear estimate — NOT a real fill, see header)`);
console.log(`  N shown per-horizon is the count with a USABLE (non-null delta) proxy, not total graded rows —`);
console.log(`  see the DATA-AVAILABILITY FINDING in this script's header if this reads much lower than expected.`);
console.log(line("═"));
function optRow(label, rows) {
  const stats = HORIZONS.map((h) => baselineSummary(rows, `optRet_${h}d`));
  console.log(`    ${pad(label, 12)}${padL(rows.length, 6)}   ` + stats.map((s) => padL(`n=${s.n}`, 10)).join(""));
  console.log(
    `    ${pad("", 12)}${padL("", 6)}   ` +
      stats.map((s) => padL(s.winRate ?? "—", 10)).join("") +
      "  " +
      stats.map((s) => padL(s.avgOutcome ?? "—", 10)).join("")
  );
}
console.log(`    ${pad("population", 12)}${padL("total", 6)}   ` + HORIZONS.map((h) => padL(`${h}d usable`, 10)).join(""));
console.log(`    ${pad("", 12)}${padL("", 6)}   ` + HORIZONS.map((h) => padL(`${h}d WR%`, 10)).join("") + "  " + HORIZONS.map((h) => padL(`${h}d avg%`, 10)).join(""));
optRow("SWEEP", sweepGraded);
optRow("BLOCK", blockGraded);

console.log(`\n${line("═")}`);
console.log(`  NOT MEASURED / DISCLOSED SIMPLIFICATIONS THIS RUN`);
console.log(line("═"));
console.log(`    - has_floor is a DISCLOSED proxy for "block" — UW has no literal is_block field.`);
console.log(`    - Option performance is a delta+theta LINEAR PROXY, not a real observed option fill.`);
console.log(`    - DATA AVAILABILITY: UW's flow-alerts feed only carries live greeks for ~3 calendar days`);
console.log(`      back; this backtest's population is older than that by design (needs a completed 10d`);
console.log(`      forward window), so the option-performance proxy's usable N is near-zero here — a real`);
console.log(`      upstream boundary, not a bug. MONEYNESS uses a delta-free strike-vs-spot proxy instead.`);
console.log(`    - BASELINE dedupes to first neutral->directional transition per ticker; does not`);
console.log(`      replay the full production Tier-0/Tier-1/gate stack — it isolates the SAME`);
console.log(`      accumulation-engine signal sweeps/blocks are being compared against, nothing more.`);
console.log(`    - Prints alerted close to \`now\` (within ~${FORWARD_BUFFER_DAYS}d) may still legitimately lack a`);
console.log(`      completed 10d horizon; those rows report null there, honestly reducing that`);
console.log(`      horizon's own N rather than being excluded from the whole run.`);
console.log(`    - flow-accumulation.ts itself is imported READ-ONLY and untouched by this script.`);
console.log(line("═"));

if (EMIT_JSON) {
  console.log("\n<<<JSON>>>");
  console.log(JSON.stringify({
    asOf: today,
    window: { startYmd: etYmd(startMs), endYmd: etYmd(endMs), days: DAYS, forwardBufferDays: FORWARD_BUFFER_DAYS, pagesUsed, coveredFullWindow },
    counts: {
      rawAlerts: mrows.length,
      classifiablePrints: allPrints.length,
      sweepPrints: sweepPrints.length,
      blockPrints: blockPrints.length,
      baselineTransitionEvents: baselineFirstSeen.size,
      distinctTickersTouched: allTickers.length,
      tickersBudgeted: budgetedTickers.length,
      tickersSkippedForBudget: skippedTickers,
    },
    populationLevel: {
      sweep: { n: sweepPopLevel.length, byHorizon: Object.fromEntries(HORIZONS.map((h, i) => [`${h}d`, sweepPopStats[i]])) },
      block: { n: blockPopLevel.length, byHorizon: Object.fromEntries(HORIZONS.map((h, i) => [`${h}d`, blockPopStats[i]])) },
      baseline: { n: baselineGraded.length, byHorizon: Object.fromEntries(HORIZONS.map((h, i) => [`${h}d`, baselinePopStats[i]])) },
    },
    printLevel: {
      sweep: sweepGraded,
      block: blockGraded,
    },
  }, null, 2));
}
