/**
 * BREAKOUT-ORIGIN 0DTE PERFORMANCE + ENTRY-TIMING REPORT — real production history, no replay.
 * ============================================================================================
 * WHY THIS EXISTS (2026-10-20, member directive: "expand testing to BREAKOUT-origin setups
 * since they account for 29 of 37 production commits... separate detection problems, entry
 * timing, contract selection, and exit management... rank the fixes by evidence")
 * ------------------------------------------------------------------------------------------
 * Every point-in-time replay tool built earlier this session (zerodte-missed-trades-tracker.mjs,
 * zerodte-gate-rejection-trace.mjs) is FLOW-origin only: it re-derives setups from raw UW flow
 * prints, truncated per real print instant — a tractable replay because FLOW's "evidence" is a
 * short, discrete list of alert timestamps. BREAKOUT's evidence is a WHOLE-MARKET momentum/
 * $-volume screen read from an intraday-accumulating grouped-daily bar — reconstructing that
 * point-in-time would mean fetching real minute bars for hundreds of candidate tickers at many
 * instants per session day, which this sandbox cannot do at the scale needed without either
 * reintroducing a new look-ahead bug of its own or taking prohibitively long. Real production
 * commits are dominated by BREAKOUT (measured 2026-10-20: 152 BREAKOUT-only + 8 BREAKOUT+FLOW +
 * 1 BREAKOUT+FLOW+PIN of 211 real plays over a real 30-day window = ~76%) — too large a share to
 * leave unmeasured, so this script takes the tractable, still-genuinely-real path instead:
 *
 * 1. **COMMITTED performance** — `GET /api/market/zerodte/record`'s real plays already carry a
 *    MECHANICAL grade (`plan_outcome`/`plan_pnl_pct`, naive -50/+100 time-stop) AND the REAL
 *    AS-MANAGED grade (`managed_outcome`/`managed_pnl_pct`, what the engine's actual exit logic —
 *    ratchet floors, ladder trims — actually delivered). These numbers are PRODUCTION'S OWN,
 *    computed server-side the moment each play closed — no replay, no look-ahead risk by
 *    construction, and (per the already-shipped entry-achievability-ceiling fix, #6288) the basis
 *    they're computed from is now corrected for unachievable flow-fill dislocations. Reported for
 *    BREAKOUT-only and BREAKOUT-involving (any co-discovery) subsets, split TRAIN/VALIDATION.
 * 2. **ENTRY-TIMING LAG** — for each committed BREAKOUT play, fetches the REAL underlying's own
 *    minute bars for that session day and measures: (a) how many minutes after the session open
 *    the flag fired, (b) the underlying's own %gain already banked BY flag time vs (c) its
 *    eventual intraday peak %gain for the rest of the session. A flag landing late in a stock's
 *    own move (most of the eventual gain already banked before the flag) is a real, measurable
 *    "catching it late" signal — this is the closest this sandbox can get to a Swift-style
 *    "did we alert early or late" comparison without the actual Swift timestamped examples (not
 *    available in this session — see the written report for that gap).
 * 3. **MISSED-TRADE PROXY** — `GET /api/admin/zerodte/rejection-export`'s `counterfactual_json`
 *    (skip-grading.ts's `runSkipGrading`) already grades REJECTED candidates against real forward
 *    bars, live, with no look-ahead risk (entry = first real bar at/after the block, same PLAN_
 *    RULES as committed plays) — for whichever rows the grading cron has actually reached.
 *    BREAKOUT/PIN-origin rejections are NOT separable from FLOW's own evidence-gate-only rejects
 *    in this export (no `discovery_origin` column exposed) — approximated here as `gross_premium
 *    === 0` (true for BREAKOUT/PIN "by construction," per board.ts's own comment), which cannot
 *    separate BREAKOUT from the much rarer PIN origin (1/211 real commits) but is overwhelmingly
 *    BREAKOUT in practice. **Coverage is real but thin** — the grading cron (`zerodte-skip-grade`)
 *    only clears MAX_ROWS_PER_RUN=200 of a real ~2,000+/day rejection volume, and anything older
 *    than MAX_SKIP_GRADE_DAYS=14 ages out of its query window and is never graded at all. Reported
 *    as-is, with that limitation disclosed rather than padded out with a reconstruction.
 *
 * NO GATE, THRESHOLD, OR FILTER IS TOUCHED BY THIS SCRIPT. Evidence-gathering only.
 *
 * USAGE
 *   node --import tsx scripts/audit/zerodte-breakout-origin-report.mjs [options]
 * OPTIONS
 *   --days=N            record window (default 90)
 *   --base=URL           app base (default https://blackouttrades.com)
 *   --json
 */

const APP_BASE = process.env.AUDIT_BASE || "https://blackouttrades.com";
const argv = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    return m ? [m[1], m[2] ?? "true"] : [a, "true"];
  })
);
const DAYS = Math.max(1, Number(argv.days ?? 90));
const EMIT_JSON = Boolean(argv.json);
const BASE = argv.base ?? APP_BASE;

const { fetchAuditJson, releaseAuditClerkSession } = await import("./lib/audit-auth-fetch.mjs");

const SRC = new URL("../../src/", import.meta.url).pathname;
const { fetchStockMinuteBars } = await import(`${SRC}lib/providers/polygon.ts`);

const line = (c = "─", w = 112) => c.repeat(w);
const fmtPct = (n) => (n == null ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`);

console.log(line("═"));
console.log(`  BREAKOUT-ORIGIN 0DTE PERFORMANCE + ENTRY-TIMING REPORT (real production history)`);
console.log(`  record window ${DAYS}d · base ${BASE}`);
console.log(line("═"));

let record, rejectionDays;
try {
  console.log(`\n[1] Fetching real committed plays…`);
  const res = await fetchAuditJson(BASE, `/api/market/zerodte/record?days=${DAYS}`);
  record = res.json;
  const plays = record.plays ?? [];
  console.log(`    ${plays.length} real graded/ungraded plays over the window`);

  const originOf = (p) => {
    const o = p.entry_context?.discovery_origin;
    return Array.isArray(o) ? [...o].sort().join("+") : "UNKNOWN";
  };
  const breakoutOnly = plays.filter((p) => originOf(p) === "BREAKOUT");
  const breakoutInvolving = plays.filter((p) => (p.entry_context?.discovery_origin ?? []).includes("BREAKOUT"));
  const originCounts = new Map();
  for (const p of plays) originCounts.set(originOf(p), (originCounts.get(originOf(p)) ?? 0) + 1);
  console.log(`    origin breakdown: ${JSON.stringify(Object.fromEntries(originCounts))}`);
  console.log(`    BREAKOUT-only: ${breakoutOnly.length} · BREAKOUT-involving (any co-discovery): ${breakoutInvolving.length}`);

  function summarizeBasis(label, rows, outcomeKey, pnlKey) {
    const gradeable = rows.filter((p) => typeof p[pnlKey] === "number");
    if (!gradeable.length) {
      console.log(`    ${label}: n=0 (no gradeable rows)`);
      return null;
    }
    const wins = gradeable.filter((p) => p[pnlKey] > 0);
    const losses = gradeable.filter((p) => p[pnlKey] <= 0);
    const winRate = (wins.length / gradeable.length) * 100;
    const avgGain = wins.length ? wins.reduce((s, p) => s + p[pnlKey], 0) / wins.length : null;
    const avgLoss = losses.length ? losses.reduce((s, p) => s + p[pnlKey], 0) / losses.length : null;
    const chron = [...gradeable].sort((a, b) => Date.parse(a.flagged_at) - Date.parse(b.flagged_at));
    let running = 0, peak = 0, maxDd = 0;
    for (const p of chron) {
      running += p[pnlKey];
      peak = Math.max(peak, running);
      maxDd = Math.min(maxDd, running - peak);
    }
    console.log(
      `    ${label}: n=${gradeable.length}  win_rate=${winRate.toFixed(1)}% (${wins.length}W/${losses.length}L)  ` +
        `avg_gain=${fmtPct(avgGain)}  avg_loss=${fmtPct(avgLoss)}  max_drawdown=${fmtPct(maxDd)}`
    );
    return { n: gradeable.length, winRate, avgGain, avgLoss, maxDd };
  }

  function reportSplit(label, rows) {
    console.log(`\n  ${label} (n=${rows.length} total plays)`);
    const chron = [...rows].sort((a, b) => Date.parse(a.flagged_at) - Date.parse(b.flagged_at));
    const splitIdx = Math.ceil(chron.length / 2);
    const trainRows = chron.slice(0, splitIdx);
    const valRows = chron.slice(splitIdx);
    console.log(`  MECHANICAL basis (naive -50/+100 time-stop, no active management):`);
    summarizeBasis(`    TRAIN (n=${trainRows.length})`, trainRows, "plan_outcome", "plan_pnl_pct");
    summarizeBasis(`    VALIDATION (n=${valRows.length})`, valRows, "plan_outcome", "plan_pnl_pct");
    console.log(`  MANAGED basis (real as-traded exit — ratchet floors/ladder trims actually applied):`);
    summarizeBasis(`    TRAIN (n=${trainRows.length})`, trainRows, "managed_outcome", "managed_pnl_pct");
    summarizeBasis(`    VALIDATION (n=${valRows.length})`, valRows, "managed_outcome", "managed_pnl_pct");
  }

  console.log(`\n${line()}`);
  console.log(`  [A] COMMITTED PERFORMANCE`);
  console.log(line());
  reportSplit("BREAKOUT-ONLY", breakoutOnly);
  reportSplit("BREAKOUT-INVOLVING (any co-discovery)", breakoutInvolving);

  console.log(`\n${line()}`);
  console.log(`  [B] ENTRY-TIMING LAG — how much of the underlying's own move was already banked by flag time`);
  console.log(line());
  const timingRows = [];
  for (const p of breakoutOnly) {
    const day = p.session_date;
    const flagMs = Date.parse(p.flagged_at);
    if (!Number.isFinite(flagMs)) continue;
    const bars = await fetchStockMinuteBars(p.ticker, day, day).catch(() => []);
    if (!bars?.length) continue;
    const rthBars = bars.filter((b) => b.t <= flagMs + 1); // real bars available at/before the flag
    if (!rthBars.length) continue;
    const openPx = rthBars[0]?.o ?? rthBars[0]?.c;
    const atFlagPx = rthBars[rthBars.length - 1]?.c;
    if (!(openPx > 0) || !(atFlagPx > 0)) continue;
    const gainAtFlagPct = ((atFlagPx - openPx) / openPx) * 100 * (p.direction === "long" ? 1 : -1);
    const allRthBars = bars.filter((b) => b.t >= rthBars[0].t);
    let peakFavorablePct = gainAtFlagPct;
    for (const b of allRthBars) {
      const px = p.direction === "long" ? b.h : b.l;
      const movePct = ((px - openPx) / openPx) * 100 * (p.direction === "long" ? 1 : -1);
      if (movePct > peakFavorablePct) peakFavorablePct = movePct;
    }
    const lagMinutes = Math.round((flagMs - rthBars[0].t) / 60_000);
    const bankedFraction = peakFavorablePct > 0 ? Math.max(0, Math.min(1, gainAtFlagPct / peakFavorablePct)) : null;
    timingRows.push({ ticker: p.ticker, day, lagMinutes, gainAtFlagPct, peakFavorablePct, bankedFraction });
  }
  if (timingRows.length) {
    const avgLag = timingRows.reduce((s, r) => s + r.lagMinutes, 0) / timingRows.length;
    const bankable = timingRows.filter((r) => r.bankedFraction != null);
    const avgBanked = bankable.length ? (bankable.reduce((s, r) => s + r.bankedFraction, 0) / bankable.length) * 100 : null;
    console.log(`    n=${timingRows.length} BREAKOUT-only plays with real minute bars`);
    console.log(`    avg minutes-since-open at flag time: ${avgLag.toFixed(0)}min`);
    console.log(
      `    avg fraction of the day's eventual favorable move already banked by flag time: ` +
        `${avgBanked != null ? avgBanked.toFixed(1) + "%" : "—"} (n=${bankable.length})`
    );
    console.log(`    (100% banked = flagged exactly at the day's best print; 0% = flagged at the day's open move start)`);
  } else {
    console.log(`    no gradeable rows (no real minute bars resolved)`);
  }

  console.log(`\n${line()}`);
  console.log(`  [C] MISSED-TRADE PROXY — real graded skip-grading counterfactual, gross_premium=0 rows`);
  console.log(line());
  const sessionDates = [...new Set((record.plays ?? []).map((p) => p.session_date))].sort().reverse().slice(0, 20);
  rejectionDays = [];
  for (const day of sessionDates) {
    const rej = await fetchAuditJson(BASE, `/api/admin/zerodte/rejection-export?limit=2000&session_date=${day}`).catch(() => null);
    if (!rej?.json?.rows) continue;
    rejectionDays.push({ day, rows: rej.json.rows });
  }
  const allRejRows = rejectionDays.flatMap((d) => d.rows);
  const breakoutProxyRows = allRejRows.filter((r) => (r.gross_premium === 0 || r.gross_premium == null) && r.counterfactual != null);
  console.log(`    checked ${rejectionDays.length} real session day(s): ${rejectionDays.map((d) => d.day).join(", ")}`);
  console.log(`    ${allRejRows.length} total rejection rows seen, ${breakoutProxyRows.length} are gross_premium=0 (BREAKOUT/PIN proxy) AND already graded`);
  if (breakoutProxyRows.length) {
    const verdicts = new Map();
    for (const r of breakoutProxyRows) verdicts.set(r.counterfactual.verdict, (verdicts.get(r.counterfactual.verdict) ?? 0) + 1);
    console.log(`    verdict breakdown: ${JSON.stringify(Object.fromEntries(verdicts))}`);
    const wouldWin = breakoutProxyRows.filter((r) => r.counterfactual.verdict === "would_have_won");
    console.log(`    would_have_won tickers: ${wouldWin.slice(0, 10).map((r) => `${r.ticker}(${r.gate_failed})`).join(", ")}${wouldWin.length > 10 ? "…" : ""}`);
  } else {
    console.log(`    NO graded gross_premium=0 rows found in the checked days — the grading cron's`);
    console.log(`    throughput cap (200 rows/day vs ~2000+/day volume) hasn't reached this population`);
    console.log(`    yet. This is a real coverage gap, not a clean negative result — see the written`);
    console.log(`    report for the proposed fix (raise the cron's row cap / run cadence).`);
  }

  console.log(`\n${line("═")}`);
  console.log(`  No gate/filter/threshold changed by this run — evidence-gathering only.`);
  console.log(line("═"));

  if (EMIT_JSON) {
    console.log("\n<<<JSON>>>");
    console.log(JSON.stringify({ breakoutOnlyCount: breakoutOnly.length, breakoutInvolvingCount: breakoutInvolving.length, timingRows, breakoutProxyRows }, null, 2));
  }
} finally {
  await releaseAuditClerkSession();
}
