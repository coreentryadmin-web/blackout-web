/**
 * HORIZON OUTCOMES REPORT — the unified cross-lane read layer (backlog item #29), CLI form.
 * ================================================================================================
 *
 * Prints a per-lane summary (n graded, win rate where a win/loss label applies, date range) over
 * `fetchUnifiedHorizonOutcomes` (src/lib/horizon-outcomes.ts) — the SAME pure per-row mappers the
 * admin route (`/api/admin/nighthawk/horizon-outcomes`) serves, reused verbatim, not reimplemented.
 * Talks to the DB directly via db.ts (same convention as nighthawk-calibration-table.mjs — no
 * Clerk/HTTP auth needed for a read-only reporting script with DATABASE_URL already in env).
 *
 * WHY BOTH A SCRIPT AND A ROUTE EXIST for the same core function (see the PR write-up for the full
 * reasoning): this repo's audit toolkit is CLI-first (every entry in CLAUDE.md's "Audit toolkit"
 * section is a `scripts/audit/*.mjs` invoked ad hoc or from a scheduled trigger), while the admin
 * route exists for the live ops dashboard the same way `admin/nighthawk/analytics` does. Building
 * both is cheap because the core aggregation/mapping logic lives in ONE place
 * (src/lib/horizon-outcomes.ts) — this script and the route are both thin consumers of it.
 *
 * USAGE
 *   node --import tsx scripts/audit/horizon-outcomes-report.mjs [--days=30] [--lane=ZERO_DTE|SWING|LEAPS] [--json] [--quiet]
 *
 * Secrets from env only (DATABASE_URL). Self-defaults POLYGON_API_BASE for parity with the rest of
 * the toolkit (unused here — no Polygon calls). Read-only: only SELECTs via db.ts's existing
 * fetchZeroDteSetupLogRange / fetchSwingPositionsRange. Never prints secrets.
 */

if (!process.env.POLYGON_API_BASE || !/^https?:\/\//.test(process.env.POLYGON_API_BASE)) {
  process.env.POLYGON_API_BASE = "https://api.massive.com";
}

const { fetchUnifiedHorizonOutcomes } = await import("../../src/lib/horizon-outcomes.ts");

const arg = (name, dflt) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};
const flag = (name) => process.argv.includes(`--${name}`);

const DAYS = Math.max(1, Math.min(90, Number(arg("days", "30")) || 30));
const LANE_ARG = arg("lane", null);
const VALID_LANES = new Set(["ZERO_DTE", "SWING", "LEAPS"]);
const LANE = LANE_ARG != null && VALID_LANES.has(LANE_ARG) ? LANE_ARG : undefined;
const JSON_OUT = flag("json");
const QUIET = flag("quiet");

function summarize(lane, outcomes) {
  const rows = outcomes.filter((o) => o.lane === lane);
  const graded = rows.filter((o) => o.label != null);
  const wins = graded.filter((o) => o.label === "win").length;
  const losses = graded.filter((o) => o.label === "loss").length;
  const breakeven = graded.filter((o) => o.label === "breakeven").length;
  const gradedAts = graded.map((o) => o.graded_at).filter((d) => d != null).sort();
  const winRatePct = graded.length > 0 ? Math.round((wins / graded.length) * 1000) / 10 : null;
  return {
    lane,
    n_total: rows.length,
    n_graded: graded.length,
    wins,
    losses,
    breakeven,
    win_rate_pct: winRatePct,
    truth_kind: rows[0]?.truth_kind ?? (lane === "LEAPS" ? "n/a" : null),
    date_range: gradedAts.length ? { from: gradedAts[0], through: gradedAts[gradedAts.length - 1] } : null,
  };
}

async function main() {
  const db = await import("../../src/lib/db.ts");
  const dbUp = db.dbConfigured();

  let outcomes = [];
  let dbError = null;
  if (dbUp) {
    try {
      outcomes = await fetchUnifiedHorizonOutcomes({ days: DAYS, lane: LANE });
    } catch (e) {
      dbError = String(e?.message ?? e);
    }
  }

  const lanes = LANE ? [LANE] : ["ZERO_DTE", "SWING", "LEAPS"];
  const summaries = lanes.map((lane) => summarize(lane, outcomes));

  if (JSON_OUT) {
    console.log(JSON.stringify({ days: DAYS, lane: LANE ?? null, db_configured: dbUp, db_error: dbError, lanes: summaries }, null, 2));
    return summaries;
  }

  if (!QUIET) {
    console.log(`\nHORIZON OUTCOMES REPORT — backlog #29 (unified cross-lane read layer)`);
    console.log(`window: last ${DAYS}d  |  db_configured=${dbUp}${dbError ? `  db_error=${dbError}` : ""}\n`);
    console.log(
      `${"lane".padEnd(10)}${"truth_kind".padEnd(12)}${"n_total".padStart(9)}${"n_graded".padStart(10)}${"wins".padStart(7)}${"losses".padStart(8)}${"breakeven".padStart(11)}${"win_rate".padStart(10)}`
    );
    console.log("-".repeat(80));
    for (const s of summaries) {
      console.log(
        s.lane.padEnd(10) +
          String(s.truth_kind).padEnd(12) +
          String(s.n_total).padStart(9) +
          String(s.n_graded).padStart(10) +
          String(s.wins).padStart(7) +
          String(s.losses).padStart(8) +
          String(s.breakeven).padStart(11) +
          (s.win_rate_pct == null ? "n/a" : `${s.win_rate_pct}%`).padStart(10)
      );
      if (s.date_range) console.log(`  graded ${s.date_range.from} .. ${s.date_range.through}`);
      if (s.lane === "LEAPS") console.log(`  (deliberate placeholder — no LEAPS persistence/grading yet)`);
    }
    console.log();
  }
  return summaries;
}

main()
  .then(() => {
    // Evidence report, not a gate — non-zero only on a hard crash.
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
