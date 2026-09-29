#!/usr/bin/env node
/**
 * SWING MULTI-TRUTH GRADE RETRACE — closes the "retrace vs the 5-truth grader,
 * OUTCOME-GRADING-SPEC.md" bullet by actually calling the new admin route
 * (`GET /api/admin/swing/multi-truth-grade`) this lane built for it (#4076, comment 5751117208).
 *
 * WHAT IT MEASURES. Pulls every closed/rolled swing position in the window, each already re-graded
 * server-side by the REAL `swing/grade.ts` `gradeSwingPosition` against real Polygon forward
 * underlying bars (PATH + THESIS only this pass — see grade-retrace.ts's header for why EXECUTION/
 * FINANCIAL/MANAGEMENT stay honestly ungradeable here), and reports:
 *   - gradeable rate per truth family (PATH/THESIS — the two this pass populates)
 *   - THESIS outcome distribution (CONFIRMED/INVALIDATED/OPEN)
 *   - DIVERGENCES: a row where the THESIS truth disagrees with the sign of the markfreeze realized
 *     P&L members actually saw (THESIS INVALIDATED but realized P&L >= 0, or THESIS CONFIRMED but
 *     realized P&L <= 0) — genuinely interesting rows (a stop saved a broken thesis, or a confirmed
 *     thesis still lost money on exit timing), not proof of a bug by itself.
 *
 * Read-only against the new route (which is itself read-only — no writes to swing_positions).
 *
 * USAGE
 *   node --import tsx scripts/audit/swing-multi-truth-grade-retrace.mjs [--days=90] [--base=https://blackouttrades.com] [--json]
 */
import { fetchAuditJson, releaseAuditClerkSession } from "./lib/audit-auth-fetch.mjs";

const args = process.argv.slice(2);
const flag = (name, def) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=").slice(1).join("=") : def;
};
const days = Number(flag("days", "90"));
const base = flag("base", "https://blackouttrades.com");
const asJson = args.includes("--json");

function pct(n, d) {
  return d === 0 ? "n/a" : `${((n / d) * 100).toFixed(1)}%`;
}

async function main() {
  const res = await fetchAuditJson(base, `/api/admin/swing/multi-truth-grade?days=${days}`);
  if (!res.ok) {
    console.error("FETCH FAILED", res.status, JSON.stringify(res.json).slice(0, 500));
    process.exitCode = 1;
    return;
  }
  const rows = res.json?.rows ?? [];
  const total = rows.length;

  let pathGradeable = 0;
  let thesisGradeable = 0;
  const thesisOutcomes = { CONFIRMED: 0, INVALIDATED: 0, OPEN: 0, ungradeable: 0 };
  const divergences = [];

  for (const row of rows) {
    const g = row.multiTruthGrade;
    if (!g) continue;
    if (g.path?.gradeable) pathGradeable++;
    if (g.thesis?.gradeable) {
      thesisGradeable++;
      thesisOutcomes[g.thesis.outcome] = (thesisOutcomes[g.thesis.outcome] ?? 0) + 1;
      const pnl = row.markfreezeRealizedPnlPct;
      if (typeof pnl === "number") {
        if (g.thesis.outcome === "INVALIDATED" && pnl >= 0) {
          divergences.push({ ticker: row.ticker, positionId: row.positionId, kind: "INVALIDATED_but_pnl_nonneg", pnl });
        } else if (g.thesis.outcome === "CONFIRMED" && pnl <= 0) {
          divergences.push({ ticker: row.ticker, positionId: row.positionId, kind: "CONFIRMED_but_pnl_nonpos", pnl });
        }
      }
    } else {
      thesisOutcomes.ungradeable++;
    }
  }

  const summary = {
    since: res.json?.since,
    through: res.json?.through,
    days,
    totalRows: total,
    pathGradeableRate: pct(pathGradeable, total),
    thesisGradeableRate: pct(thesisGradeable, total),
    thesisOutcomes,
    divergenceCount: divergences.length,
    divergences,
  };

  if (asJson) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(`SWING MULTI-TRUTH GRADE RETRACE — ${summary.since} .. ${summary.through} (${days}d), n=${total}`);
    console.log(`  PATH gradeable:   ${pathGradeable}/${total} (${summary.pathGradeableRate})`);
    console.log(`  THESIS gradeable: ${thesisGradeable}/${total} (${summary.thesisGradeableRate})`);
    console.log(`  THESIS outcomes:  CONFIRMED=${thesisOutcomes.CONFIRMED} INVALIDATED=${thesisOutcomes.INVALIDATED} OPEN=${thesisOutcomes.OPEN} ungradeable=${thesisOutcomes.ungradeable}`);
    console.log(`  Divergences (THESIS vs markfreeze P&L sign): ${divergences.length}`);
    for (const d of divergences.slice(0, 20)) {
      console.log(`    ${d.ticker} #${d.positionId}: ${d.kind} (markfreeze P&L ${d.pnl}%)`);
    }
  }
}

main()
  .catch((err) => {
    console.error("ERROR", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await releaseAuditClerkSession();
  });
