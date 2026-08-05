/**
 * src/lib/horizon-outcomes.ts — the unified cross-lane OUTCOMES read layer (backlog item #29).
 *
 * WHAT THIS IS NOT: a new grading engine, a new win/loss column, or a migration. 0DTE
 * (docs/audit/OUTCOME-GRADING-SPEC.md) and Swing (docs/audit/SWING-ENGINE.md §4,
 * src/lib/swing/grade.ts) each grade with deliberately PLURAL methodologies — 0DTE reports
 * AS-MANAGED vs MECHANICAL side by side, Swing reports FIVE independent truth families
 * (EXECUTION/PATH/THESIS/MANAGEMENT/FINANCIAL) and explicitly never blends them into one
 * number. A single flattened win/loss ledger across lanes would erase exactly that
 * information — a thesis can be CONFIRMED while the financial truth is a scratch on a bad
 * fill, and collapsing that to one boolean is a lossy, dishonest simplification of what the
 * lane actually knows. So this module does NOT invent a fourth grading methodology; it reads
 * each lane's EXISTING canonical grader through its EXISTING fetch function and republishes
 * ONE typed record per graded row for reporting/dashboard use — a read-only VIEW, exactly the
 * precedent `horizon-board.ts` already set for the live board (each lane's reader independently
 * fetches into a shared `HorizonPlay[]` output type, unioned at request time — no shared table).
 *
 * PER-LANE MAPPING:
 *   ZERO_DTE — truth_kind "official". Reuses `fetchZeroDteSetupLogRange` (db.ts) exactly as
 *     `/api/market/zerodte/record` does, and `record.ts`'s `isZeroDteWin` / `officialPlanPnlPct`
 *     — the SAME predicate shared with feature-store.ts (post the outcome-grading-audit fix) and
 *     the canonical member-facing win/loss (WS-10/WS-11 executable-preferred, mid fallback).
 *   SWING — truth_kind "financial". Reuses `fetchSwingPositionsRange` (db.ts) and
 *     `swing/record.ts`'s `isSwingWin`, keyed on the row's frozen `realized_pnl_pct` column — the
 *     SAME number swing/record.ts's per-leg grade and composite already key on. This is
 *     deliberately NOT a read of `grade_json.financial.*`: a roll-time PARENT leg is frozen via
 *     the markfreeze path (`roll-plan.ts` `gradeParentFromMark`, `grade_methodology:
 *     "swing.roll.markfreeze.v1"`), whose `grade_json` does NOT carry the five-family
 *     `SwingGrade` shape (`{v, subLane, direction, ..., financial: {...}}`) the EOD multi-truth
 *     grader (`gradeSwingPosition`/PR-8) writes — only a flat `{methodology, basis, entry_premium,
 *     exit_mark, realized_pnl_pct, note}`. Reading `grade_json.financial.scaleOutRealizedMult`
 *     unconditionally would silently drop every roll-frozen leg from this report. `realized_pnl_pct`
 *     is the one column BOTH grading paths always populate, is the exact input `isSwingWin` grades
 *     on, and is what the composite/roll-chain machinery already trusts as "the financial truth" —
 *     so it is the closest real win/loss analog without fabricating structure that isn't there.
 *   LEAPS — always `[]`. No persistence, no grading, no live board presence yet (confirmed: only a
 *     pure scoring function `src/lib/leaps-signals.ts` and a type-system slot in `horizons.ts`'s
 *     `Horizon` union — no `leaps_positions` table, no grader). This is a deliberate placeholder
 *     slot, not an oversight: when LEAPS ships persistence + a grader, this branch gets a real
 *     fetch the same way SWING has one today.
 *
 * PURE aggregation over already-fetched rows would be nicer for testing, but the two lanes'
 * fetch shapes differ enough (date-range vs date-range) that the whole function is the natural
 * unit; the per-row MAPPERS below are exported separately so their logic is unit-testable without
 * a live DB (see horizon-outcomes.test.ts).
 */

import {
  fetchZeroDteSetupLogRange,
  fetchSwingPositionsRange,
  type ZeroDteSetupLogRow,
  type SwingPositionRow,
} from "@/lib/db";
import { isGradedZeroDteRow, isZeroDteWin, officialPlanPnlPct } from "@/lib/zerodte/record";
import { isSwingWin } from "@/lib/swing/record";
import type { Horizon } from "@/lib/horizons";

export type UnifiedHorizonOutcomeLabel = "win" | "loss" | "breakeven" | null;

export interface UnifiedHorizonOutcome {
  lane: Horizon;
  /** Row identity within its own lane's table — 0DTE has no numeric PK, so its natural key is
   *  `session_date:ticker` (zerodte_setup_log's PK, db.ts:5367); Swing uses its numeric `id`. */
  source_id: string;
  ticker: string;
  /** Which grading methodology this record's label/pnl came from — see the file header mapping. */
  truth_kind: "official" | "financial";
  label: UnifiedHorizonOutcomeLabel;
  pnl_pct: number | null;
  graded_at: string | null;
}

/** Map ONE zerodte_setup_log row to its unified outcome. Exported for unit testing without a DB. */
export function mapZeroDteOutcome(row: ZeroDteSetupLogRow): UnifiedHorizonOutcome {
  const graded = isGradedZeroDteRow(row);
  const pnl = graded ? officialPlanPnlPct(row) : null;
  const label: UnifiedHorizonOutcomeLabel = !graded || pnl == null ? null : pnl === 0 ? "breakeven" : isZeroDteWin(row) ? "win" : "loss";
  return {
    lane: "ZERO_DTE",
    source_id: `${row.session_date}:${row.ticker}`,
    ticker: row.ticker,
    truth_kind: "official",
    label,
    pnl_pct: pnl != null ? Math.round(pnl * 100) / 100 : null,
    graded_at: row.graded_at,
  };
}

/** Map ONE swing_positions row to its unified outcome. Exported for unit testing without a DB.
 *  See the file-header note on why this reads `realized_pnl_pct` rather than `grade_json.financial`. */
export function mapSwingOutcome(row: SwingPositionRow): UnifiedHorizonOutcome {
  const graded = row.graded_at != null && row.realized_pnl_pct != null && Number.isFinite(row.realized_pnl_pct);
  const pnl = graded ? (row.realized_pnl_pct as number) : null;
  const label: UnifiedHorizonOutcomeLabel = !graded || pnl == null ? null : pnl === 0 ? "breakeven" : isSwingWin(pnl) ? "win" : "loss";
  return {
    lane: "SWING",
    source_id: String(row.id),
    ticker: row.ticker,
    truth_kind: "financial",
    label,
    pnl_pct: pnl != null ? Math.round(pnl * 100) / 100 : null,
    graded_at: row.graded_at,
  };
}

export interface FetchUnifiedHorizonOutcomesOpts {
  /** Lookback window in days (ET calendar, same convention as /api/market/zerodte/record). */
  days: number;
  /** Restrict to one lane; omit for all three. */
  lane?: Horizon;
  /** Injectable fetchers — defaults to the real db.ts functions. Overridable so this function is
   *  unit-testable with fixture rows and no live DB (same DI shape as roll-plan.ts's SwingRollPlanDeps),
   *  without relying on --experimental-test-module-mocks over the (heavy, pool-creating) db.ts module. */
  deps?: {
    fetchZeroDteSetupLogRange?: typeof fetchZeroDteSetupLogRange;
    fetchSwingPositionsRange?: typeof fetchSwingPositionsRange;
  };
}

const MAX_ROWS = 2000;

function etYmd(ms: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(ms));
}

/**
 * Fetch + map every graded (and ungraded — callers filter by `label != null` if they want
 * graded-only) row across the requested lane(s) into the unified shape. READ-ONLY: no writes,
 * no new tables, no migration — every number here is already computed by the lane's own
 * canonical grader; this only republishes it under one type for cross-lane reporting.
 */
export async function fetchUnifiedHorizonOutcomes(
  opts: FetchUnifiedHorizonOutcomesOpts
): Promise<UnifiedHorizonOutcome[]> {
  const days = Math.max(1, Math.min(90, Math.floor(opts.days)));
  const since = etYmd(Date.now() - days * 24 * 60 * 60 * 1000);
  const limit = Math.min(MAX_ROWS, days * 20);
  const wantLane = opts.lane;
  const fetchZeroDte = opts.deps?.fetchZeroDteSetupLogRange ?? fetchZeroDteSetupLogRange;
  const fetchSwing = opts.deps?.fetchSwingPositionsRange ?? fetchSwingPositionsRange;

  const out: UnifiedHorizonOutcome[] = [];

  if (wantLane == null || wantLane === "ZERO_DTE") {
    const rows = await fetchZeroDte(since, limit);
    for (const row of rows) out.push(mapZeroDteOutcome(row));
  }

  if (wantLane == null || wantLane === "SWING") {
    const rows = await fetchSwing(since, limit);
    for (const row of rows) out.push(mapSwingOutcome(row));
  }

  // LEAPS: deliberate empty placeholder — no persistence, no grading, no live board presence yet
  // (only a pure scorer, src/lib/leaps-signals.ts, and a type slot in horizons.ts). See file header.
  // (wantLane === "LEAPS" also falls through to the empty result — nothing to fetch.)

  return out;
}
