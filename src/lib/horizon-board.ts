/**
 * Night Hawk — the unified three-board assembler (remodel: the surface the UI/API renders).
 *
 * Every lane — ZERO_DTE (from the proven 0DTE engine via zerodte/horizon-adapter), SWING and LEAPS (from
 * the generic scorer path, horizon-candidate → produceHorizonPlays) — lands as HorizonPlay[]. This module
 * composes the three lanes into ONE board payload: per-lane committed/watch splits, counts, the lane's
 * spec metadata (label, hold, exit primitive, floor + whether that floor is calibration-graduated), and the
 * board totals. It's the single object the three tabs render and the API returns — replacing the old
 * "Today's plays" / "Tonight's playbook" surfaces with 0DTE / Swing / LEAPS.
 *
 * PURE & deterministic — no IO. The route fetches each lane's plays (live 0DTE scan, whole-market Swing/
 * LEAPS discovery) and hands the assembled HorizonPlaySet here; this only shapes + labels it.
 */

import { HORIZONS, HORIZON_ORDER, type ExitPrimitive, type Horizon } from "./horizons";
import {
  committedPlays,
  watchPlays,
  type HorizonPlay,
  type HorizonPlaySet,
} from "./horizon-plays";
import { buildSwingSections, type SwingServingSections } from "./swing/serving";

/** One lane, ready to render: its spec metadata + the committed / watch splits and counts. */
export interface HorizonLaneBoard {
  horizon: Horizon;
  label: string;
  tag: string;
  holdLabel: string;
  exit: ExitPrimitive;
  scoreFloor: number;
  /** False = the floor is PROVISIONAL (not yet backed by graded evidence) — the UI should mark it. */
  scoreFloorGraduated: boolean;
  committed: HorizonPlay[];
  watch: HorizonPlay[];
  committedCount: number;
  watchCount: number;
  /** SWING-only: the seven serving sections (serving.ts) — the action-triage grouping the desk renders.
   *  ADDITIVE & OPTIONAL: populated ONLY for the SWING lane; 0DTE/LEAPS leave it undefined and keep their
   *  own committed/watch flow. `committed`/`watch` above stay as derived back-compat views on every lane. */
  sections?: SwingServingSections | null;
}

/** The whole three-board payload. */
export interface HorizonBoard {
  /** As-of ISO instant (caller-stamped — this module is pure, so it never reads the clock). */
  asOf: string;
  order: Horizon[];
  lanes: Record<Horizon, HorizonLaneBoard>;
  totalCommitted: number;
  totalWatch: number;
}

function laneBoard(set: HorizonPlaySet, horizon: Horizon): HorizonLaneBoard {
  const spec = HORIZONS[horizon];
  const committed = committedPlays(set, horizon);
  const watch = watchPlays(set, horizon);
  return {
    horizon,
    label: spec.label,
    tag: spec.tag,
    holdLabel: spec.holdLabel,
    exit: spec.exit,
    scoreFloor: spec.scoreFloor,
    scoreFloorGraduated: spec.scoreFloorGraduated,
    committed,
    watch,
    committedCount: committed.length,
    watchCount: watch.length,
    // The seven-section serving triage is a SWING-lane concept only — 0DTE (ratchet flow) and LEAPS
    // (thesis flow) leave `sections` undefined and keep their committed/watch split unchanged.
    sections: horizon === "SWING" ? buildSwingSections(set.SWING) : undefined,
  };
}

/**
 * Compose a full HorizonPlaySet from each lane's plays. Any lane omitted defaults to empty — the board
 * always presents all three lanes (the spine's always-three invariant), even before Swing/LEAPS go live.
 */
export function makePlaySet(parts: Partial<Record<Horizon, HorizonPlay[]>>): HorizonPlaySet {
  return {
    ZERO_DTE: parts.ZERO_DTE ?? [],
    SWING: parts.SWING ?? [],
    LEAPS: parts.LEAPS ?? [],
  };
}

/**
 * Scope an assembled board to a SINGLE horizon lane — the toggle model: when the desk shows only "Swings",
 * the payload carries only the SWING lane's plays. The other lanes stay PRESENT (metadata + zero counts) so
 * the toggle can still render all four chips; only their play arrays are emptied. Totals are recomputed to
 * the surviving lane. `null` returns the board unchanged (the all-lanes / legacy view).
 */
export function scopeBoardToHorizon(board: HorizonBoard, horizon: Horizon | null): HorizonBoard {
  if (horizon == null) return board;
  const lanes = { ...board.lanes };
  let totalCommitted = 0;
  let totalWatch = 0;
  for (const h of HORIZON_ORDER) {
    if (h === horizon) {
      totalCommitted += lanes[h].committedCount;
      totalWatch += lanes[h].watchCount;
    } else {
      // Zero the plays AND the serving sections on the de-selected lanes so a scoped Swing-off board
      // carries no stale swing triage (the toggle chip still renders from the surviving metadata).
      lanes[h] = { ...lanes[h], committed: [], watch: [], committedCount: 0, watchCount: 0, sections: null };
    }
  }
  return { ...board, lanes, totalCommitted, totalWatch };
}

/** Assemble the three-board payload from a composed play set. `asOf` is caller-stamped (keeps this pure). */
export function assembleHorizonBoard(set: HorizonPlaySet, asOf: string): HorizonBoard {
  const lanes = {
    ZERO_DTE: laneBoard(set, "ZERO_DTE"),
    SWING: laneBoard(set, "SWING"),
    LEAPS: laneBoard(set, "LEAPS"),
  } satisfies Record<Horizon, HorizonLaneBoard>;
  let totalCommitted = 0;
  let totalWatch = 0;
  for (const h of HORIZON_ORDER) {
    totalCommitted += lanes[h].committedCount;
    totalWatch += lanes[h].watchCount;
  }
  return { asOf, order: [...HORIZON_ORDER], lanes, totalCommitted, totalWatch };
}
