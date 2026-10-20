/**
 * RVOL UNIVERSE SHADOW SCAN — unbiased RVOL shadow collection across the FULL eligible scan
 * universe, including names that NEVER become a BREAKOUT/BREAKDOWN candidate at all.
 * ============================================================================================
 * WHY THIS EXISTS (2026-10-20, member directive: "Build unbiased RVOL shadow collection across
 * the eligible scan universe, including names that never become BREAKOUT candidates or
 * commits. Logging only eventual commits or rejected candidates may still miss the early
 * detection problem.")
 * ------------------------------------------------------------------------------------------
 * Every prior RVOL measurement this round (`zerodte-rvol-early-entry-unbiased-ab.mjs`, and
 * `thesis-rank-reject-outcome-ab.mjs` before it) starts from the real whole-market BREAKOUT/
 * BREAKDOWN screen's OWN qualifying pool — i.e. tickers that ALREADY cleared
 * `screenBreakoutMovers`/`screenBreakdownMovers`'s gain%/close-strength thresholds that day.
 * That answers "does RVOL flag a future-qualifying mover earlier than the screen does" — but it
 * cannot answer the member's sharper question: does a meaningful population of names that NEVER
 * clear those thresholds at all nonetheless show a real RVOL signal and a real tradable move the
 * current discovery pipeline structurally never sees? Logging only eventual
 * commits/rejects — any population pre-filtered by the screen's own thresholds — cannot surface
 * that gap by construction.
 *
 * METHOD
 * ------
 * For each real session day: pull the FULL real grouped-daily universe (Polygon, ~12.4k rows),
 * apply the SAME liquidity floor the real screen applies (`BREAKOUT_MIN_PRICE`/`BREAKOUT_MAX_
 * PRICE`/`BREAKOUT_MIN_VOLUME`, imported directly — never reimplemented) to get the honest
 * "eligible scan universe," then split it by the SAME gain%/close-strength predicate into:
 *   - QUALIFYING: cleared `screenBreakoutMovers`/`screenBreakdownMovers` that day (called with an
 *     effectively unbounded `maxKeep` so this is the FULL qualifying set, not production's
 *     capped candidate pool — a wider population than any prior RVOL test used).
 *   - QUIET: passed the liquidity floor but never cleared gain%/close-strength — the population
 *     every prior test, and production discovery itself, never looks at.
 * Both buckets are liquidity-matched by construction (same price/volume floor), so a difference
 * between them is not merely "liquid vs illiquid."
 *
 * Budget-bound stratified sample per day (`--max-qualifying`/`--max-quiet`, both ranked by
 * $-volume — the same ranking production itself uses for `screenBreakoutMovers`' own `maxKeep`
 * truncation, so QUIET's sample is not an arbitrary cherry-pick either). For each sampled
 * ticker: real trailing-day minute bars build the REAL time-of-day volume profile
 * (`buildTimeOfDayVolumeProfile`), real today's-bars walk computes the REAL, unmodified
 * `computeRelativeVolume` classification minute-by-minute (no look-ahead — only bars up to and
 * including each instant are used), recording the earliest "high"/"very_high" instant if any.
 *
 * For QUIET names with an RVOL signal, the forward move from that signal instant through the
 * close is graded with the SAME favorable-first underlying proxy every sibling tool uses
 * (`--fav`/`--adv`) — this is the literal "early detection gap" measurement: a quiet name RVOL
 * flagged that also shows a real tradable-looking move is evidence production's price/volume
 * screen is missing something RVOL could have caught; a quiet name RVOL flagged that goes
 * nowhere is evidence RVOL alone is too noisy a trigger for this population.
 *
 * COLLECTION, NOT JUST A ONE-SHOT REPORT: each day's PER-TICKER rows (not just the summary) are
 * persisted to `docs/audit/history/zerodte-rvol-universe-shadow/<day>.json` (skipped if already
 * on disk, unless `--force`) — same durable-collection discipline as `zerodte-history-collect.mjs`
 * — so a future run with `--replay` can fold in already-collected days without re-paying the
 * Polygon fetch cost, and the sample grows across sessions instead of resetting every run.
 *
 * THIS SCRIPT NEVER CHANGES A GATE, FILTER, OR SCREEN THRESHOLD — evidence-gathering only.
 *
 * USAGE
 *   POLYGON_API_BASE=https://api.massive.com \
 *   env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY \
 *   node --import tsx scripts/audit/zerodte-rvol-universe-shadow-scan.mjs [options]
 * OPTIONS
 *   --days=N            real session days to walk back for NEW collection (default 5)
 *   --max-qualifying=N  per-day sample cap for the QUALIFYING bucket, by $-volume (default 30)
 *   --max-quiet=N       per-day sample cap for the QUIET bucket, by $-volume (default 30)
 *   --fav=N             favorable-first move threshold for QUIET-bucket forward grading (0.015)
 *   --concurrency=N     parallel per-ticker fetches (default 8)
 *   --replay            fold in already-collected days from disk instead of re-fetching them
 *   --force             re-fetch and overwrite days already on disk
 *   --json
 */

if (!process.env.POLYGON_API_BASE || !/^https?:\/\//.test(process.env.POLYGON_API_BASE)) {
  process.env.POLYGON_API_BASE = "https://api.massive.com";
}

const SRC = new URL("../../src/", import.meta.url).pathname;
const HISTORY_DIR = new URL("../../docs/audit/history/zerodte-rvol-universe-shadow/", import.meta.url).pathname;

const argv = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    return m ? [m[1], m[2] ?? "true"] : [a, "true"];
  })
);
const DAYS = Math.max(1, Number(argv.days ?? 5));
const MAX_QUALIFYING = Math.max(1, Number(argv["max-qualifying"] ?? 30));
const MAX_QUIET = Math.max(1, Number(argv["max-quiet"] ?? 30));
const FAV = Number(argv.fav ?? 0.015);
const ADV = FAV / 2;
const CONCURRENCY = Math.max(1, Number(argv.concurrency ?? 8));
const REPLAY = Boolean(argv.replay);
const FORCE = Boolean(argv.force);
const EMIT_JSON = Boolean(argv.json);

const {
  screenBreakoutMovers, screenBreakdownMovers, isExcludedInstrument,
  BREAKOUT_MIN_PRICE, BREAKOUT_MAX_PRICE, BREAKOUT_MIN_VOLUME,
} = await import(`${SRC}features/nighthawk/lib/candidates.ts`);
const { fetchDailyMarketSummary, fetchStockMinuteBars } = await import(`${SRC}lib/providers/polygon.ts`);
const { buildTimeOfDayVolumeProfile, computeRelativeVolume, RVOL_PROFILE_MIN_DAYS } = await import(`${SRC}lib/zerodte/relative-volume.ts`);
const { groupMinuteBarsByDate } = await import(`${SRC}lib/zerodte/relative-volume-source.ts`);
const { etWallClockToUtcMs } = await import("./lib/swing-cadence-gap-eval.mjs");

const fs = await import("node:fs");
const path = await import("node:path");
fs.mkdirSync(HISTORY_DIR, { recursive: true });

const line = (c = "─", w = 112) => c.repeat(w);
const fmtPct = (n) => (n == null ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`);
const pct = (x) => (x == null ? "n/a" : `${(x * 100).toFixed(1)}%`);
function etYmd(ms) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(ms));
}
const ymd = (d) => d.toISOString().slice(0, 10);

async function resolveSessions(n) {
  const out = [];
  const d = new Date();
  const MAX_ATTEMPTS = n * 3 + 5;
  for (let i = 0; i < MAX_ATTEMPTS && out.length < n; i++) {
    const day = ymd(d);
    const g = await fetchDailyMarketSummary(day).catch(() => null);
    if (g?.results?.length) out.push({ date: day, results: g.results });
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return out.reverse();
}

async function mapPool(items, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length || 1) }, () => worker()));
  return out;
}

/** The SAME liquidity floor screenBreakoutMovers/screenBreakdownMovers apply, extracted so the
 *  QUIET bucket is matched on liquidity rather than an arbitrary separate filter. Not a
 *  reimplementation of the gain/close-strength predicate — only the floor every candidate (both
 *  buckets) must already clear. */
function passesLiquidityFloor(r) {
  const ticker = String(r.T ?? "").toUpperCase();
  if (!ticker || ticker.includes(".") || isExcludedInstrument(ticker)) return null;
  const c = Number(r.c), v = Number(r.v);
  if (!(c >= BREAKOUT_MIN_PRICE && c <= BREAKOUT_MAX_PRICE) || !(v >= BREAKOUT_MIN_VOLUME)) return null;
  return { ticker, dollar: v * c };
}

/** For one real session: split the liquidity-matched universe into QUALIFYING (cleared the real
 *  screen, either direction) vs QUIET (did not), each ranked by $-volume. */
function splitUniverse(results) {
  const longQ = new Set(screenBreakoutMovers(results, 100_000).map((m) => m.ticker));
  const shortQ = new Set(screenBreakdownMovers(results, 100_000).map((m) => m.ticker));
  const qualifying = [];
  const quiet = [];
  for (const r of results) {
    const liq = passesLiquidityFloor(r);
    if (!liq) continue;
    if (longQ.has(liq.ticker) || shortQ.has(liq.ticker)) {
      qualifying.push({ ...liq, direction: longQ.has(liq.ticker) ? "long" : "short" });
    } else {
      quiet.push(liq);
    }
  }
  qualifying.sort((a, b) => b.dollar - a.dollar);
  quiet.sort((a, b) => b.dollar - a.dollar);
  return { qualifying, quiet };
}

/** Real RVOL walk for one ticker/day — no look-ahead (only bars up to and including each
 *  instant feed computeRelativeVolume). Returns the earliest "high"/"very_high" instant, if any,
 *  plus the day's own bars for downstream grading. */
async function rvolWalk(ticker, date) {
  const rthOpenMs = etWallClockToUtcMs(date, 9 * 60 + 30);
  const rthCloseMs = etWallClockToUtcMs(date, 16 * 60);
  const todayBars = await fetchStockMinuteBars(ticker, date, date).catch(() => []);
  const rth = todayBars.filter((b) => Number.isFinite(b.t) && b.t >= rthOpenMs && b.t < rthCloseMs).sort((a, b) => a.t - b.t);
  if (rth.length < 2) return { status: "NO_BARS" };

  const fromDay = etYmd(rthOpenMs - 20 * 86_400_000);
  const toDay = etYmd(rthOpenMs - 86_400_000);
  const trailingBars = await fetchStockMinuteBars(ticker, fromDay, toDay).catch(() => []);
  const byDate = groupMinuteBarsByDate(trailingBars);
  const dailyMinuteVolumes = [...byDate.values()];
  if (dailyMinuteVolumes.length < RVOL_PROFILE_MIN_DAYS) return { status: "NO_PROFILE" };
  const profile = buildTimeOfDayVolumeProfile(dailyMinuteVolumes);
  const avgDailyVolume = dailyMinuteVolumes.reduce((s, d) => s + d.reduce((a, b) => a + b, 0), 0) / dailyMinuteVolumes.length;
  if (!profile || !(avgDailyVolume > 0)) return { status: "NO_PROFILE" };

  let cumVol = 0, earliestHighMs = null, earliestHighClassification = null;
  for (const b of rth) {
    cumVol += Number.isFinite(b.v) ? b.v : 0;
    const read = computeRelativeVolume({ cumulativeVolumeToday: cumVol, avgDailyVolume, nowMs: b.t, timeOfDayProfile: profile });
    if (read.classification === "high" || read.classification === "very_high") {
      earliestHighMs = b.t;
      earliestHighClassification = read.classification;
      break;
    }
  }
  if (earliestHighMs == null) return { status: "NO_RVOL_SIGNAL", rthOpenMs, rthCloseMs, bars: rth };
  const elapsedMinutesAtSignal = Math.round((earliestHighMs - rthOpenMs) / 60_000);
  return { status: "RVOL_SIGNAL", earliestHighMs, earliestHighClassification, elapsedMinutesAtSignal, rthOpenMs, rthCloseMs, bars: rth };
}

/** How many elapsed RTH minutes a signal must clear before it's trusted as a genuine mid/late-day
 *  read rather than noise from the RVOL_MIN_ELAPSED_MINUTES=3 floor, where the denominator (a
 *  profile's own expected-by-now fraction) is smallest and a single ordinary opening print can
 *  trivially swamp it. CAUGHT LIVE (2026-10-20): the first run of this collection found 118/180
 *  (65.6%) of all QUALIFYING RVOL signals fired within the first 5 elapsed minutes — a real,
 *  disclosed methodological caveat, not a script bug (confirmed against computeRelativeVolume's
 *  own source: elapsedMinuteIndex=3 is the very first index the function returns a non-null ratio
 *  for). Every report below splits EARLY (<=this floor) from LATER signals so the headline "RVOL
 *  fires early" number is never silently dominated by what is very likely opening-print noise.
 */
const EARLY_SIGNAL_NOISE_FLOOR_MIN = 10;

/** Favorable-first forward grade from a given instant through the close — same rule every
 *  sibling tool uses. direction is the screen's own long/short for QUALIFYING; for QUIET (no
 *  screen direction exists) this grades the LONG side only (a quiet name's RVOL spike has no
 *  production-assigned direction, so "is there a tradable move at all" is graded as an
 *  up-move proxy — disclosed, not a limitation shared with the QUALIFYING bucket). */
function gradeForwardFromSignal(bars, signalMs, closeMs, direction = "long") {
  const fwd = bars.filter((b) => b.t >= signalMs && b.t <= closeMs);
  if (fwd.length < 2) return null;
  const entry = fwd[0].c;
  if (!(entry > 0)) return null;
  const favLevel = direction === "long" ? entry * (1 + FAV) : entry * (1 - FAV);
  const advLevel = direction === "long" ? entry * (1 - ADV) : entry * (1 + ADV);
  for (const b of fwd) {
    const hitFav = direction === "long" ? b.h >= favLevel : b.l <= favLevel;
    const hitAdv = direction === "long" ? b.l <= advLevel : b.h >= advLevel;
    if (hitFav && !hitAdv) return { win: true };
    if (hitAdv) return { win: false };
  }
  return { win: false };
}

console.log(line("═"));
console.log(`  RVOL UNIVERSE SHADOW SCAN — unbiased collection across the full eligible scan universe`);
console.log(`  days=${DAYS} (new collection) · max/day qualifying=${MAX_QUALIFYING} quiet=${MAX_QUIET} · fav=${pct(FAV)}`);
console.log(line("═"));

const existingDays = new Set(
  fs.readdirSync(HISTORY_DIR).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""))
);
console.log(`  already collected on disk: ${existingDays.size} day(s)${existingDays.size ? ` (${[...existingDays].sort().join(", ")})` : ""}`);

const allDayResults = [];

if (REPLAY) {
  console.log(`\n[replay] folding in ${existingDays.size} already-collected day(s) from disk…`);
  for (const day of [...existingDays].sort()) {
    const rows = JSON.parse(fs.readFileSync(path.join(HISTORY_DIR, `${day}.json`), "utf8"));
    allDayResults.push({ date: day, rows });
  }
}

console.log(`\n[1] Resolving ${DAYS} real trading session(s) for NEW collection…`);
const sessions = await resolveSessions(DAYS);
console.log(`    ${sessions.length} session(s): ${sessions.map((s) => s.date).join(", ")}`);

for (const s of sessions) {
  if (existingDays.has(s.date) && !FORCE) {
    console.log(`    [${s.date}] already collected — skipping (use --force to re-fetch)`);
    continue;
  }
  const { qualifying, quiet } = splitUniverse(s.results);
  console.log(`\n  [${s.date}] eligible universe: qualifying=${qualifying.length}  quiet=${quiet.length} (liquidity-matched)`);
  const sampleQ = qualifying.slice(0, MAX_QUALIFYING);
  const sampleU = quiet.slice(0, MAX_QUIET);

  const gradedQ = await mapPool(sampleQ, async (c) => {
    const w = await rvolWalk(c.ticker, s.date);
    if (w.status !== "RVOL_SIGNAL" && w.status !== "NO_RVOL_SIGNAL") return { ...c, bucket: "QUALIFYING", status: w.status };
    const marginMin = w.status === "RVOL_SIGNAL" ? Math.round((w.rthCloseMs - w.earliestHighMs) / 60_000) : null;
    return {
      ticker: c.ticker, direction: c.direction, bucket: "QUALIFYING", status: w.status,
      earliestHighClassification: w.earliestHighClassification ?? null,
      minutesFromSignalToClose: marginMin,
      elapsedMinutesAtSignal: w.elapsedMinutesAtSignal ?? null,
    };
  });
  // QUIET: grade BOTH (a) the RVOL-signaled forward move, same as before, AND (b) a BASE-RATE
  // control — the same favorable-first move graded from the RTH OPEN (not from any signal) for
  // EVERY quiet row regardless of RVOL status. Without this control, a bare "X% of RVOL-signaled
  // quiet names moved favorably" is uninterpretable: most signals fire within the first ~10
  // elapsed minutes (see EARLY_SIGNAL_NOISE_FLOOR_MIN), so grading "from signal to close" is
  // nearly equivalent to "from the open to close" — and SOME base rate of liquid names moving
  // 1.5%+ over a full RTH session is expected by chance alone. The base rate is what makes the
  // RVOL-conditioned rate interpretable as a real lift (or the absence of one).
  const gradedU = await mapPool(sampleU, async (c) => {
    const w = await rvolWalk(c.ticker, s.date);
    if (w.status !== "RVOL_SIGNAL" && w.status !== "NO_RVOL_SIGNAL") return { ...c, bucket: "QUIET", status: w.status };
    const baseGrade = gradeForwardFromSignal(w.bars, w.rthOpenMs, w.rthCloseMs, "long");
    if (w.status === "NO_RVOL_SIGNAL") {
      return {
        ticker: c.ticker, bucket: "QUIET", status: w.status,
        baseRateGraded: baseGrade != null, baseRateWin: baseGrade?.win ?? null,
      };
    }
    const grade = gradeForwardFromSignal(w.bars, w.earliestHighMs, w.rthCloseMs, "long");
    return {
      ticker: c.ticker, bucket: "QUIET", status: w.status,
      earliestHighClassification: w.earliestHighClassification,
      elapsedMinutesAtSignal: w.elapsedMinutesAtSignal ?? null,
      forwardMoveGraded: grade != null, forwardMoveWin: grade?.win ?? null,
      baseRateGraded: baseGrade != null, baseRateWin: baseGrade?.win ?? null,
    };
  });

  const rows = [...gradedQ, ...gradedU];
  fs.writeFileSync(path.join(HISTORY_DIR, `${s.date}.json`), JSON.stringify(rows, null, 0));
  existingDays.add(s.date);
  console.log(`    wrote ${s.date}.json — ${rows.length} rows (qualifying ${gradedQ.length}, quiet ${gradedU.length})`);
  allDayResults.push({ date: s.date, rows });
}

// ── Report across every day now in-hand (new + replayed) ──────────────────────────────────
const allRows = allDayResults.flatMap((d) => d.rows);
const qRows = allRows.filter((r) => r.bucket === "QUALIFYING");
const uRows = allRows.filter((r) => r.bucket === "QUIET");

console.log(`\n${line("═")}`);
console.log(`  REPORT — ${allDayResults.length} session day(s) in hand (${qRows.length} qualifying + ${uRows.length} quiet rows)`);
console.log(line("═"));

function summarizeBucket(label, rows) {
  const withSignal = rows.filter((r) => r.status === "RVOL_SIGNAL");
  const noSignal = rows.filter((r) => r.status === "NO_RVOL_SIGNAL");
  const other = rows.length - withSignal.length - noSignal.length;
  console.log(`\n  ${label}: n=${rows.length}  RVOL_SIGNAL=${withSignal.length} (${pct(rows.length ? withSignal.length / rows.length : null)})  NO_RVOL_SIGNAL=${noSignal.length}  other/ungraded=${other}`);
  return { withSignal, noSignal };
}

console.log(`\n  [1] QUALIFYING bucket (cleared the real BREAKOUT/BREAKDOWN screen that day) —`);
console.log(`      does RVOL show a leading signal on a WIDER population than just committed plays?`);
const { withSignal: qWithSignal } = summarizeBucket("QUALIFYING", qRows);
if (qWithSignal.length) {
  const early = qWithSignal.filter((r) => r.elapsedMinutesAtSignal != null && r.elapsedMinutesAtSignal <= EARLY_SIGNAL_NOISE_FLOOR_MIN);
  const later = qWithSignal.filter((r) => r.elapsedMinutesAtSignal != null && r.elapsedMinutesAtSignal > EARLY_SIGNAL_NOISE_FLOOR_MIN);
  console.log(`      of ${qWithSignal.length} RVOL signals: ${early.length} (${pct(early.length / qWithSignal.length)}) fired within the first`);
  console.log(`      ${EARLY_SIGNAL_NOISE_FLOOR_MIN} elapsed minutes — likely opening-print noise (see EARLY_SIGNAL_NOISE_FLOOR_MIN comment), NOT`);
  console.log(`      genuine early detection; ${later.length} (${pct(later.length / qWithSignal.length)}) fired later in the session.`);
  if (later.length) {
    const avgMarginLater = later.reduce((s, r) => s + r.minutesFromSignalToClose, 0) / later.length;
    console.log(`      of the LATER (non-noise) signals only, avg minutes from signal to close: ${avgMarginLater.toFixed(0)}min —`);
    console.log(`      this is the number that actually bears on §A's leading-indicator hypothesis; the unconditional`);
    console.log(`      average across ALL signals is inflated by the opening-noise cluster and should not be quoted alone.`);
  }
}

console.log(`\n  [2] QUIET bucket (liquidity-matched, but NEVER cleared the screen) — the literal`);
console.log(`      "early detection gap" population: does RVOL flag names production's screen never sees?`);
const { withSignal: uWithSignal, noSignal: uNoSignal } = summarizeBucket("QUIET", uRows);
// Base-rate control: ANY quiet row (signal or not) graded from the RTH open — answers "what
// fraction of liquid-but-quiet names move 1.5%+ over a full session with NO signal at all."
const baseAll = uRows.filter((r) => r.baseRateGraded);
const baseWins = baseAll.filter((r) => r.baseRateWin);
const baseRate = baseAll.length ? baseWins.length / baseAll.length : null;
console.log(`\n      BASE RATE CONTROL (no RVOL conditioning, full RTH session, same fav=${pct(FAV)} threshold):`);
console.log(`      ${baseWins.length}/${baseAll.length} (${pct(baseRate)}) of ALL quiet names moved favorably at some point in the day —`);
console.log(`      this is the number the RVOL-signaled rate below must BEAT to mean anything.`);
if (uWithSignal.length) {
  const graded = uWithSignal.filter((r) => r.forwardMoveGraded);
  const wins = graded.filter((r) => r.forwardMoveWin);
  const signaledRate = graded.length ? wins.length / graded.length : null;
  console.log(`\n      RVOL-SIGNALED: ${wins.length}/${graded.length} (${pct(signaledRate)}) hit the favorable-first move threshold`);
  console.log(`      AFTER the RVOL signal, despite NEVER clearing the real screen that day.`);
  if (baseRate != null && signaledRate != null) {
    const lift = (signaledRate - baseRate) * 100;
    console.log(`      LIFT over base rate: ${lift >= 0 ? "+" : ""}${lift.toFixed(1)}pp`);
    if (Math.abs(lift) < 5) {
      console.log(`      This is a SMALL lift — close enough to the base rate that RVOL is NOT clearly discriminating`);
      console.log(`      a real early-detection gap in the quiet population at this sample size; it looks more like`);
      console.log(`      the base rate of ANY liquid name's full-day favorable excursion than a distinct signal.`);
    } else {
      console.log(`      This is a REAL lift over the base rate — evidence RVOL is flagging something in the quiet`);
      console.log(`      population that a bare base-rate chance would not explain.`);
    }
  }
  if (graded.length >= 20) {
    console.log(`      n>=20 — this is a real, reportable rate, not an anecdote.`);
  } else {
    console.log(`      n<20 — too thin to trust yet; grow the sample (more --days, or re-run with --replay`);
    console.log(`      as more days accumulate) before treating this rate as settled.`);
  }
}

console.log(`\n${line("═")}`);
console.log(`  No gate, filter, or screen threshold changed by this run — evidence-gathering only.`);
console.log(`  Collection persists per-day rows to docs/audit/history/zerodte-rvol-universe-shadow/ —`);
console.log(`  re-run with --replay to fold in already-collected days without re-fetching them, and`);
console.log(`  with fresh --days to keep growing the sample across future sessions.`);
console.log(line("═"));

if (EMIT_JSON) {
  console.log("\n<<<JSON>>>");
  console.log(JSON.stringify({ days_in_hand: allDayResults.map((d) => d.date), qualifying: qRows, quiet: uRows }, null, 2));
}
