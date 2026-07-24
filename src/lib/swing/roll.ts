// src/lib/swing/roll.ts — the SWING roll executor (PR-15, the FINAL swing engine PR). IO shell over the
// PR-10 ledger; the transition decision is pure. This is the ONE place the swing engine writes a TERMINAL
// status on the gating (capital-preservation) path.
//
// WHY (docs/audit/SWING-ENGINE.md §4 PR-15): the PR-7 manager only ever produced a roll INTENT and PR-13's
// manage-sync only RECORDED it. A roll must eventually be EXECUTED — and a roll is not a single write, it is
// a two-part TRANSACTION that must never half-complete:
//
//   ROLL = close+grade+link. (1) freeze the PARENT: flip it to terminal ROLLED and freeze its realized_pnl_pct
//   via the PR-10 `gradeSwingPosition` accessor (guarded `graded_at IS NULL` → graded exactly once, a later
//   write can NEVER re-litigate it), then (2) open a linked CHILD via `insertSwingPosition` with
//   parent_position_id = parent.id, root_position_id = parent.root_position_id ?? parent.id (the chain root is
//   sticky), roll_seq = parent.roll_seq + 1.
//
// PRESERVE-PARENT-LOSS (the survivorship law this engine is built on, PR-14): the parent leg's frozen grade is
// NEVER netted away by the roll. Each leg keeps its own realized_pnl_pct; the record layer's chain composite
// (record.ts) requires EVERY leg to have won, so a losing parent stays a loss even if the child prints — the
// roll must not launder it. We therefore grade the PARENT independently and only LINK the child; we never
// touch the parent's realized once frozen.
//
// THESIS-BROKEN = CLOSE-NOT-ROLL: a roll only makes sense for a STILL-VALID thesis with a theta/expiry problem
// (buy time-in-thesis). A broken thesis (structural stop hit / thesis-invalidation signal) is an EXIT — you
// close it, you do not pay to extend a wrong idea. `detectRollCandidate` (PR-7) already vetoes the intent on a
// broken thesis, so `decideRollAction` maps a gating rung with NO valid-thesis roll to CLOSE (terminal CLOSED,
// no child), and a gating rung WITH a valid-thesis roll to ROLL (terminal ROLLED + child).
//
// GATING-ONLY: this executor acts ONLY on the four capital-preservation GATE rungs (expiry/structural/thesis/
// premium). Every EDGE rung stays evidence-only (SKIP) until the PR-16 calibration ladder graduates it — the
// same enforce-vs-advisory discipline the manager encodes. An edge verdict never writes a terminal status.
//
// ALL-OR-NOTHING (the transactional guard, unit-tested with injected accessors — no live DB): the parent's
// terminal ROLLED flip is the IRREVERSIBLE step, so on a ROLL we insert the CHILD FIRST and only grade+close
// the parent once the child (the continuation) is durably written. If the child insert throws, `gradeParent`
// is NEVER reached → the parent is left fully OPEN, not half-closed.
//
// FINDINGS 2026-07-24 (SEV-3, non-atomic roll): child-first ordering alone is not enough — as two SEPARATE
// autocommit writes the child could commit and then the parent grade fail/race, leaving an orphan child on a
// still-OPEN parent. When the caller injects `runRollTx` (bound to db.ts `withSwingRollTx`) the child insert +
// parent terminal grade run on ONE pooled client inside BEGIN/COMMIT, so a parent-grade failure ROLLS BACK the
// freshly-inserted child too — genuinely all-or-nothing. The tx-bound `gradeParent` reports affected rowcount
// and treats a 0-row terminal flip (the parent already graded/terminal — a grade race) as an ERROR that aborts
// the whole roll, never a silent success. When `runRollTx` is absent (unit tests, or a lane that hasn't wired
// the seam) the executor falls back to the sequential child-first path — still fail-soft, and the two
// idempotency guards it leans on (`gradeSwingPosition`'s `graded_at IS NULL`, `insertSwingPosition`'s commit_key
// first-write-wins) make the narrow "child written, parent-grade retried" window safe to re-run.

import type { SwingPositionInsert, SwingSnapshotInsert } from "../db";
import { GATING_RUNGS, type SwingManageVerdict } from "./manage";

/** The frozen parent grade the roll pins onto the terminal leg (mirrors the PR-10 `gradeSwingPosition` arg,
 *  minus `status` — the executor sets ROLLED/CLOSED). realized_pnl_pct is frozen once and never re-litigated. */
export interface ParentGradeFreeze {
  grade_json: Record<string, unknown>;
  grade_methodology: string;
  legacy_grade?: Record<string, unknown> | null;
  realized_pnl_pct?: number | null;
}

/** The new leg to open on a ROLL, minus the chain-link columns — those are computed from the parent so the
 *  caller can never mis-thread the chain (root/parent/roll_seq are set here, not supplied). */
export type RollChildSpec = Omit<SwingPositionInsert, "parent_position_id" | "root_position_id" | "roll_seq">;

/** Structural subset of SwingPositionRow the roll needs — id + the chain-link ancestry. Row satisfies it. */
export interface RollParentLike {
  id: number;
  root_position_id: number | null;
  roll_seq: number;
}

export type RollAction = "ROLL" | "CLOSE" | "SKIP";

/** The transaction-scoped ledger surface handed to the `runRollTx` callback: the child insert + the parent
 *  terminal grade, both bound to ONE transaction client. `gradeParent` here returns the AFFECTED ROWCOUNT (and,
 *  in the real `withSwingRollTx`, throws on 0 rows — a grade race — to abort/rollback the whole roll). */
export interface RollTxDeps {
  insertChild: (pos: SwingPositionInsert) => Promise<number>;
  gradeParent: (id: number, g: ParentGradeFreeze & { status: "CLOSED" | "ROLLED" }) => Promise<number>;
}

/** The injected PR-10 ledger surface — bound so the executor is testable with fakes and no live DB. */
export interface RollLedgerDeps {
  /** Freeze + terminate the parent (PR-10 gradeSwingPosition). status ROLLED for a roll, CLOSED for a veto. */
  gradeParent: (
    id: number,
    g: ParentGradeFreeze & { status: "CLOSED" | "ROLLED" }
  ) => Promise<void>;
  /** Open the linked child (PR-10 insertSwingPosition). Returns the child id. */
  insertChild: (pos: SwingPositionInsert) => Promise<number>;
  /** Append the management snapshot for this tick (PR-10 insertSwingSnapshot). Append-only. */
  insertSnapshot: (s: SwingSnapshotInsert) => Promise<number>;
  /** OPTIONAL transactional runner (bound to db.ts `withSwingRollTx`) — runs the child insert + parent terminal
   *  grade atomically on ONE pooled client (BEGIN/COMMIT, rollback on any error incl. a 0-row grade race). When
   *  present the ROLL/CLOSE terminal writes go through it; when absent the executor falls back to the sequential
   *  child-first path (unit tests, or an un-wired lane). SEV-3 fix. */
  runRollTx?: <T>(fn: (tx: RollTxDeps) => Promise<T>) => Promise<T>;
}

export interface RollRequest {
  parent: RollParentLike;
  /** The management verdict — decides ROLL vs CLOSE vs SKIP (gating-only, thesis-broken=close). */
  verdict: SwingManageVerdict;
  /** Frozen grade to pin on the parent when it terminates (ROLL or CLOSE). */
  parentGrade: ParentGradeFreeze;
  /** The child leg to open — REQUIRED for a ROLL, ignored for a CLOSE. */
  childSpec?: RollChildSpec;
  /** Management snapshot to append on this tick — appended on EVERY path (including SKIP). */
  snapshot?: SwingSnapshotInsert;
}

export interface RollOutcome {
  action: RollAction;
  reason: string;
  parentId: number;
  /** Child leg id — set only on a completed ROLL. */
  childId: number | null;
  /** True once the parent's terminal grade was applied (ROLL or CLOSE). */
  parentGraded: boolean;
  snapshotId: number | null;
  error?: string;
}

/**
 * PURE decision: map a management verdict to the ledger action. GATING-ONLY (edge/hold rungs never act →
 * SKIP), and THESIS-BROKEN = CLOSE-NOT-ROLL — a gating rung with a still-valid-thesis roll intent rolls; a
 * gating rung whose roll intent is vetoed (broken thesis / structural stop / no theta disproportion) closes.
 */
export function decideRollAction(verdict: SwingManageVerdict): { action: RollAction; reason: string } {
  if (!GATING_RUNGS.has(verdict.rung)) {
    return { action: "SKIP", reason: `edge/hold rung '${verdict.rung}' — evidence-only, no terminal write (gating-only)` };
  }
  if (verdict.rollIntent.roll) {
    return { action: "ROLL", reason: `gating rung '${verdict.rung}' with a still-valid-thesis roll — ${verdict.rollIntent.reason}` };
  }
  return { action: "CLOSE", reason: `gating rung '${verdict.rung}' with no valid-thesis roll — close, not roll (${verdict.reason})` };
}

/**
 * Execute (or decline) the transactional roll for one held position. Walks `decideRollAction`:
 *   • SKIP  — not a capital-preservation gate → no terminal write; only append the management snapshot.
 *   • CLOSE — gating rung, thesis broken → freeze+close the parent (CLOSED). No child.
 *   • ROLL  — gating rung, thesis still valid → insert the linked child FIRST (all-or-nothing guard), then
 *             freeze+close the parent (ROLLED). Child links parent/root/roll_seq off the parent. When a
 *             `runRollTx` seam is injected both writes run atomically (BEGIN/COMMIT, rollback on any error
 *             incl. a 0-row grade race — SEV-3); otherwise they run sequentially child-first.
 * Every path appends the management snapshot (append-only, every tick). Fail-soft: a ledger error is caught
 * and returned (never thrown), and — because the parent's terminal flip is ordered LAST on a ROLL and rolled
 * back atomically under the tx seam — a child-insert (or grade-race) failure aborts with the parent still
 * OPEN (never half-closed).
 */
export async function closeAndRollSwingPosition(
  deps: RollLedgerDeps,
  req: RollRequest
): Promise<RollOutcome> {
  const decision = decideRollAction(req.verdict);
  const base: RollOutcome = {
    action: decision.action,
    reason: decision.reason,
    parentId: req.parent.id,
    childId: null,
    parentGraded: false,
    snapshotId: null,
  };

  // SKIP: an edge/hold verdict is evidence-only. Never write a terminal status; just record the observation.
  if (decision.action === "SKIP") {
    try {
      const snapshotId = req.snapshot ? await deps.insertSnapshot(req.snapshot) : null;
      return { ...base, snapshotId };
    } catch (err) {
      return { ...base, error: err instanceof Error ? err.message : String(err) };
    }
  }

  try {
    const terminalStatus: "CLOSED" | "ROLLED" = decision.action === "ROLL" ? "ROLLED" : "CLOSED";
    const parentGrade = { ...req.parentGrade, status: terminalStatus };
    let childId: number | null = null;

    if (decision.action === "ROLL") {
      if (!req.childSpec) {
        // A roll with no child leg would ROLL the parent into nothing — refuse, leave the parent OPEN.
        return { ...base, error: "roll requires a childSpec (the new leg to open); parent left OPEN" };
      }
      // The chain-link columns are set from the parent so the chain can never be mis-threaded: root is sticky
      // (parent.root ?? parent.id), roll_seq increments by one.
      const child: SwingPositionInsert = {
        ...req.childSpec,
        parent_position_id: req.parent.id,
        root_position_id: req.parent.root_position_id ?? req.parent.id,
        roll_seq: (req.parent.roll_seq ?? 0) + 1,
      };

      if (deps.runRollTx) {
        // ATOMIC (SEV-3): child insert + parent terminal grade on ONE transaction client. Child FIRST (the
        // ordering guard survives), parent grade LAST; a parent-grade failure or 0-row grade race rolls the
        // child back too, so we never leave an orphan child on a still-OPEN parent.
        childId = await deps.runRollTx(async (tx) => {
          const cid = await tx.insertChild(child);
          await tx.gradeParent(req.parent.id, parentGrade); // throws on 0 rows (grade race) → rollback
          return cid;
        });
      } else {
        // Fallback (no tx seam): sequential child-first. Ordering the terminal write LAST is the durable guard —
        // a child-insert failure never reaches the parent flip, so the parent stays fully OPEN, not half-closed.
        childId = await deps.insertChild(child);
        await deps.gradeParent(req.parent.id, parentGrade);
      }
    } else if (deps.runRollTx) {
      // CLOSE through the tx seam too — a single grade, but it still gets the 0-row grade-race guard (a terminal
      // flip that matched nothing is an error, not a silent no-op) inside BEGIN/COMMIT.
      await deps.runRollTx(async (tx) => {
        await tx.gradeParent(req.parent.id, parentGrade);
        return null;
      });
    } else {
      // CLOSE, no tx seam: freeze + terminate the parent directly. gradeSwingPosition's `graded_at IS NULL`
      // guard freezes realized_pnl_pct exactly once.
      await deps.gradeParent(req.parent.id, parentGrade);
    }

    // Append the management snapshot documenting the roll/close tick (append-only) — outside the terminal tx,
    // as it is evidence, not part of the all-or-nothing close.
    const snapshotId = req.snapshot ? await deps.insertSnapshot(req.snapshot) : null;
    return { ...base, childId, parentGraded: true, snapshotId };
  } catch (err) {
    // Fail-soft. On a ROLL, a child-insert failure (or a rolled-back atomic roll) leaves parentGraded false →
    // the parent is still OPEN, so the position is never half-closed.
    return { ...base, error: err instanceof Error ? err.message : String(err) };
  }
}
