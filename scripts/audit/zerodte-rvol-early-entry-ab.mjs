/**
 * RVOL EARLY-ENTRY A/B — would the already-shipped RVOL shadow signal have let Night Hawk catch
 * real BREAKOUT-origin setups earlier, and does that earlier entry actually improve real-cost
 * outcomes?
 * ============================================================================================
 * WHY THIS EXISTS (2026-10-20, member directive: "prioritize testing earlier entries, including
 * the RVOL shadow signal... report whether they improve results after realistic options costs,
 * using unseen data before changing live filters")
 * ------------------------------------------------------------------------------------------
 * `zerodte-breakout-origin-report.mjs` found BREAKOUT-origin flags land 127 minutes into the
 * session on average, with 77.7% of the day's eventual favorable move already banked by then
 * (n=393, 90 days) — and traced the likely cause to `screenBreakoutMovers` being an inherently
 * LAGGING price/volume-momentum screen. RVOL (relative volume, `relative-volume.ts`, shipped
 * PR #6287/#6289, shadow-only — never gates or scores a live commit) is a LEADING candidate:
 * unusual volume for a NAME'S OWN pace can precede the price move that eventually trips the
 * gain%/$-volume screen.
 *
 * METHOD — same-contract, same-exit-rule, different-entry-TIME comparison (per the member's own
 * "consistent entry, exit, and cost assumptions... don't treat planned/simulated/verified-actual
 * as interchangeable" instruction):
 *   1. Real BREAKOUT-only committed plays (`/api/admin/zerodte/tier-export`) — real
 *      ticker/direction/strike/expiry/flag-time, TRAIN/VALIDATION chronological split.
 *   2. For each, walk the ticker's OWN real minute bars from the real 9:30 ET RTH open up to the
 *      REAL flag time, computing RVOL at every bar via the REAL, unmodified `computeRelativeVolume`
 *      (imported directly — never reimplemented) against a REAL time-of-day volume profile
 *      (`buildTimeOfDayVolumeProfile`, built from the ticker's own real trailing minute bars,
 *      `groupMinuteBarsByDate` reused from relative-volume-source.ts) — no look-ahead: only bars
 *      up to and including each candidate instant are used to judge that instant.
 *   3. Find the EARLIEST instant RVOL classifies "high" or "very_high" (relative-volume.ts's own
 *      thresholds, unchanged). If none exists, or it's not meaningfully earlier than the real
 *      flag (>= EARLY_MARGIN_MIN), the play is excluded — "RVOL wouldn't have helped here" is a
 *      real, counted outcome, not silently dropped.
 *   4. Grade BOTH legs — (a) the REAL flag-time entry and (b) the early-RVOL-signaled entry —
 *      under the IDENTICAL mechanical rule: real NBBO at (instant + ENTRY_DELAY_SEC), same
 *      contract, real option minute-bar walk, same PLAN_RULES -50/+100 stop/target, real NBBO
 *      exit on a non-touch. Both legs are therefore "planned/mechanical" in the three-way
 *      vocabulary this investigation has used all round (never the real managed/ratchet exit,
 *      which only the real flag-time entry ever actually experienced) — a clean apples-to-apples
 *      A/B on ENTRY TIMING ALONE, isolated from exit-management differences.
 *
 * THIS SCRIPT NEVER CHANGES A GATE, FILTER, OR THRESHOLD — evidence-gathering only, exactly the
 * member's own "using unseen data before changing live filters" instruction.
 *
 * USAGE
 *   POLYGON_API_BASE=https://api.massive.com \
 *   env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY \
 *   node --import tsx scripts/audit/zerodte-rvol-early-entry-ab.mjs [options]
 * OPTIONS
 *   --days=N            tier-export window (default 60)
 *   --max-setups=N      cap on setups graded per half (default 40)
 *   --early-margin=N    minutes the RVOL signal must precede the real flag by to count as "early
 *                        entry available" (default 10)
 *   --entry-delay=SEC   realistic entry delay (default 90)
 *   --hold-minutes=N    max holding window (default 90)
 *   --json
 */

if (!process.env.POLYGON_API_BASE || !/^https?:\/\//.test(process.env.POLYGON_API_BASE)) {
  process.env.POLYGON_API_BASE = "https://api.massive.com";
}

const APP_BASE = process.env.AUDIT_BASE || "https://blackouttrades.com";
const argv = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    return m ? [m[1], m[2] ?? "true"] : [a, "true"];
  })
);
const DAYS = Math.max(1, Number(argv.days ?? 60));
const MAX_SETUPS_PER_HALF = Math.max(1, Number(argv["max-setups"] ?? 40));
const EARLY_MARGIN_MIN = Math.max(1, Number(argv["early-margin"] ?? 10));
const ENTRY_DELAY_SEC = Math.max(0, Number(argv["entry-delay"] ?? 90));
const HOLD_MINUTES = Math.max(5, Number(argv["hold-minutes"] ?? 90));
const EMIT_JSON = Boolean(argv.json);
const BASE = argv.base ?? APP_BASE;

const { fetchAuditJson, releaseAuditClerkSession } = await import("./lib/audit-auth-fetch.mjs");
const SRC = new URL("../../src/", import.meta.url).pathname;
const { fetchStockMinuteBars, fetchOptionMinuteBars } = await import(`${SRC}lib/providers/polygon.ts`);
const { buildTimeOfDayVolumeProfile, computeRelativeVolume, RVOL_PROFILE_MIN_DAYS } = await import(`${SRC}lib/zerodte/relative-volume.ts`);
const { groupMinuteBarsByDate } = await import(`${SRC}lib/zerodte/relative-volume-source.ts`);
const { PLAN_RULES } = await import(`${SRC}lib/zerodte/plan.ts`);
const { etWallClockToUtcMs } = await import("./lib/swing-cadence-gap-eval.mjs");

const POLYGON_BASE = process.env.POLYGON_API_BASE;
const POLYGON_KEY = process.env.POLYGON_API_KEY;

const line = (c = "─", w = 112) => c.repeat(w);
const fmtPct = (n) => (n == null ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`);
function etYmd(ms) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(ms));
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
  let best = null, bestDiff = Infinity;
  for (const q of data.results) {
    const t = Math.floor(q.sip_timestamp / 1e6);
    const diff = Math.abs(t - atMs);
    if (diff < bestDiff) { bestDiff = diff; best = q; }
  }
  return best ? { bid: best.bid_price, ask: best.ask_price } : null;
}

async function gradeMechanicalEntry({ occ, direction, day, entryAtMs }) {
  const entryQuote = await fetchQuoteNear(occ, entryAtMs);
  if (!entryQuote || !(entryQuote.bid > 0) || !(entryQuote.ask > 0)) return { outcome: "NO_QUOTE" };
  const entryPx = direction === "long" ? entryQuote.ask : entryQuote.bid;
  const timeStopMs = Date.parse(`${day}T19:50:00Z`);
  const holdEndMs = Math.min(entryAtMs + HOLD_MINUTES * 60_000, timeStopMs);
  const bars = await fetchOptionMinuteBars(occ, day, day).catch(() => []);
  const walkBars = bars.filter((b) => b.t > entryAtMs && b.t <= holdEndMs);
  const stopPx = entryPx * (1 + PLAN_RULES.stop_pct / 100);
  const targetPx = entryPx * (1 + PLAN_RULES.target_pct / 100);
  let exitPx = null, exitReason = "time_stop", exitAtMs = holdEndMs;
  for (const b of walkBars) {
    if (b.l <= stopPx) { exitPx = stopPx; exitReason = "stopped"; exitAtMs = b.t; break; }
    if (b.h >= targetPx) { exitPx = targetPx; exitReason = "target"; exitAtMs = b.t; break; }
  }
  if (exitPx == null) {
    const exitQuote = await fetchQuoteNear(occ, exitAtMs);
    if (!exitQuote || !(exitQuote.bid > 0) || !(exitQuote.ask > 0)) return { outcome: "NO_EXIT_QUOTE" };
    exitPx = exitQuote.bid;
  }
  const pnlPct = ((exitPx - entryPx) / entryPx) * 100;
  return { entryPx, exitPx, pnlPct: Math.round(pnlPct * 100) / 100, exitReason, outcome: pnlPct > 0 ? "WIN" : "LOSS" };
}

console.log(line("═"));
console.log(`  RVOL EARLY-ENTRY A/B — same contract/exit-rule, real flag time vs earliest real RVOL signal`);
console.log(`  tier-export window ${DAYS}d · cap ${MAX_SETUPS_PER_HALF}/half · early margin >=${EARLY_MARGIN_MIN}min · entry delay ${ENTRY_DELAY_SEC}s`);
console.log(line("═"));

try {
  console.log(`\n[1] Fetching real committed BREAKOUT-only plays…`);
  const res = await fetchAuditJson(BASE, `/api/admin/zerodte/tier-export?days=${DAYS}`);
  const plays = (res.json.plays ?? []).filter((p) => {
    const o = p.discovery_origin;
    return Array.isArray(o) && o.length === 1 && o[0] === "BREAKOUT" && p.top_strike && p.expiry;
  });
  console.log(`    ${plays.length} real BREAKOUT-only committed plays with a resolvable contract`);
  const chron = [...plays].sort((a, b) => Date.parse(a.first_flagged_at) - Date.parse(b.first_flagged_at));
  const splitIdx = Math.ceil(chron.length / 2);
  const trainPlays = chron.slice(0, splitIdx).slice(0, MAX_SETUPS_PER_HALF);
  const valPlays = chron.slice(splitIdx).slice(0, MAX_SETUPS_PER_HALF);
  console.log(`    grading ${trainPlays.length} TRAIN + ${valPlays.length} VALIDATION`);

  async function processHalf(label, setPlays) {
    const results = [];
    for (const p of setPlays) {
      const day = p.session_date;
      const flagMs = Date.parse(p.first_flagged_at);
      const occ = buildOcc(p.ticker, p.expiry, p.direction, p.top_strike);

      const rthOpenMs = etWallClockToUtcMs(day, 9 * 60 + 30);
      if (flagMs <= rthOpenMs) { results.push({ ticker: p.ticker, day, status: "SKIP_PRE_OPEN" }); continue; }

      const todayBars = (await fetchStockMinuteBars(p.ticker, day, day).catch(() => [])).filter((b) => b.t >= rthOpenMs && b.t <= flagMs);
      if (!todayBars.length) { results.push({ ticker: p.ticker, day, status: "NO_TODAY_BARS" }); continue; }

      // Real trailing days for the time-of-day profile + avg daily volume — never the day itself.
      const fromDay = etYmd(rthOpenMs - 20 * 86_400_000);
      const trailingBars = (await fetchStockMinuteBars(p.ticker, fromDay, etYmd(rthOpenMs - 86_400_000)).catch(() => []));
      const byDate = groupMinuteBarsByDate(trailingBars);
      const dailyMinuteVolumes = [...byDate.values()];
      const profile = buildTimeOfDayVolumeProfile(dailyMinuteVolumes);
      const avgDailyVolume = dailyMinuteVolumes.length
        ? dailyMinuteVolumes.reduce((s, day) => s + day.reduce((a, b) => a + b, 0), 0) / dailyMinuteVolumes.length
        : null;
      if (!profile || !avgDailyVolume || dailyMinuteVolumes.length < RVOL_PROFILE_MIN_DAYS) {
        results.push({ ticker: p.ticker, day, status: "NO_PROFILE" });
        continue;
      }

      let cumVol = 0;
      let earliestHighMs = null;
      for (const b of todayBars) {
        cumVol += Number.isFinite(b.v) ? b.v : 0;
        const read = computeRelativeVolume({ cumulativeVolumeToday: cumVol, avgDailyVolume, nowMs: b.t, timeOfDayProfile: profile });
        if ((read.classification === "high" || read.classification === "very_high") && earliestHighMs == null) {
          earliestHighMs = b.t;
          break; // earliest is what we want — stop once found
        }
      }

      const flagEtMin = Math.round((flagMs - rthOpenMs) / 60_000);
      if (earliestHighMs == null) { results.push({ ticker: p.ticker, day, status: "NO_RVOL_SIGNAL", flagEtMin }); continue; }
      const marginMin = Math.round((flagMs - earliestHighMs) / 60_000);
      if (marginMin < EARLY_MARGIN_MIN) { results.push({ ticker: p.ticker, day, status: "RVOL_NOT_EARLY_ENOUGH", marginMin, flagEtMin }); continue; }

      const realEntryAtMs = flagMs + ENTRY_DELAY_SEC * 1000;
      const earlyEntryAtMs = earliestHighMs + ENTRY_DELAY_SEC * 1000;
      const realLeg = await gradeMechanicalEntry({ occ, direction: p.direction, day, entryAtMs: realEntryAtMs });
      const earlyLeg = await gradeMechanicalEntry({ occ, direction: p.direction, day, entryAtMs: earlyEntryAtMs });
      results.push({ ticker: p.ticker, day, status: "GRADED", marginMin, flagEtMin, realLeg, earlyLeg });
      await new Promise((r) => setTimeout(r, 150));
    }
    return results;
  }

  console.log(`\n[2] Grading TRAIN…`);
  const trainResults = await processHalf("TRAIN", trainPlays);
  console.log(`\n[3] Grading VALIDATION…`);
  const valResults = await processHalf("VALIDATION", valPlays);

  function summarize(label, results) {
    const statusCounts = new Map();
    for (const r of results) statusCounts.set(r.status, (statusCounts.get(r.status) ?? 0) + 1);
    console.log(`\n${line()}`);
    console.log(`  ${label} (n=${results.length})`);
    console.log(line());
    console.log(`    status breakdown: ${JSON.stringify(Object.fromEntries(statusCounts))}`);
    const graded = results.filter((r) => r.status === "GRADED" && r.realLeg.outcome && r.earlyLeg.outcome &&
      (r.realLeg.outcome === "WIN" || r.realLeg.outcome === "LOSS") && (r.earlyLeg.outcome === "WIN" || r.earlyLeg.outcome === "LOSS"));
    console.log(`    both-legs-gradeable (real-cost comparable): n=${graded.length}`);
    if (!graded.length) return null;
    const avgMargin = graded.reduce((s, r) => s + r.marginMin, 0) / graded.length;
    const realWins = graded.filter((r) => r.realLeg.outcome === "WIN").length;
    const earlyWins = graded.filter((r) => r.earlyLeg.outcome === "WIN").length;
    const realAvgPnl = graded.reduce((s, r) => s + r.realLeg.pnlPct, 0) / graded.length;
    const earlyAvgPnl = graded.reduce((s, r) => s + r.earlyLeg.pnlPct, 0) / graded.length;
    const paired = graded.map((r) => r.earlyLeg.pnlPct - r.realLeg.pnlPct);
    const meanDelta = paired.reduce((s, d) => s + d, 0) / paired.length;
    const sd = Math.sqrt(paired.reduce((s, d) => s + (d - meanDelta) ** 2, 0) / Math.max(1, paired.length - 1));
    const se = sd / Math.sqrt(paired.length);
    console.log(`    avg RVOL-signal lead time over the real flag: ${avgMargin.toFixed(0)}min`);
    console.log(`    REAL flag-time entry:  win_rate=${((realWins / graded.length) * 100).toFixed(1)}%  mean_pnl=${fmtPct(realAvgPnl)}`);
    console.log(`    EARLY RVOL-signal entry: win_rate=${((earlyWins / graded.length) * 100).toFixed(1)}%  mean_pnl=${fmtPct(earlyAvgPnl)}`);
    console.log(`    PAIRED mean delta (early - real): ${fmtPct(meanDelta)}  (95% CI: [${fmtPct(meanDelta - 1.96 * se)}, ${fmtPct(meanDelta + 1.96 * se)}])`);
    return { n: graded.length, realWinRate: (realWins / graded.length) * 100, earlyWinRate: (earlyWins / graded.length) * 100, meanDelta, se };
  }

  const trainSummary = summarize("TRAIN", trainResults);
  const valSummary = summarize("VALIDATION — HELD OUT, UNSEEN", valResults);

  console.log(`\n${line("═")}`);
  console.log(`  CROSS-CHECK: does any TRAIN direction hold in VALIDATION?`);
  console.log(line("═"));
  console.log(`    mean delta (early - real): TRAIN ${trainSummary ? fmtPct(trainSummary.meanDelta) : "—"} vs VALIDATION ${valSummary ? fmtPct(valSummary.meanDelta) : "—"}`);
  console.log(`\n  No gate/filter/threshold changed by this run — evidence-gathering only.`);
  console.log(line("═"));

  if (EMIT_JSON) {
    console.log("\n<<<JSON>>>");
    console.log(JSON.stringify({ trainResults, valResults, trainSummary, valSummary }, null, 2));
  }
} finally {
  await releaseAuditClerkSession();
}
