// src/lib/swing/active-refresh.ts — the held-position refresh loop for the swing-active-refresh cron (PR-13).
//
// WHY (docs/audit/SWING-ENGINE.md §4 PR-13): once positions persist, the desk needs their live path recorded
// on a heartbeat — hourly, this loop reads every OPEN swing position, gathers fresh marks, APPENDS a snapshot
// to its longitudinal series, and runs the PR-7 manager (via manage-sync) to latch live state. That snapshot
// series is what the multi-truth grader (PR-8) and the trajectory studies (PR-14) later consume.
//
// INVARIANTS (evidence-only / HOLD):
//   • NEVER-COMMIT — this loop only refreshes EXISTING positions; it has no path to `insertSwingPosition`.
//     Opening a position is discovery/commit (not authorized in this lane yet); rolling is PR-15.
//   • APPEND-ONLY — one snapshot per position per refresh via `insertSwingSnapshot` (an INSERT, never upsert).
//   • FAIL-SOFT — a bad read or DB error on one position is caught and tallied; it never aborts the loop or
//     throws out of the cron. A whole-fetch failure degrades to an empty working set, not an exception.
//
// SHAPE: `runSwingActiveRefresh` is a thin IO shell — the working set, the per-position live reads, and the
// ledger writes are all INJECTED, so the loop's control flow (append-then-latch, per-position isolation, the
// eod snapshot kind) is unit-testable with fakes and no live DB/providers.

import type { SwingPositionRow } from "../db";
import {
  syncSwingManagement,
  type ManageSyncDeps,
  type ManageSyncOutcome,
  type ManageSyncReads,
} from "./manage-sync";

/** The default snapshot kind the hourly refresh appends. The end-of-day settle uses the same `eod` kind — the
 *  snapshot's timestamp distinguishes them; the grader keys off the ordered series, not per-tick labels. */
export const DEFAULT_ACTIVE_REFRESH_SNAPSHOT_KIND = "eod";

export interface ActiveRefreshDeps extends ManageSyncDeps {
  /** The live working set — every non-terminal position (db.fetchOpenSwingPositions). */
  fetchOpen: () => Promise<SwingPositionRow[]>;
  /** Per-position fresh reads (mark/underlying/DTE/…). Null → the position is skipped this tick (no snapshot). */
  loadReads: (row: SwingPositionRow) => Promise<ManageSyncReads | null>;
  /** Snapshot kind to append (defaults to `eod`). */
  snapshotKind?: string;
}

export interface ActiveRefreshResult {
  /** Positions in the working set. */
  positions: number;
  /** Positions that produced a snapshot + live-state latch. */
  refreshed: number;
  /** Snapshots appended (== refreshed on the happy path; a mid-position DB error can make it lower). */
  snapshotsAppended: number;
  /** Positions skipped because `loadReads` returned null (no usable read this tick). */
  skipped: number;
  /** Positions whose refresh errored (caught, not thrown). */
  errored: number;
  /** Per-position outcomes (verdict + write status) — surfaced for logging/telemetry. */
  outcomes: ManageSyncOutcome[];
}

/**
 * Run one hourly active-refresh pass. Fetches the open positions, then for each one loads fresh reads and
 * (append snapshot → latch live state) through manage-sync. Every position is isolated in its own try/catch so
 * one failure can't sink the batch; the whole thing is fail-soft and NEVER opens or closes a position.
 */
export async function runSwingActiveRefresh(deps: ActiveRefreshDeps): Promise<ActiveRefreshResult> {
  const snapshotKind = deps.snapshotKind ?? DEFAULT_ACTIVE_REFRESH_SNAPSHOT_KIND;

  let positions: SwingPositionRow[];
  try {
    positions = await deps.fetchOpen();
  } catch {
    // Whole-fetch failure → empty working set, not an exception out of the cron.
    return { positions: 0, refreshed: 0, snapshotsAppended: 0, skipped: 0, errored: 0, outcomes: [] };
  }

  const outcomes: ManageSyncOutcome[] = [];
  let refreshed = 0;
  let snapshotsAppended = 0;
  let skipped = 0;
  let errored = 0;

  for (const row of positions) {
    let reads: ManageSyncReads | null;
    try {
      reads = await deps.loadReads(row);
    } catch {
      errored += 1;
      continue;
    }
    if (reads == null) {
      skipped += 1;
      continue;
    }
    // manage-sync is itself fail-soft (returns an outcome carrying `error`, never throws); the extra guard
    // here is belt-and-braces so an unexpected throw still can't abort the loop.
    let outcome: ManageSyncOutcome;
    try {
      outcome = await syncSwingManagement(deps, row, reads, { snapshotKind });
    } catch (err) {
      errored += 1;
      outcomes.push({ positionId: row.id, verdict: undefined as never, snapshotId: null, liveStateUpdated: false, error: err instanceof Error ? err.message : String(err) });
      continue;
    }
    outcomes.push(outcome);
    if (outcome.snapshotId != null) snapshotsAppended += 1;
    if (outcome.error) errored += 1;
    else refreshed += 1;
  }

  return { positions: positions.length, refreshed, snapshotsAppended, skipped, errored, outcomes };
}
