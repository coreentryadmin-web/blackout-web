#!/usr/bin/env node
/**
 * 0DTE gate-calibration LIVE report — runs the already-built, never-yet-exercised
 * evidence loop against real production data instead of leaving it dormant behind
 * an admin-only route nobody has scripted.
 *
 * WHAT ALREADY EXISTS (found during a 2026-08-29 audit pass, not built here):
 * - `zerodte_scan_rejections` persists EVERY hard-gate block (gates.ts) with a
 *   machine code, human sentence, and (once graded) a `counterfactual_json` cell.
 * - `src/lib/zerodte/skip-grading.ts` (`runSkipGrading`) counterfactually grades
 *   those rejections against REAL Polygon minute bars — same PLAN_RULES, same
 *   `gradePlanFromBars` walker as a committed play, so a blocked play and a
 *   committed one are graded under identical physics. It answers "what would
 *   have happened if this gate had NOT blocked it" — would_have_won /
 *   would_have_lost / ungradeable, never fabricated.
 * - `src/lib/zerodte/calibration.ts` (`buildZeroDteCalibrationReport`) aggregates
 *   graded rejections + committed rows into per-gate buckets, a Cortex-veto
 *   breakdown, tier-record inversions, origin/play-type/confluence bands, a
 *   forward holdout, and scale-out recommendations — i.e. it already answers
 *   "does this gate actually help" across the FULL pipeline, not gate-by-gate
 *   unit boundaries (gates.test.ts already covers those exhaustively — 125
 *   tests). This is the live, whole-pipeline complement: real historical market
 *   conditions replayed through the CURRENT gate/grading code, not synthetic
 *   fixtures.
 * - Both live behind `GET/POST /api/market/zerodte/calibration`
 *   (`requireAdminApi`-gated), and as of this run NOTHING in the committed audit
 *   toolkit had ever called either — the machinery was built, unit-tested, and
 *   never exercised end-to-end against production. This script closes that gap:
 *   it (1) triggers the bounded counterfactual grader over the max window so any
 *   backlog of ungraded rejections gets graded, then (2) pulls and prints the
 *   full calibration report in a readable form.
 *
 * NEVER GATES ANYTHING — same INTENTIONAL-DESIGN.md discipline as
 * cortex-oppose-magnitude-ab.mjs / veto-flicker-rate.mjs: this is evidence, not
 * a threshold changer. A gate-policy change (if any) is a separate, deliberate
 * follow-up once a real sample says so.
 *
 * Flags: --days=N (report window, default = server default) --skip-grade-days=N
 *   (counterfactual-grader window, default 14 = MAX_SKIP_GRADE_DAYS) --no-grade
 *   (skip the POST backfill, GET-only) --json --base=<url>
 */
import { mintClerkPremiumSession } from "./lib/prod-clerk-session.mjs";

function parseArgs(argv) {
  const args = { days: null, skipGradeDays: 14, grade: true, json: false, base: process.env.VALIDATE_BASE || "https://blackouttrades.com" };
  for (const a of argv) {
    if (a === "--json") args.json = true;
    else if (a === "--no-grade") args.grade = false;
    else if (a.startsWith("--days=")) args.days = Number(a.slice(7));
    else if (a.startsWith("--skip-grade-days=")) args.skipGradeDays = Number(a.slice(19));
    else if (a.startsWith("--base=")) args.base = a.slice(7);
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

function line(ch = "─", n = 78) {
  return ch.repeat(n);
}
function pct(n) {
  return n == null ? "n/a" : `${n >= 0 ? "" : ""}${n.toFixed(1)}%`;
}
function fmtBucket(label, b) {
  if (!b) return `    ${label.padEnd(28)}  (no data)`;
  const wr = b.win_rate_pct != null ? pct(b.win_rate_pct) : "n/a";
  const avg = b.avg_pnl_pct != null ? pct(b.avg_pnl_pct) : "n/a";
  const low = b.low_n ? "  [low_n]" : "";
  return `    ${label.padEnd(28)}  n=${String(b.n ?? 0).padStart(4)}  WR=${wr.padStart(7)}  avgPnl=${avg.padStart(8)}${low}`;
}

async function main() {
  let session;
  try {
    session = await mintClerkPremiumSession({ appUrl: args.base });
    if (session.skip) {
      console.log(`SKIP — ${session.reason ?? "Clerk credentials unavailable in this environment"}`);
      process.exitCode = 0;
      return;
    }
    const headers = { Cookie: session.cookieHeader, Accept: "application/json" };

    if (args.grade) {
      console.log(`[1] Backfilling counterfactual grades — POST ?grade_skips=1, window=${args.skipGradeDays}d…`);
      const gradeRes = await fetch(
        `${args.base}/api/market/zerodte/calibration?grade_skips=1`,
        { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ days: args.skipGradeDays }) }
      );
      const gradeJson = await gradeRes.json().catch(() => ({}));
      if (!gradeRes.ok || gradeJson.ok === false) {
        console.error(`    grade_skips FAILED (HTTP ${gradeRes.status}):`, JSON.stringify(gradeJson));
        process.exitCode = 1;
      } else {
        console.log(`    since=${gradeJson.since ?? "?"} scanned=${gradeJson.scanned ?? 0} graded=${gradeJson.graded ?? 0} ungradeable=${gradeJson.ungradeable ?? 0} errors=${gradeJson.errors ?? 0}`);
      }
    } else {
      console.log("[1] --no-grade — skipping the counterfactual backfill, reading whatever is already graded");
    }

    console.log(`\n[2] Fetching the calibration report${args.days ? ` (days=${args.days})` : " (server default window)"}…`);
    const q = args.days ? `?days=${args.days}` : "";
    const res = await fetch(`${args.base}/api/market/zerodte/calibration${q}`, { headers });
    const report = await res.json().catch(() => ({}));
    if (!res.ok || report.available === false) {
      console.error(`    calibration GET FAILED (HTTP ${res.status}):`, JSON.stringify(report).slice(0, 500));
      process.exitCode = 1;
      return;
    }

    if (args.json) {
      console.log("\n<<<JSON>>>");
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    console.log(`\n${line("═")}`);
    console.log("  0DTE GATE CALIBRATION — LIVE REPORT");
    console.log(line("═"));

    console.log(`\n  window: ${report.window?.since ?? "?"} .. ${report.window?.through ?? "?"} (${report.window?.days ?? "?"}d) — total_rows=${report.total_rows ?? "?"} graded_plays=${report.graded_plays ?? "?"}`);

    if (Array.isArray(report.gates) && report.gates.length) {
      console.log("\n  CALIBRATION-MODE GATES (would-block vs would-pass, pinned per committed row — G-4 VIX / G-6 conflict):");
      for (const g of report.gates) {
        console.log(`\n  ${g.gate}  [${g.verdict}]`);
        console.log(fmtBucket("would_block", g.evidence?.would_block));
        console.log(fmtBucket("would_pass", g.evidence?.would_pass));
        if (g.evidence?.reason) console.log(`    reason: ${g.evidence.reason}`);
      }
    }

    if (Array.isArray(report.score_bands) && report.score_bands.length) {
      console.log(`\n${line()}`);
      console.log("  SCORE BANDS (committed, graded rows)");
      console.log(line());
      for (const b of report.score_bands) console.log(fmtBucket(b.label, b));
    }

    if (Array.isArray(report.origin_bands) && report.origin_bands.length) {
      console.log(`\n${line()}`);
      console.log("  ORIGIN BANDS (FLOW/BREAKOUT/PIN + combos)");
      console.log(line());
      for (const b of report.origin_bands) console.log(fmtBucket(b.label, b));
    }

    if (Array.isArray(report.play_type_bands) && report.play_type_bands.length) {
      console.log(`\n${line()}`);
      console.log("  PLAY-TYPE BANDS (DIRECTIONAL/CONDOR)");
      console.log(line());
      for (const b of report.play_type_bands) console.log(fmtBucket(b.label, b));
    }

    if (report.tier_record) {
      console.log(`\n${line()}`);
      console.log("  TIER RECORD (A/B/C/untiered, committed rows)");
      console.log(line());
      for (const b of report.tier_record.tiers ?? []) console.log(fmtBucket(`tier ${b.tier}`, b));
      console.log(`    untiered_n=${report.tier_record.untiered_n} tier_inversion=${report.tier_record.tier_inversion}`);
      if (report.tier_record.inversions?.length) {
        console.log(`    INVERSIONS (lower tier outperforming a higher one):`);
        for (const inv of report.tier_record.inversions) console.log(`      ${JSON.stringify(inv)}`);
      }
      if (report.tier_record.aplus) console.log(`    A+ : ${JSON.stringify(report.tier_record.aplus)}`);
    }

    if (report.cortex_veto_analysis) {
      console.log(`\n${line()}`);
      console.log("  CORTEX VETO BREAKDOWN (counterfactual false-veto rate per source)");
      console.log(line());
      for (const c of report.cortex_veto_analysis.cells ?? []) {
        console.log(`    ${(c.source ?? "?").padEnd(20)}  veto_count=${c.veto_count}  ungradeable=${c.ungradeable}  would_have_won=${c.would_have_won}  rate=${c.would_have_won_rate_pct ?? "n/a"}${c.low_n ? "  [low_n]" : ""}`);
      }
      console.log(`    total_veto_rejections=${report.cortex_veto_analysis.total_veto_rejections}`);
    }

    if (Array.isArray(report.blocked_value) && report.blocked_value.length) {
      console.log(`\n${line()}`);
      console.log("  BLOCKED-VALUE LINES (per hard-gate code, counterfactually graded)");
      console.log(line());
      for (const l of report.blocked_value) {
        console.log(`\n    ${l.gate_failed.padEnd(24)}  graded=${l.n}  ungradeable=${l.ungradeable}  would_have_won=${l.would_have_won}  rate=${l.would_have_won_rate_pct ?? "n/a"}${l.low_n ? "  [low_n]" : ""}`);
        if (l.ungradeable_reasons?.length) {
          for (const r of l.ungradeable_reasons) console.log(`        ungradeable (${r.n}x): ${r.reason}`);
        }
      }
    }

    if (Array.isArray(report.signal_recommendations) && report.signal_recommendations.length) {
      console.log(`\n${line()}`);
      console.log("  SIGNAL RECOMMENDATIONS (confluence_double, accumulation_aligned, ...)");
      console.log(line());
      for (const s of report.signal_recommendations) {
        console.log(`\n  ${s.signal}  [${s.verdict}]`);
        console.log(fmtBucket("signal_on", s.evidence?.signal_on));
        console.log(fmtBucket("signal_off", s.evidence?.signal_off));
      }
    }

    if (report.scale_out_recommendation) {
      console.log(`\n${line()}`);
      console.log("  SCALE-OUT RECOMMENDATION");
      console.log(line());
      console.log(`    [${report.scale_out_recommendation.verdict}] ${report.scale_out_recommendation.evidence?.reason ?? ""}`);
    }

    console.log(`\n${line("═")}`);
    console.log("  Read-only measurement. No gate/threshold was changed by this run.");
    console.log(line("═"));
  } finally {
    await session?.cleanup?.();
  }
}

main().catch((err) => {
  console.error("gate-calibration-live-report FAILED:", err?.stack ?? err);
  process.exitCode = 1;
});
