// src/lib/swing/grade-retrace.ts — maps a closed/rolled `swing_positions` row + fetched forward
// UNDERLYING bars into a `SwingGradeInput` for the real multi-truth grader (`grade.ts`'s
// `gradeSwingPosition`). Exists because that grader has ZERO production call sites (verified
// against `main` 2026-09-20: `grep -rln "gradeSwingPosition" src/` only finds `db.ts`'s unrelated
// markfreeze-write function of the same name, `grade.ts` itself, and its own tests) — every closed
// swing position members see is graded ONLY by `gradeParentFromMark`'s single point-in-time
// realized-P&L freeze (roll-plan.ts). That number can't show what the 5-truth grader can: whether
// the underlying THESIS actually confirmed/invalidated, or how much of the real MFE/MAE the exit
// captured. See #4076 (comment 5751117208) for the fuller writeup.
//
// SCOPE (deliberately narrow this pass): only PATH + THESIS are populated — both gradeable from
// UNDERLYING bars alone, which this repo already fetches in production (`fetchStockDailyBars`).
// EXECUTION stays honestly ungradeable (`no_fill` — no real fill price is ever recorded, same as
// every other execution-truth caller in this codebase). FINANCIAL/MANAGEMENT stay honestly
// ungradeable too (`optionBars: []` → `gradeBangerScaleOut`'s own `no_forward_bars` reason) because
// fetching historical OPTION bars per position (OCC resolution, Polygon options aggregates) is a
// materially larger, higher-risk lift with no existing production helper to reuse — a real follow-up,
// not silently skipped.

import type { SwingPositionRow } from "../db";
import type { SwingGradeInput, UnderlyingBar } from "./grade";
import { SWING_ARCHETYPES, type SwingArchetype, type SwingSubLane } from "./taxonomy";

const SWING_SUB_LANE_VALUES: ReadonlySet<string> = new Set<SwingSubLane>(["TACTICAL", "STANDARD", "EXTENDED"]);
const SWING_ARCHETYPE_VALUES: ReadonlySet<string> = new Set(SWING_ARCHETYPES);

/** Validated cast — an unrecognized/legacy `sub_lane` string degrades to null (grade.ts's own
 *  documented fallback: coarsest "day" timeframe) rather than crashing or silently mis-casting. */
export function swingSubLaneFromRow(row: Pick<SwingPositionRow, "sub_lane">): SwingSubLane | null {
  return SWING_SUB_LANE_VALUES.has(row.sub_lane) ? (row.sub_lane as SwingSubLane) : null;
}

/** Validated cast — mirrors `swingSubLaneFromRow`; an unrecognized/legacy archetype degrades to
 *  null (echoed on the thesis truth, never gates the walk). */
export function swingArchetypeFromRow(row: Pick<SwingPositionRow, "archetype">): SwingArchetype | null {
  return row.archetype != null && SWING_ARCHETYPE_VALUES.has(row.archetype) ? (row.archetype as SwingArchetype) : null;
}

export function swingRowToGradeInput(row: SwingPositionRow, underlyingBars: UnderlyingBar[]): SwingGradeInput {
  return {
    subLane: swingSubLaneFromRow(row),
    direction: row.direction === "short" ? "SHORT" : "LONG",
    archetype: swingArchetypeFromRow(row),
    plannedEntryPx: row.entry_underlying_px,
    // No real fill price is ever recorded on this ledger — EXECUTION stays honestly ungradeable.
    actualEntryPx: null,
    thesisInvalidationPx: row.thesis_invalidation_px,
    targetUnderlyingPx: row.target_underlying_px,
    underlyingBars,
    entryPremium: row.entry_premium,
    // Not fetched this pass (see file header) — FINANCIAL/MANAGEMENT stay honestly ungradeable.
    optionBars: [],
    expiryYmd: row.contract_expiry,
  };
}

/** Window to fetch forward underlying bars over: [committed_at, closed_at], each widened one
 *  calendar day so the entry/exit session's own bar is never excluded by an exact-timestamp edge.
 *  Falls back to `session_date` when `committed_at`/`closed_at` are absent (older rows / a leg
 *  graded before those columns were consistently stamped) so a real closed position never reads
 *  as unfetchable purely for missing a timestamp its P&L freeze didn't need. */
export function swingBarWindow(row: SwingPositionRow): { from: string; to: string } | null {
  const ymd = (iso: string | null): string | null => (iso ? iso.slice(0, 10) : null);
  const fallback = row.session_date ? row.session_date.slice(0, 10) : null;
  const fromRaw = ymd(row.committed_at) ?? fallback;
  const toRaw = ymd(row.closed_at) ?? fallback;
  if (!fromRaw || !toRaw) return null;
  const from = new Date(`${fromRaw}T00:00:00Z`);
  const to = new Date(`${toRaw}T00:00:00Z`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;
  from.setUTCDate(from.getUTCDate() - 1);
  to.setUTCDate(to.getUTCDate() + 1);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

/**
 * Normalize whatever a failed forward-bar fetch throws into a safe, loggable string.
 *
 * BUG FIX (Ask Largo standing mandate, 2026-11-08): `multi-truth-grade/route.ts` used to catch a
 * failed `fetchStockDailyBars` call with a bare `.catch(() => [])`, collapsing a rate-limited/
 * circuit-open Polygon fetch failure into the exact same empty array a GENUINE "no bars for this
 * window" result would produce — `multiTruthGrade.path.reason: "no_forward_bars"` then reads as a
 * confident absence claim with no hint the real cause was a self-inflicted 429, violating this
 * repo's own absence-honesty principle (LARGO-PRODUCT-CONTRACT.md). Live repro: a batch of 10
 * concurrent distinct-ticker `fetchStockDailyBars` calls — this route's own un-mitigated
 * concurrency — is enough on its own to trip 5+ consecutive Polygon 429s and open
 * `polygon-rate-limiter.ts`'s shared circuit breaker; three fresh real calls to
 * `GET /api/admin/swing/multi-truth-grade?days=90` each showed only 3/64 (4.7%) PATH-gradeable,
 * even though every underlying bar window has real, fetchable Polygon data (verified directly:
 * MSTR 2026-11-03..06 returns 4 real bars with no batching involved). This helper is the small,
 * pure piece of the fix: route.ts now carries the real error through as `barsFetchError` instead
 * of swallowing it, so a caller can tell "no data to grade" apart from "the fetch failed — retry."
 */
export function barFetchErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
