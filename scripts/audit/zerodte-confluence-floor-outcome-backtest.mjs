/**
 * 0DTE CONFLUENCE_FLOOR (G-12) OUTCOME BACKTEST — does today's live floor still hold up under
 * current conditions, or has it drifted since E3 (2026-07-24) and the 2026-09-08 loosening?
 * ============================================================================================
 *
 * WHY THIS EXISTS
 * ----------------
 * E3 (docs/audit/0DTE-RESEARCH.md, 25 sessions, REAL option premium under the shipped -50/+100
 * payoff) found a genuinely monotonic EV ladder by confirmation count (VWAP-side + market-aligned):
 * 0-conf -12.5% EV (n=4), 1-conf 0.0% EV (n=49), 2-conf +15.9% EV (n=22, 41% win) — verdict
 * CONFIRMED edge, the strongest evidence backing any 0DTE hard gate in this toolkit. On
 * 2026-09-08 the STANDARD floor (ZERODTE_CONFLUENCE_MIN) was deliberately pulled from 2 down to 1
 * for volume reasons (gates.ts's own comment: "the 1-conf bucket itself measured 0.0% EV (not
 * negative)... this trades some expected edge for volume deliberately"). That means today's live
 * default sits EXACTLY on the bucket E3 measured as flat, not the one it found positive — and
 * unlike score_floor (which got a dedicated re-check tool, zerodte-score-floor-outcome-
 * backtest.mjs / E6), confluence_floor has never had one, despite gates.ts's own live block-reason
 * text still quoting the original 2026-07-24 E3 numbers as current justification. A 2026-09-17
 * gate-floor audit flagged this as a P3 TOP-3 item: confluence_floor is today's #2 isolated
 * chokepoint (zerodte-gate-compound-funnel.mjs, 51.7%) sitting on 8-week-stale evidence that
 * predates the loosening it's meant to justify.
 *
 * THE METHOD, mirroring zerodte-score-floor-outcome-backtest.mjs's proven shape: re-derive a REAL
 * population of scored setups (deriveZeroDteSetups, board.ts) per historical session day, attach a
 * REAL confluence read (computeIntradayRead + marketBias + computeConfluence — the exact functions
 * scan.ts's own attachConfluence calls) computed AS-OF a fixed representative entry time (never
 * leaking the rest of the session's bars into the read), bucket by the E3 axis (confirmations:
 * 0/1/2), and grade each setup's forward outcome on REAL Polygon minute bars with the SAME
 * favorable-first proxy score-floor-backtest-eval.mjs's gradeDirection uses (imported unchanged).
 *
 * THIS SCRIPT NEVER PROPOSES OR MAKES A GATE/THRESHOLD CHANGE. Evidence-gathering only, same
 * discipline as every sibling A/B in this toolkit.
 *
 * WHAT'S REAL vs. APPROXIMATED (same honesty discipline as every sibling A/B in this toolkit):
 * REAL:
 *   - deriveZeroDteSetups (board.ts) — the REAL 4-evidence-gate funnel AND the REAL score formula.
 *   - REAL UW flow-alerts (direct REST — same disclosed swap zerodte-score-floor-outcome-
 *     backtest.mjs / zerodte-gate-compound-funnel.mjs already carry: same alerts, different pipe
 *     from the Postgres table production reads from).
 *   - REAL Polygon minute bars for every graded (ticker, session-day) pair AND for SPY (market bias).
 *   - computeIntradayRead / marketBias / computeConfluence (intraday.ts, confluence.ts) — the exact,
 *     unmodified functions scan.ts's live attachConfluence pass calls. The AS-OF cutoff (bars
 *     sliced to <= the fixed entry time before computing the read) is this script's own addition —
 *     computeIntradayRead itself has no time-awareness, it reads whatever bars it's handed.
 * APPROXIMATED / NOT MEASURED (printed every run, never silently absent):
 *   - Grading is the favorable-first UNDERLYING-continuation proxy, NOT exact option premium P&L —
 *     a DELIBERATE deviation from E3's own stronger premium-basis methodology (see confluence-
 *     floor-backtest-eval.mjs's header for the full rationale: a premium-basis rebuild here would
 *     need a resolved OCC contract + its own minute bars per graded setup across dozens of
 *     sessions, a much larger/slower/more rate-limited build, and this repo's own score_floor
 *     re-check (E6) already made the identical trade-off for the same reason).
 *   - A FIXED representative entry time (--entry, default 10:00 ET) for every setup on a given day,
 *     same simplifying convention score-floor-backtest-eval.mjs / discovery-recall-probe.mjs use.
 *   - FLOW-origin setups ONLY (deriveZeroDteSetups fed UW flow-alerts, same as the score_floor
 *     re-check) — NOT BREAKOUT/PIN origin, which need a different discovery pipe entirely
 *     (screenBreakoutMovers / PIN regime detection) this script does not fetch. The measurement
 *     proposal that prompted this script named a FLOW+BREAKOUT+PIN split as the fuller version;
 *     this is the FLOW slice of it, disclosed as such rather than silently narrowed.
 *   - `--split=early-window` reports the early-window ([10:00,10:45) ET) vs standard-window cut
 *     the live floors actually differ on, but since --entry is fixed per run, a single invocation
 *     can only sample ONE side of that split at a time in practice (a 10:00 entry always reads
 *     early_window=true, a later one always false) — run twice with different --entry values to
 *     populate both sides. Documented rather than silently reporting an always-one-sided split.
 *
 * USAGE
 *   env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY \
 *   node --import tsx scripts/audit/zerodte-confluence-floor-outcome-backtest.mjs [options]
 *
 * OPTIONS — same names/defaults as zerodte-score-floor-outcome-backtest.mjs where they overlap:
 *   --sessions=N          distinct historical trading days to test (default 15, most recent
 *                         COMPLETE sessions found in the fetched window)
 *   --lookback-days=N     per-day flow accumulation window (default 3)
 *   --min-premium=N       min alert premium to ingest (default 250000)
 *   --max-setups-per-day=N  deliberately huge (default 500) — a small cap sorts by score desc and
 *                         slices, which would silently truncate exactly the low-confluence tail
 *   --entry=HH:MM         fixed ET entry time, both for grading AND for the confluence AS-OF
 *                         cutoff (default 10:00) — pass 11:30 or later to sample the standard-
 *                         window floor instead of the early-window one
 *   --fav=F / --adv=F     favorable-first target / adverse-first stop (default 0.015 / fav/2)
 *   --concurrency=N       Polygon minute-bar fetch concurrency (default 8 — TWO bar fetches per
 *                         setup now, ticker + SPY, vs score-floor's one, so kept lower by default)
 *   --fetch-calendar-days=N  how far back to page the UW flow-alerts fetch (default 30)
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
const { computeIntradayRead, marketBias } = await import(`${SRC}lib/zerodte/intraday.ts`);
const { computeConfluence } = await import(`${SRC}lib/zerodte/confluence.ts`);
const { ZERODTE_CONFLUENCE_MIN, ZERODTE_CONFLUENCE_MIN_EARLY } = await import(`${SRC}lib/zerodte/gates.ts`);
const { fetchStockMinuteBars } = await import(`${SRC}lib/providers/polygon.ts`);
const { partitionGradeable, ungradedTickers } = await import("./lib/helix-score-eval.mjs");
const {
  CONFLUENCE_BUCKETS,
  gradeDirection,
  summarizeByConfluenceBucket,
  edgeBucketComparison,
  looseningJustificationCheck,
  scoreSeparation,
} = await import("./lib/confluence-floor-backtest-eval.mjs");

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
const CONCURRENCY = Math.max(1, Number(argv.concurrency ?? 8));
const FETCH_CALENDAR_DAYS = Math.max(LOOKBACK_DAYS + SESSIONS, Number(argv["fetch-calendar-days"] ?? 30));
const EMIT_JSON = Boolean(argv.json);
const [entH, entM] = String(argv.entry ?? "10:00").split(":").map(Number);
// Same EDT-only convention the sibling A/Bs use — the test window (recent weeks) is firmly inside
// EDT, and DST is out of scope for this backtest.
const ET_OFFSET = -4;
const ENTRY_ET_MIN = entH * 60 + (entM || 0);
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
const closeMsFor = (ymd) => Date.parse(`${ymd}T20:00:00Z`);
/** The AS-OF cutoff instant for a session day at the fixed ET entry time, same UTC-offset
 *  convention as ENTRY_UTC_MIN above. */
function entryMsFor(ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  return Date.UTC(y, m - 1, d, 0, 0, 0) + ENTRY_UTC_MIN * 60_000;
}

/** Bounded-concurrency map, preserving input order. */
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
console.log("  0DTE CONFLUENCE_FLOOR (G-12) OUTCOME BACKTEST — confirmation count vs forward outcome");
console.log(`  sessions=${SESSIONS} · lookback=${LOOKBACK_DAYS}d · min premium ${fmtUsd(MIN_PREMIUM)} · entry ${String(argv.entry ?? "10:00")} ET · fav ${(FAV * 100).toFixed(2)}% / adv ${(ADV * 100).toFixed(2)}%`);
console.log(`  shipped ZERODTE_CONFLUENCE_MIN (standard) = ${ZERODTE_CONFLUENCE_MIN} · ZERODTE_CONFLUENCE_MIN_EARLY = ${ZERODTE_CONFLUENCE_MIN_EARLY}`);
console.log(line("═"));

// ── 1) ONE broad backward UW flow-alerts fetch, deduped ─────────────────────────────────────────
console.log(`\n[1] Fetching UW flow-alerts back ${FETCH_CALENDAR_DAYS} calendar days (min ${fmtUsd(MIN_PREMIUM)})…`);
const nowMs = Date.now();
const cutoffMs = nowMs - FETCH_CALENDAR_DAYS * 86_400_000;
const allRows = [];
const seen = new Set();
let olderThan = new Date(nowMs).toISOString();
const MAX_PAGES = 220;
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

// ── 2) Map to FlowSetupInput ONCE (fields other than `dte` are date-invariant) ──────────────────
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
  .filter((d) => d !== today)
  .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));

const testDays = [];
const skippedInsufficientLookback = [];
for (const d of distinctDays) {
  if (testDays.length >= SESSIONS) break;
  const dClose = closeMsFor(d);
  const lookbackStart = dClose - LOOKBACK_DAYS * 86_400_000;
  if (lookbackStart < earliestRowMs) {
    skippedInsufficientLookback.push(d);
    continue;
  }
  testDays.push(d);
}
testDays.sort();
console.log(`\n[2] Testing ${testDays.length} session day(s): ${testDays.join(", ") || "(none)"}`);
if (skippedInsufficientLookback.length) {
  console.log(`    skipped (insufficient lookback history in the fetched window): ${skippedInsufficientLookback.join(", ")}`);
}
if (!testDays.length) {
  console.log("\n  No session day had a fully-covered lookback window. Widen --fetch-calendar-days.");
  process.exit(0);
}

// ── 4) Per-day: re-derive REAL setups, attach a REAL AS-OF confluence read, grade on REAL bars ──
const barCache = new Map();
async function barsFor(ticker, dayYmd) {
  const key = `${ticker}:${dayYmd}`;
  if (barCache.has(key)) return barCache.get(key);
  const p = fetchStockMinuteBars(ticker, dayYmd, dayYmd).catch(() => []);
  barCache.set(key, p);
  return p;
}
function asOf(bars, cutoffMsInclusive) {
  return (bars ?? [])
    .filter((b) => Number.isFinite(b?.t) && b.t <= cutoffMsInclusive)
    .map((b) => ({ t: b.t, h: b.h, l: b.l, c: b.c, v: b.v }));
}

const perDay = [];
const allGraded = [];
for (const d of testDays) {
  const dClose = closeMsFor(d);
  const entryMs = entryMsFor(d);
  const windowStart = dClose - LOOKBACK_DAYS * 86_400_000;
  const dayRows = [];
  for (const r of baseRows) {
    if (r.alertMs < windowStart || r.alertMs > dClose) continue;
    const dte = dteFromExpiry(r.expiry, dClose);
    if (dte == null) continue;
    dayRows.push({ ...r, dte });
  }
  const setups = deriveZeroDteSetups(dayRows, { maxSetups: MAX_SETUPS_PER_DAY, nowMs: dClose, todayYmd: d });
  const partReal = partitionGradeable(setups);
  const gradeable = partReal.gradeable;

  // SPY's AS-OF read once per day (market bias is day-level, shared by every setup that day).
  const spyBars = await barsFor("SPY", d);
  const spyRead = computeIntradayRead(asOf(spyBars, entryMs));
  const bias = marketBias(spyRead);

  const dayGraded = await mapLimit(gradeable, CONCURRENCY, async (s) => {
    const tickerBars = await barsFor(s.ticker, d);
    const read = computeIntradayRead(asOf(tickerBars, entryMs));
    const marketAligned = bias == null || bias === "flat" ? null : (bias === "up") === (s.direction === "long");
    const confluence = computeConfluence({ direction: s.direction, intraday: read, market_aligned: marketAligned, play_type: s.play_type }, ENTRY_ET_MIN);
    const bars = await barsFor(s.ticker, d);
    const graded = gradeDirection(bars, s.direction, { entryUtcMin: ENTRY_UTC_MIN, closeUtcMin: CLOSE_UTC_MIN, fav: FAV, adv: ADV });
    return {
      date: d,
      ticker: s.ticker,
      direction: s.direction,
      score: s.score,
      confirmations: confluence?.confirmations ?? null,
      earlyWindow: confluence?.early_window ?? null,
      tier: confluence?.tier ?? null,
      graded,
    };
  });

  const gradedCount = dayGraded.filter((g) => g.graded).length;
  const confluenceReadCount = dayGraded.filter((g) => g.confirmations != null).length;
  perDay.push({
    date: d,
    rowsInWindow: dayRows.length,
    setups: setups.length,
    excludedNonEquity: partReal.excludedCount,
    gradeable: gradeable.length,
    confluenceRead: confluenceReadCount,
    graded: gradedCount,
  });
  allGraded.push(...dayGraded);
  console.log(`    ${d}: ${dayRows.length} rows in window → ${setups.length} setups → ${gradeable.length} gradeable → ${confluenceReadCount} with a confluence read → ${gradedCount} graded`);
}

// ── 5) Aggregate + verdict ───────────────────────────────────────────────────────────────────────
const summary = summarizeByConfluenceBucket(allGraded);
const byWindow = summarizeByConfluenceBucket(allGraded, "earlyWindow");
// scoreSeparation expects {bucket,n,winRate} in ascending-signal order — CONFLUENCE_BUCKETS is
// already 0/1/2 ascending, matching summary's own construction order.
const sep = scoreSeparation(summary, 30);
const edge = edgeBucketComparison(summary);
const loosening = looseningJustificationCheck(summary);
const dead = ungradedTickers(allGraded);

console.log(`\n${line()}`);
console.log(`  COMBINED — ${testDays.length} session(s), ${allGraded.length} setups sampled, ${allGraded.filter((g) => g.graded).length} graded`);
console.log(line());
if (dead.length) {
  console.log(`  !! ${dead.length} ticker(s) graded ZERO of their setups — ${dead.map((x) => `${x.ticker} (${x.prints})`).join(", ")}`);
}
console.log(`\n  confirmation band                                    n     win%      avg maxRet%`);
for (const b of summary) {
  console.log(
    `  ${pad(b.bucket, 52)}${padL(b.n, 5)}   ${b.winRate != null ? padL(b.winRate.toFixed(1) + "%", 6) : padL("—", 6)}      ${b.avgMaxRetPct != null ? b.avgMaxRetPct.toFixed(2) + "%" : "—"}`
  );
}
const missingBands = CONFLUENCE_BUCKETS.map((b) => b.label).filter((l) => !summary.some((s) => s.bucket === l));
if (missingBands.length) console.log(`  (no graded setups landed in: ${missingBands.join(", ")})`);

console.log(`\n${line()}`);
console.log(`  E3 HEADLINE — does 2-conf (E3's own +15.9% EV edge bucket, also today's early-window`);
console.log(`  floor) still beat 1-conf (today's STANDARD floor — the bucket E3 itself measured flat)?`);
console.log(line());
if (edge) {
  console.log(`    1-conf (standard floor): n=${edge.standard.n}  win rate ${edge.standard.winRate.toFixed(1)}%`);
  console.log(`    2-conf (E3 edge bucket): n=${edge.edge.n}  win rate ${edge.edge.winRate.toFixed(1)}%`);
  console.log(`    delta: ${edge.deltaPp >= 0 ? "+" : ""}${edge.deltaPp.toFixed(1)}pp`);
} else {
  console.log(`    INSUFFICIENT DATA — one or both of the 1-conf / 2-conf bands had zero graded setups.`);
}

console.log(`\n${line()}`);
console.log(`  2026-09-08 LOOSENING CHECK — is 1-conf still ~flat vs 0-conf (the justification for`);
console.log(`  pulling the standard floor from 2 to 1), or has it drifted negative?`);
console.log(line());
if (loosening) {
  console.log(`    0-conf (blocked both before/after): n=${loosening.blocked.n}  win rate ${loosening.blocked.winRate.toFixed(1)}%`);
  console.log(`    1-conf (admitted since 2026-09-08): n=${loosening.admitted.n}  win rate ${loosening.admitted.winRate.toFixed(1)}%`);
  console.log(`    delta: ${loosening.deltaPp >= 0 ? "+" : ""}${loosening.deltaPp.toFixed(1)}pp`);
} else {
  console.log(`    INSUFFICIENT DATA — one or both of the 0-conf / 1-conf bands had zero graded setups.`);
}

console.log(`\n${line()}`);
console.log(`  EARLY-WINDOW vs STANDARD-WINDOW split (this run's fixed --entry=${String(argv.entry ?? "10:00")} samples`);
console.log(`  only ONE side — see the script header's --split note)`);
console.log(line());
for (const b of byWindow) {
  console.log(
    `  ${pad(b.bucket, 40)} earlyWindow=${pad(b.split, 7)}${padL(b.n, 5)}   ${b.winRate != null ? padL(b.winRate.toFixed(1) + "%", 6) : padL("—", 6)}`
  );
}

console.log(`\n${line()}`);
console.log(`  VERDICT (same RANKS / SPREAD WITHOUT ORDER / INVERTED / FLAT discipline as`);
console.log(`  helix-score-signal.mjs / zerodte-score-floor-outcome-backtest.mjs)`);
console.log(line());
console.log(`  ${sep.verdict}` + (sep.spreadPp != null
  ? ` — spread ${sep.spreadPp.toFixed(1)}pp (best ${sep.best.bucket} ${sep.best.winRate.toFixed(1)}% vs worst ${sep.worst.bucket} ${sep.worst.winRate.toFixed(1)}%), rank correlation rho=${sep.rho.toFixed(2)}`
  : ""));
if (sep.excluded?.length) console.log(`  bands excluded as too thin (n<30): ${sep.excluded.join(", ")}`);

console.log(`\n${line()}`);
console.log(`  SCOPE — read before acting on the verdict above`);
console.log(line());
console.log(`  Favorable-first UNDERLYING-continuation proxy (NOT exact option premium P&L — a`);
console.log(`  deliberate deviation from E3's own premium-basis methodology, see the script header).`);
console.log(`  FLOW-origin setups only (not BREAKOUT/PIN). This script proposes NO gate/threshold change.`);

if (EMIT_JSON) {
  console.log("\n<<<JSON>>>");
  console.log(JSON.stringify({
    sessions: testDays,
    skippedInsufficientLookback,
    confluenceMinStandard: ZERODTE_CONFLUENCE_MIN,
    confluenceMinEarly: ZERODTE_CONFLUENCE_MIN_EARLY,
    perDay,
    ungradedTickers: dead,
    summary,
    byEarlyWindow: byWindow,
    edgeBucketComparison: edge,
    looseningJustificationCheck: loosening,
    separation: sep,
    params: { SESSIONS, LOOKBACK_DAYS, MIN_PREMIUM, MAX_SETUPS_PER_DAY, FAV, ADV, entry: argv.entry ?? "10:00" },
  }, null, 2));
}
