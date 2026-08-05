/**
 * NIGHT HAWK CALIBRATION TABLE — provisional NH-R5/R8/R9/R11 constant graduation (NH-R6)
 * ========================================================================================
 *
 * WHY THIS EXISTS
 * ---------------
 * `src/lib/zerodte/calibration.ts` already runs a full graduation ladder (n>=ENFORCE_MIN_BLOCK_N=10,
 * delta>=ENFORCE_MIN_DELTA_PTS=15pts) over the shipped calibration-mode gates (G-4/G-6), the score
 * bands, tiers, confluence, accumulation, origin/play-type bands and the banger scale-out exit. But
 * four newer, EXPLICITLY-provisional scoring constants shipped as "documented first cuts, not a
 * calibrated fit" in their own remediation PRs, each pointing at this script as the natural place to
 * graduate them once graded rows accumulate (docs/audit/FINDINGS.md, search "pending NH-R6"):
 *   - STREAK_FADE_START_DAYS / STREAK_EXHAUSTION_FLOOR_MULTIPLIER (scorer.ts, NH-R8)
 *   - LIQUIDITY_TIE_BREAK_DOLLARS_PER_POINT                       (breakout-source.ts, NH-R5)
 *   - CONTESTED_MIN_MAGNITUDE                                     (cortex/compose.ts, NH-R9)
 *   - FAMILY_SUPPORT_CAPS["dealer-positioning"]                   (cortex/compose.ts, NH-R11)
 *
 * This prints ONE consolidated table, one row per constant, reusing calibration.ts's EXISTING
 * machinery (analyzeGateCalibration/bucketOf/recommendSignal, the exact ENFORCE_MIN_BLOCK_N /
 * ENFORCE_MIN_DELTA_PTS constants) — it adds NO new thresholds, no new DB query, and no new
 * graduation rule. It reuses `db.fetchZeroDteSetupLogRange` + `skip-grading.fetchGradedSkips`, the
 * SAME data layer `buildZeroDteCalibrationReport` uses.
 *
 * HONESTY (per-constant, never fabricated — see docs/audit/FINDINGS.md for the full trace):
 *   - CONTESTED_MIN_MAGNITUDE (NH-R9): DERIVABLE. The contested gate is a hard block, so its only
 *     ledger evidence is the counterfactually-graded `cortex_contested` skip-grading rejections
 *     (calibration.ts's existing `blocked_value` line for that gate_failed code) against the
 *     aggregate committed win rate as the would-pass baseline.
 *   - FAMILY_SUPPORT_CAPS (NH-R11): PARTIALLY DERIVABLE, WITH A CAVEAT PRINTED EVERY RUN. A
 *     committed row's `entry_context.cortex.supports` is already POST-cap (compose.ts scales the
 *     family's items down in place before returning the verdict), so this can only bucket on
 *     whether the persisted family sum SATURATES at the cap (a proxy for "the cap fired"), never
 *     the true pre-cap magnitude it suppressed. Reported honestly as a proxy, via recommendSignal.
 *   - STREAK_FADE_* (NH-R8) and LIQUIDITY_TIE_BREAK_DOLLARS_PER_POINT (NH-R5): NOT DERIVABLE from
 *     what's currently persisted. `entry_context` (entry-context.ts's ZeroDteEntryContext) does not
 *     carry `streak_days` at commit (only the live board's transient EnrichedZeroDteSetup does —
 *     board.ts:1250) and `pickAtmZeroDteContract` (breakout-source.ts) does not persist whether its
 *     liquidity-quality tie-break term actually changed which candidate won (vs a plain distance-
 *     only pick) — only the FINAL contract + `used_1dte_fallback` reach entry_context. These print
 *     INSUFFICIENT_DATA with the exact missing field, never a fabricated comparison.
 *
 * USAGE
 *   env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY \
 *   node --import tsx scripts/audit/nighthawk-calibration-table.mjs [--days=30] [--json] [--quiet]
 *
 * Secrets from env only (DATABASE_URL). Self-defaults POLYGON_API_BASE (unused here — no Polygon
 * calls — but set for parity with every other audit script's env-guard convention). Read-only:
 * only SELECTs against zerodte_setup_log / zerodte_scan_rejections via the app's own db.ts. Never
 * prints secrets.
 */

if (!process.env.POLYGON_API_BASE || !/^https?:\/\//.test(process.env.POLYGON_API_BASE)) {
  process.env.POLYGON_API_BASE = "https://api.massive.com";
}

const {
  analyzeGateCalibration,
  bucketOf,
  ENFORCE_MIN_BLOCK_N,
  ENFORCE_MIN_DELTA_PTS,
} = await import("../../src/lib/zerodte/calibration.ts");
const { isGradedZeroDteRow, LOW_N_THRESHOLD } = await import("../../src/lib/zerodte/record.ts");
const { CORTEX_SOURCE_FAMILY } = await import("../../src/lib/nighthawk/cortex/types.ts");
const { FAMILY_SUPPORT_CAPS } = await import("../../src/lib/nighthawk/cortex/compose.ts");
const {
  displayVerdict,
  contestedGateVerdict,
  dealerFamilySupportSum,
  familyCapBucket,
} = await import("./lib/nighthawk-calibration-table-eval.mjs");

// ── args (same convention as condor-wr.mjs / zerodte-sim.mjs) ───────────────────────────────
const arg = (name, dflt) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};
const flag = (name) => process.argv.includes(`--${name}`);

const DAYS = Math.max(1, Math.min(90, Number(arg("days", "30")) || 30));
const JSON_OUT = flag("json");
const QUIET = flag("quiet");
const DEALER_CAP = FAMILY_SUPPORT_CAPS["dealer-positioning"];

function etYmd(ms) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(ms));
}

async function main() {
  const nowMs = Date.now();
  const through = etYmd(nowMs);
  const since = etYmd(nowMs - DAYS * 24 * 60 * 60 * 1000);
  const window = { since, through, days: DAYS };

  const db = await import("../../src/lib/db.ts");
  const dbUp = db.dbConfigured();

  let rows = [];
  let gradedSkips = [];
  let dbError = null;
  if (dbUp) {
    try {
      rows = await db.fetchZeroDteSetupLogRange(since, Math.min(2000, DAYS * 20));
    } catch (e) {
      dbError = String(e?.message ?? e);
    }
    try {
      const skipMod = await import("../../src/lib/zerodte/skip-grading.ts");
      gradedSkips = await skipMod.fetchGradedSkips({ sinceYmd: since, throughYmd: through });
    } catch {
      // skip-grade rejections unreadable — the row below just reports fewer no_verdict rows.
    }
  }

  const graded = rows.filter(isGradedZeroDteRow);
  const report = analyzeGateCalibration({ rows, gradedSkips, window });
  const baseline = bucketOf("baseline_all_graded", graded);

  const table = [];

  // ── NH-R8: STREAK_FADE_START_DAYS / STREAK_EXHAUSTION_FLOOR_MULTIPLIER ──────────────────────
  table.push({
    constant: "STREAK_FADE_START_DAYS / STREAK_EXHAUSTION_FLOOR_MULTIPLIER",
    file: "src/features/nighthawk/lib/scorer.ts",
    pr: "NH-R8",
    n: 0,
    delta_pts: null,
    verdict: "insufficient_data",
    reason:
      "entry_context (zerodte/nighthawk ledgers) does not persist streak_days at commit — only the " +
      "live board's transient EnrichedZeroDteSetup carries it (board.ts:1250-1512), which is never " +
      "written to the graded ledger. Cannot bucket graded plays by whether the fade applied " +
      "(streak_days > 8) without instrumenting a commit-time pin first.",
  });

  // ── NH-R5: LIQUIDITY_TIE_BREAK_DOLLARS_PER_POINT ────────────────────────────────────────────
  table.push({
    constant: "LIQUIDITY_TIE_BREAK_DOLLARS_PER_POINT",
    file: "src/lib/zerodte/breakout-source.ts",
    pr: "NH-R5",
    n: 0,
    delta_pts: null,
    verdict: "insufficient_data",
    reason:
      "pickAtmZeroDteContract (breakout-source.ts) persists only the FINAL contract (strike/expiry/" +
      "dte) + used_1dte_fallback onto entry_context — it does not pin whether the liquidity-quality " +
      "tie-break term actually flipped the winner (distance-only pick vs effectiveDist pick differ). " +
      "Cannot isolate the tie-break's effect on outcomes without a persisted per-play boolean.",
  });

  // ── NH-R9: CONTESTED_MIN_MAGNITUDE ──────────────────────────────────────────────────────────
  const contestedLine = report.blocked_value.find((l) => l.gate_failed === "cortex_contested") ?? null;
  const contestedResult = contestedGateVerdict({
    blockedLine: contestedLine,
    baseline,
    lowNThreshold: LOW_N_THRESHOLD,
    minBlockN: ENFORCE_MIN_BLOCK_N,
    minDeltaPts: ENFORCE_MIN_DELTA_PTS,
  });
  table.push({
    constant: "CONTESTED_MIN_MAGNITUDE",
    file: "src/lib/nighthawk/cortex/compose.ts",
    pr: "NH-R9",
    n: contestedLine?.n ?? 0,
    delta_pts:
      contestedLine?.would_have_won_rate_pct != null && baseline.win_rate_pct != null
        ? Math.round((baseline.win_rate_pct - contestedLine.would_have_won_rate_pct) * 10) / 10
        : null,
    verdict: contestedResult.verdict,
    reason: contestedResult.reason,
  });

  // ── NH-R11: FAMILY_SUPPORT_CAPS["dealer-positioning"] ───────────────────────────────────────
  const saturated = [];
  const unsaturated = [];
  let noRead = 0;
  for (const r of graded) {
    const cortex = r.entry_context?.cortex ?? null;
    const sum = dealerFamilySupportSum(cortex, CORTEX_SOURCE_FAMILY);
    const bucket = familyCapBucket(sum, DEALER_CAP);
    if (bucket === "saturated") saturated.push(r);
    else if (bucket === "unsaturated") unsaturated.push(r);
    else noRead += 1;
  }
  const satBucket = bucketOf("family_cap_saturated", saturated);
  const unsatBucket = bucketOf("family_cap_unsaturated", unsaturated);
  let familyVerdict;
  let familyReason;
  if (satBucket.n < ENFORCE_MIN_BLOCK_N || unsatBucket.low_n) {
    familyVerdict = "insufficient_data";
    familyReason =
      satBucket.n < ENFORCE_MIN_BLOCK_N
        ? `family-cap-saturated bucket has n=${satBucket.n} graded plays — graduation requires n>=${ENFORCE_MIN_BLOCK_N}.`
        : `family-cap-unsaturated bucket has n=${unsatBucket.n} (< ${LOW_N_THRESHOLD}) — no baseline to compare against.`;
  } else {
    const delta =
      satBucket.win_rate_pct != null && unsatBucket.win_rate_pct != null
        ? satBucket.win_rate_pct - unsatBucket.win_rate_pct
        : null;
    if (delta != null && delta <= -ENFORCE_MIN_DELTA_PTS) {
      familyVerdict = "enforce";
      familyReason = `saturated ${satBucket.win_rate_pct}% WR (n=${satBucket.n}) vs unsaturated ${unsatBucket.win_rate_pct}% (n=${unsatBucket.n}) — ${Math.round(-delta * 10) / 10} pts worse, confirming the cap is suppressing an over-stacked, genuinely weaker signal.`;
    } else {
      familyVerdict = "keep_calibrating";
      familyReason = `saturated ${satBucket.win_rate_pct}% WR (n=${satBucket.n}) vs unsaturated ${unsatBucket.win_rate_pct}% (n=${unsatBucket.n}) — delta does not clear the ${ENFORCE_MIN_DELTA_PTS}-pt bar either direction.`;
    }
  }
  table.push({
    constant: `FAMILY_SUPPORT_CAPS["dealer-positioning"] (cap=${DEALER_CAP})`,
    file: "src/lib/nighthawk/cortex/compose.ts",
    pr: "NH-R11",
    n: satBucket.n,
    delta_pts:
      satBucket.win_rate_pct != null && unsatBucket.win_rate_pct != null
        ? Math.round((satBucket.win_rate_pct - unsatBucket.win_rate_pct) * 10) / 10
        : null,
    verdict: familyVerdict,
    reason:
      `${familyReason} CAVEAT: entry_context.cortex.supports is POST-cap (compose.ts scales in place) — ` +
      `"saturated" (family sum >= cap) is a PROXY for "the cap fired", not the true pre-cap magnitude it ` +
      `suppressed. no_read=${noRead} rows had no usable Cortex support evidence.`,
  });

  const rendered = table.map((t) => ({ ...t, ...displayVerdict(t.verdict) }));

  if (JSON_OUT) {
    console.log(
      JSON.stringify(
        {
          window,
          db_configured: dbUp,
          db_error: dbError,
          total_rows: rows.length,
          graded_plays: graded.length,
          baseline: { n: baseline.n, win_rate_pct: baseline.win_rate_pct },
          rows: rendered,
        },
        null,
        2
      )
    );
    return rendered;
  }

  if (!QUIET) {
    console.log(`\nNIGHT HAWK CALIBRATION TABLE — NH-R6 (provisional NH-R5/R8/R9/R11 constants)`);
    console.log(`window ${since} -> ${through} (${DAYS}d)  |  db_configured=${dbUp}${dbError ? `  db_error=${dbError}` : ""}`);
    console.log(`total_rows=${rows.length}  graded_plays=${graded.length}  baseline_wr=${baseline.win_rate_pct ?? "n/a"}% (n=${baseline.n})\n`);
    console.log(`${"constant".padEnd(58)}${"pr".padEnd(8)}${"n".padStart(5)}${"delta".padStart(9)}  verdict`);
    console.log("-".repeat(100));
    for (const r of rendered) {
      console.log(
        r.constant.slice(0, 56).padEnd(58) +
          r.pr.padEnd(8) +
          String(r.n).padStart(5) +
          (r.delta_pts == null ? "—" : `${r.delta_pts}`).padStart(9) +
          `  ${r.label}`
      );
      console.log(`  ${r.reason}\n`);
    }
  }
  return rendered;
}

main()
  .then((rows) => {
    // Never fails the run — this is an evidence table, not a gate. Non-zero only on a hard crash.
    process.exit(0);
    return rows;
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
