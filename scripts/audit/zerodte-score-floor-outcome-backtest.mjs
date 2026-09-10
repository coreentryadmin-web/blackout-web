/**
 * 0DTE SCORE_FLOOR OUTCOME BACKTEST — is the 65 floor calibrated, or is the score formula
 * underscoring tradeable setups? (the "next question, not yet answered" `zerodte-gate-compound-
 * funnel.mjs` left open, 2026-09-08/09)
 * ============================================================================================
 *
 * WHY THIS EXISTS
 * ----------------
 * `zerodte-gate-compound-funnel.mjs` measured, twice (2026-09-08 off-hours n=15, 2026-09-09 RTH
 * n=26), that `score_floor` (gates.ts G-3, `ZERODTE_SCORE_FLOOR = 65`) is the dominant ISOLATED-
 * rejection gate on FLOW-origin 0DTE setups — 84.6% isolated failure at RTH, the clear chokepoint
 * on play COUNT the operator has repeatedly complained about live. That script's own header ended
 * with: "is score_floor's threshold itself miscalibrated, or is the score formula underscoring
 * setups that are actually tradeable? Needs a backtest of the score distribution against forward
 * outcomes before touching the threshold." This is that backtest.
 *
 * THE METHOD, using the SAME verdict discipline `helix-score-signal.mjs` used for an analogous
 * "does this score actually rank anything" question (HELIX-MAP §9.7): bucket a real population of
 * SCORED setups — not just the ones that cleared every gate and committed, the FULL population
 * `deriveZeroDteSetups` (board.ts) produces after its own 4 evidence gates but BEFORE score_floor
 * or any other hard gate is applied — by score into FIXED bands (chosen before looking at any
 * result, straddling 65 exactly: see `lib/score-floor-backtest-eval.mjs`'s header), grade each
 * setup's forward outcome on REAL Polygon minute bars with the same favorable-first proxy
 * `discovery-recall-probe.mjs`/`merge-precedence-ab.mjs` use, and ask whether score RANKS outcome
 * (a monotonic Spearman trend + a real spread — `scoreSeparation`, imported unchanged from
 * `helix-score-eval.mjs` so the verdict language cannot drift from HELIX's own RANKS / SPREAD
 * WITHOUT ORDER / INVERTED / FLAT distinctions) or is flat/scrambled noise.
 *
 * THIS SCRIPT NEVER PROPOSES OR MAKES A GATE/THRESHOLD CHANGE. It is evidence-gathering only,
 * exactly like `cortex-oppose-magnitude-ab.mjs` / `tier-exit-mode-ab.mjs` / every other calibration
 * A/B in this repo's audit toolkit — it reports a verdict and leaves the decision to a human (or a
 * future, separately-reviewed change) reading that verdict.
 *
 * FEASIBILITY — WHY THIS IS BUILDABLE FROM THIS SANDBOX (the open question the task brief posed
 * before assuming it):
 *   Committed rows (what `score_floor` actually blocked in PRODUCTION) live in
 *   `zerodte_setup_log`/`entry_context` — Postgres, raw TCP blocked here (CLAUDE.md "Access
 *   reality"). But the SCORE ITSELF is computed entirely from FLOW-ALERT evidence
 *   (`deriveZeroDteSetups`, board.ts) — no DB read required to reproduce it — and
 *   `zerodte-gate-compound-funnel.mjs` already re-derives that exact population for "now" via a
 *   direct UW REST re-fetch (disclosed there: same alerts, different pipe from production's
 *   Postgres-fed path). The only gap was doing it for MANY HISTORICAL SESSIONS instead of one
 *   live "now" — and UW's `/api/option-trades/flow-alerts` `older_than` pagination reaches back
 *   at least 27 calendar days from this sandbox (measured live 2026-09-10: two probe fetches at
 *   `min_premium=250000` walked from "now" to 2026-08-14 in 100 pages with zero errors — see the
 *   PR description for the raw probe output). So: buildable, and built.
 *   NOT buildable from here: exactly what production's OWN gate stack would have done with each
 *   historical setup (that needs the frozen `entry_context` a committed row carries, or a live
 *   multi-gate replay like `zerodte-gate-compound-funnel.mjs` running historically) — this script
 *   answers the narrower, but still load-bearing, question of whether `score` alone ranks outcome.
 *
 * WHAT'S REAL vs. APPROXIMATED (same honesty discipline as every sibling A/B in this toolkit):
 * REAL:
 *   - deriveZeroDteSetups (board.ts) — the REAL 4-evidence-gate funnel AND the REAL score formula,
 *     run per historical session day with that day's own accumulation window and `todayYmd`/`nowMs`
 *     (so `dte`/expiry-vs-today filtering is recomputed correctly for EACH historical day, not just
 *     "now" — `dteFromExpiry` takes an explicit `nowMs` for exactly this).
 *   - REAL UW flow-alerts (direct REST, disclosed above — same alerts, different pipe from the
 *     Postgres table production reads from, same disclosure `zerodte-gate-compound-funnel.mjs`
 *     already carries).
 *   - REAL Polygon minute bars for every graded (ticker, session-day) pair.
 * APPROXIMATED / NOT MEASURED (printed every run, never silently absent):
 *   - Grading is the favorable-first UNDERLYING-continuation proxy, not exact option P&L (no
 *     strike, no premium decay, no exit-management rule) — same scope limit `helix-score-signal.mjs`
 *     states for its own analogous question.
 *   - A FIXED representative entry time (`--entry`, default 10:00 ET) is used for every setup on a
 *     given day, not the setup's own real intraday accumulation-complete moment — the same
 *     simplifying convention `discovery-recall-probe.mjs`/`merge-precedence-ab.mjs` already use, for
 *     the same reason (there is no single well-defined "entry instant" for a multi-print
 *     accumulated setup).
 *   - This measures `score` ALONE vs forward outcome — it does NOT jointly apply the other ~14
 *     hard gates `zerodte-gate-compound-funnel.mjs` measures (VIX regime, confluence, governor,
 *     Cortex, etc.). A setup graded here as a "65-74 win" might still be blocked live by a different
 *     gate; this script is silent on that, by design — it isolates the ONE variable the standing
 *     question is about.
 *   - `maxSetups` passed to `deriveZeroDteSetups` here is deliberately huge (`--max-setups-per-day`,
 *     default 500) rather than the production/funnel-script default (12/40) — a small cap SORTS BY
 *     SCORE DESC and slices, which would silently truncate exactly the low-score tail this backtest
 *     exists to measure. Documented here so a reader does not mistake this for the live board's cap.
 *
 * USAGE
 *   env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY \
 *   node --import tsx scripts/audit/zerodte-score-floor-outcome-backtest.mjs [options]
 *
 * OPTIONS
 *   --sessions=N          distinct historical trading days to test (default 15, most recent
 *                         COMPLETE sessions found in the fetched window — today's in-progress
 *                         session is always excluded, its own bars aren't final yet)
 *   --lookback-days=N     per-day flow accumulation window, matching production's own
 *                         MULTI_DAY_MIN_PREMIUM convention and the funnel script's --days (default 3)
 *   --min-premium=N       min alert premium to ingest (default 250000, matches MULTI_DAY_MIN_PREMIUM)
 *   --max-setups-per-day=N  see APPROXIMATED note above (default 500)
 *   --entry=HH:MM         fixed ET entry time used for every graded setup (default "10:00")
 *   --fav=F               favorable-first target, underlying return (default 0.015)
 *   --adv=F               adverse-first stop, underlying return (default fav/2)
 *   --concurrency=N       Polygon minute-bar fetch concurrency (default 10)
 *   --fetch-calendar-days=N  how far back (calendar days) to page the UW flow-alerts fetch before
 *                         giving up (default 30 — comfortably covers sessions+lookback+weekends)
 *   --json                also print a machine-readable JSON block at the end
 *
 * Secrets from env only (UW_API_KEY, POLYGON_API_KEY). Nothing written or committed. Read-only.
 */

if (!process.env.POLYGON_API_BASE || !/^https?:\/\//.test(process.env.POLYGON_API_BASE)) {
  process.env.POLYGON_API_BASE = "https://api.massive.com";
}
const SRC = new URL("../../src/", import.meta.url).pathname;

const { fetchMarketFlowAlertRows } = await import(`${SRC}lib/providers/unusual-whales.ts`);
const { extractChainFieldsFromRaw } = await import(`${SRC}lib/flow-raw-fields.ts`);
const { dteFromExpiry } = await import(`${SRC}lib/flow-dte.ts`);
const { deriveZeroDteSetups } = await import(`${SRC}lib/zerodte/board.ts`);
const { ZERODTE_SCORE_FLOOR } = await import(`${SRC}lib/zerodte/gates.ts`);
const { fetchStockMinuteBars } = await import(`${SRC}lib/providers/polygon.ts`);
const { partitionGradeable, ungradedTickers } = await import("./lib/helix-score-eval.mjs");
const {
  SCORE_BUCKETS,
  gradeDirection,
  summarizeByBucket,
  crossFloorComparison,
  scoreSeparation,
} = await import("./lib/score-floor-backtest-eval.mjs");

const argv = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    return m ? [m[1], m[2] ?? "true"] : [a, "true"];
  })
);
const SESSIONS = Math.max(1, Number(argv.sessions ?? 15));
const LOOKBACK_DAYS = Math.max(0, Number(argv["lookback-days"] ?? 3));
const MIN_PREMIUM = Math.max(0, Number(argv["min-premium"] ?? 250_000));
const MAX_SETUPS_PER_DAY = Math.max(1, Number(argv["max-setups-per-day"] ?? 500));
const FAV = Number(argv.fav ?? 0.015);
const ADV = Number(argv.adv ?? FAV / 2);
const CONCURRENCY = Math.max(1, Number(argv.concurrency ?? 10));
const FETCH_CALENDAR_DAYS = Math.max(LOOKBACK_DAYS + SESSIONS, Number(argv["fetch-calendar-days"] ?? 30));
const EMIT_JSON = Boolean(argv.json);
const [entH, entM] = String(argv.entry ?? "10:00").split(":").map(Number);
// Same EDT-only convention `zerodte-gate-compound-funnel.mjs`/`merge-precedence-ab.mjs` use — the
// test window below (recent weeks) is firmly inside EDT, and DST is out of scope for this backtest.
const ET_OFFSET = -4;
const ENTRY_UTC_MIN = (entH - ET_OFFSET) * 60 + (entM || 0);
const CLOSE_UTC_MIN = (16 - ET_OFFSET) * 60;

const fmtUsd = (n) =>
  n == null ? "—" : n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(0)}k` : `$${n.toFixed(0)}`;
const pad = (s, w) => String(s).padEnd(w);
const padL = (s, w) => String(s).padStart(w);
const line = (c = "─", w = 100) => c.repeat(w);
function etYmd(ms) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
}
/** UTC midnight-anchored ms for an ET calendar date's 20:00 UTC close (4pm EDT) — a plain
 *  Date.parse of `${ymd}T20:00:00Z` is exact for this because the ET_OFFSET=-4 convention above is
 *  already baked into every UTC-minute comparison this script makes. */
const closeMsFor = (ymd) => Date.parse(`${ymd}T20:00:00Z`);

/** Bounded-concurrency map, preserving input order (same shape as the sibling A/B harnesses). */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  }));
  return out;
}

console.log(line("═"));
console.log("  0DTE SCORE_FLOOR OUTCOME BACKTEST — score vs forward outcome, FULL scored population");
console.log(`  sessions=${SESSIONS} · lookback=${LOOKBACK_DAYS}d · min premium ${fmtUsd(MIN_PREMIUM)} · entry ${String(argv.entry ?? "10:00")} ET · fav ${(FAV * 100).toFixed(2)}% / adv ${(ADV * 100).toFixed(2)}%`);
console.log(`  shipped ZERODTE_SCORE_FLOOR (gates.ts G-3, FLOW origin) = ${ZERODTE_SCORE_FLOOR}`);
console.log(line("═"));

// ── 1) ONE broad backward UW flow-alerts fetch, deduped, covering FETCH_CALENDAR_DAYS back ──────
console.log(`\n[1] Fetching UW flow-alerts back ${FETCH_CALENDAR_DAYS} calendar days (min ${fmtUsd(MIN_PREMIUM)})…`);
const nowMs = Date.now();
const cutoffMs = nowMs - FETCH_CALENDAR_DAYS * 86_400_000;
const allRows = [];
const seen = new Set();
let olderThan = new Date(nowMs).toISOString();
const MAX_PAGES = 220; // generous ceiling; the loop's own cutoff/no-progress checks stop it earlier
for (let page = 0; page < MAX_PAGES; page++) {
  let batch;
  try {
    batch = await fetchMarketFlowAlertRows({ limit: 200, min_premium: MIN_PREMIUM, older_than: olderThan });
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
    if (Number.isFinite(ms) && ms >= cutoffMs) allRows.push(mr);
  }
  if (page % 10 === 0) console.log(`    page ${page}: ${allRows.length} rows so far, oldest=${oldestIso}`);
  if (!oldestIso || oldestMs === Infinity || oldestIso === olderThan) break;
  if (oldestMs < cutoffMs) break;
  olderThan = oldestIso;
}
console.log(`    ${allRows.length} raw alerts fetched (deduped) across the window`);
if (!allRows.length) {
  console.log("\n  No flow in window. Nothing to measure.");
  process.exit(0);
}
const earliestRowMs = allRows.reduce((min, mr) => {
  const ms = Date.parse(mr.flow?.alerted_at ?? "");
  return Number.isFinite(ms) && ms < min ? ms : min;
}, Infinity);

// ── 2) Map to FlowSetupInput ONCE (fields other than `dte` are date-invariant); `dte` is
//    recomputed PER TEST DAY below, since it's a function of (expiry, as-of date). ───────────────
const baseRows = [];
for (const mr of allRows) {
  const f = mr.flow;
  const raw = mr.raw ?? {};
  if (!f?.ticker || !f.option_type || f.option_type === "UNKNOWN") continue;
  const chain = extractChainFieldsFromRaw(raw, { strike: f.strike, option_type: f.option_type });
  const alertMs = Date.parse(f.alerted_at ?? "");
  if (!Number.isFinite(alertMs)) continue;
  baseRows.push({
    ticker: f.ticker,
    premium: f.premium,
    option_type: f.option_type,
    strike: f.strike,
    expiry: f.expiry,
    alertMs,
    alert_rule: chain.alert_rule ?? f.alert_rule ?? undefined,
    ask_pct: chain.ask_pct,
    underlying_price: chain.underlying_price,
    fill_price: chain.fill_price,
    open_interest: chain.open_interest,
    alerted_at: f.alerted_at,
  });
}
console.log(`    ${baseRows.length} usable directional rows after CALL/PUT parse`);

// ── 3) Pick the SESSIONS most recent COMPLETE trading days present in the fetched window ────────
const today = etYmd(nowMs);
const distinctDays = [...new Set(baseRows.map((r) => etYmd(r.alertMs)))]
  .filter((d) => d !== today) // today's session is still open — its bars aren't final
  .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0)); // descending (most recent first)

const testDays = [];
const skippedInsufficientLookback = [];
for (const d of distinctDays) {
  if (testDays.length >= SESSIONS) break;
  const dClose = closeMsFor(d);
  const lookbackStart = dClose - LOOKBACK_DAYS * 86_400_000;
  if (lookbackStart < earliestRowMs) {
    // Honest guard: this day's accumulation window would silently read a truncated lookback
    // (some of the pre-history the real production job would have seen fell outside the fetch),
    // which would understate premium/prints for setups near this day — skip and NAME it rather
    // than quietly grading on partial history.
    skippedInsufficientLookback.push(d);
    continue;
  }
  testDays.push(d);
}
testDays.sort(); // chronological for the printed per-day table
console.log(`\n[2] Testing ${testDays.length} session day(s): ${testDays.join(", ") || "(none)"}`);
if (skippedInsufficientLookback.length) {
  console.log(`    skipped (insufficient lookback history in the fetched window): ${skippedInsufficientLookback.join(", ")}`);
}
if (!testDays.length) {
  console.log("\n  No session day had a fully-covered lookback window. Widen --fetch-calendar-days.");
  process.exit(0);
}

// ── 4) Per-day: re-derive REAL setups (real score, real evidence gates) with that day's own
//    accumulation window + as-of clock, then grade each on REAL Polygon minute bars. ────────────
const barCache = new Map();
async function barsFor(ticker, dayYmd) {
  const key = `${ticker}:${dayYmd}`;
  if (barCache.has(key)) return barCache.get(key);
  const p = fetchStockMinuteBars(ticker, dayYmd, dayYmd).catch(() => []);
  barCache.set(key, p);
  return p;
}

const perDay = [];
const allGraded = [];
for (const d of testDays) {
  const dClose = closeMsFor(d);
  const windowStart = dClose - LOOKBACK_DAYS * 86_400_000;
  const dayRows = [];
  for (const r of baseRows) {
    if (r.alertMs < windowStart || r.alertMs > dClose) continue;
    const dte = dteFromExpiry(r.expiry, dClose);
    if (dte == null) continue;
    dayRows.push({ ...r, dte });
  }
  // `opts.rejections` is intentionally omitted — this backtest reports the SCORED population, not
  // evidence-gate rejection incidence (that's `zerodte-gate-compound-funnel.mjs`'s job).
  const setups = deriveZeroDteSetups(dayRows, {
    maxSetups: MAX_SETUPS_PER_DAY,
    nowMs: dClose,
    todayYmd: d,
  });
  const partReal = partitionGradeable(setups);
  const gradeable = partReal.gradeable;

  const dayGraded = await mapLimit(gradeable, CONCURRENCY, async (s) => {
    const bars = await barsFor(s.ticker, d);
    const graded = gradeDirection(bars, s.direction, {
      entryUtcMin: ENTRY_UTC_MIN,
      closeUtcMin: CLOSE_UTC_MIN,
      fav: FAV,
      adv: ADV,
    });
    return { date: d, ticker: s.ticker, direction: s.direction, score: s.score, graded };
  });

  const gradedCount = dayGraded.filter((g) => g.graded).length;
  perDay.push({
    date: d,
    rowsInWindow: dayRows.length,
    setups: setups.length,
    excludedNonEquity: partReal.excludedCount,
    gradeable: gradeable.length,
    graded: gradedCount,
  });
  allGraded.push(...dayGraded);
  console.log(`    ${d}: ${dayRows.length} rows in window → ${setups.length} setups → ${gradeable.length} gradeable → ${gradedCount} graded`);
}

// ── 5) Aggregate + verdict ───────────────────────────────────────────────────────────────────────
const summary = summarizeByBucket(allGraded);
const sep = scoreSeparation(summary);
const cross = crossFloorComparison(summary);
const dead = ungradedTickers(allGraded);

console.log(`\n${line()}`);
console.log(`  COMBINED — ${testDays.length} session(s), ${allGraded.length} setups sampled, ${allGraded.filter((g) => g.graded).length} graded`);
console.log(line());
if (dead.length) {
  console.log(`  !! ${dead.length} ticker(s) graded ZERO of their setups — ${dead.map((x) => `${x.ticker} (${x.prints})`).join(", ")}`);
  console.log(`     check these aren't an unlisted non-equity root before reading the buckets below.`);
}
console.log(`\n  score band              n     win%      avg maxRet%`);
for (const b of summary) {
  console.log(
    `  ${pad(b.bucket, 22)}${padL(b.n, 5)}   ${b.winRate != null ? padL(b.winRate.toFixed(1) + "%", 6) : padL("—", 6)}      ${b.avgMaxRetPct != null ? b.avgMaxRetPct.toFixed(2) + "%" : "—"}`
  );
}
// Bands SCORE_BUCKETS defines but that never appeared (n=0) are silent by construction of
// summarizeByBucket (it only emits bands with at least one graded row) — name them so an empty
// band reads as "no setups scored here this run", not as "this band doesn't exist".
const missingBands = SCORE_BUCKETS.map((b) => b.label).filter((l) => !summary.some((s) => s.bucket === l));
if (missingBands.length) console.log(`  (no graded setups landed in: ${missingBands.join(", ")})`);

console.log(`\n${line()}`);
console.log(`  THE HEADLINE COMPARISON — does the population score_floor lets through (65-74) beat`);
console.log(`  the population it blocks today (55-64)?`);
console.log(line());
if (cross) {
  console.log(`    55-64 (blocked today): n=${cross.below.n}  win rate ${cross.below.winRate.toFixed(1)}%`);
  console.log(`    65-74 (clears today):  n=${cross.above.n}  win rate ${cross.above.winRate.toFixed(1)}%`);
  console.log(`    delta: ${cross.deltaPp >= 0 ? "+" : ""}${cross.deltaPp.toFixed(1)}pp`);
} else {
  console.log(`    INSUFFICIENT DATA — one or both of the 55-64 / 65-74 bands had zero graded setups`);
  console.log(`    this run. Widen --sessions or --fetch-calendar-days.`);
}

console.log(`\n${line()}`);
console.log(`  VERDICT (same RANKS / SPREAD WITHOUT ORDER / INVERTED / FLAT discipline as`);
console.log(`  helix-score-signal.mjs — requires a real spread AND a monotonic trend, not a spread alone)`);
console.log(line());
console.log(`  ${sep.verdict}` + (sep.spreadPp != null
  ? ` — spread ${sep.spreadPp.toFixed(1)}pp (best ${sep.best.bucket} ${sep.best.winRate.toFixed(1)}% vs worst ${sep.worst.bucket} ${sep.worst.winRate.toFixed(1)}%), rank correlation rho=${sep.rho.toFixed(2)}`
  : ""));
if (sep.verdict === "SPREAD WITHOUT ORDER") {
  console.log(`  Buckets DIFFER but do not TREND with score — a mid or low band outperforms a high one.`);
  console.log(`  That is what noise looks like, not a ranking.`);
}
if (sep.excluded?.length) console.log(`  bands excluded as too thin (n<30): ${sep.excluded.join(", ")}`);

console.log(`\n${line()}`);
console.log(`  SCOPE — read before acting on the verdict above`);
console.log(line());
console.log(`  This measures whether score ranks a favorable-first UNDERLYING-continuation proxy —`);
console.log(`  NOT exact option P&L (no strike, no premium decay, no exit-management rule), and NOT`);
console.log(`  jointly gated by VIX/confluence/governor/Cortex (measure those separately with`);
console.log(`  zerodte-gate-compound-funnel.mjs). This script proposes NO gate/threshold change.`);

if (EMIT_JSON) {
  console.log("\n<<<JSON>>>");
  console.log(JSON.stringify({
    sessions: testDays,
    skippedInsufficientLookback,
    scoreFloor: ZERODTE_SCORE_FLOOR,
    perDay,
    ungradedTickers: dead,
    summary,
    crossFloorComparison: cross,
    separation: sep,
    params: { SESSIONS, LOOKBACK_DAYS, MIN_PREMIUM, MAX_SETUPS_PER_DAY, FAV, ADV, entry: argv.entry ?? "10:00" },
  }, null, 2));
}
