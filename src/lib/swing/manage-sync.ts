// src/lib/swing/manage-sync.ts — the management IO shell for held swing positions (PR-13).
//
// WHY (docs/audit/SWING-ENGINE.md §4 PR-13): the active-refresh cron must, for every OPEN position, run the
// pure PR-7 management state machine (`evaluateSwingManagement`) against fresh reads and PERSIST the result —
// latch the live mark ratchet + append a longitudinal snapshot. This module is the thin, testable seam
// between the ledger rows and that pure verdict: `planManageSync` (PURE) turns a position row + fresh reads
// into the exact writes to make; `syncSwingManagement` (shell) applies them through injected accessors.
//
// TWO STANDING INVARIANTS (both encoded here, both commented at the call sites):
//   • NEVER-COMMIT / NEVER-CLOSE — PR-13 is evidence-only and HOLD. This shell only ever LATCHES live state
//     (mark/MFE/MAE ratchet + a status that never regresses) and APPENDS a snapshot. It never inserts a new
//     position and never writes a TERMINAL status (CLOSED/ROLLED) — closing and rolling are PR-15's job.
//     Capital-preservation gate rungs (expiry/structural/thesis/premium) ARE recorded and surfaced (their
//     `enforced:true` verdict rides the snapshot), but the mechanical close/roll is deferred, by design.
//   • APPEND-ONLY snapshots — each refresh is a distinct observation of the path; `insertSwingSnapshot` is an
//     INSERT, never an upsert, so the longitudinal series (the grader's input) is preserved intact.
//
// The position row already KNOWS its direction + sub-lane (ledger ground truth), so we synthesize the minimal
// dossier the manager reads from those, rather than re-deriving a classification — honest, not fabricated.

import type { SwingPositionRow, SwingSnapshotInsert } from "../db";
import type { PlayDirection } from "../horizon-fanout";
import type { SwingArchetype, SwingSubLane } from "./taxonomy";
import { SWING_ARCHETYPES } from "./taxonomy";
import type { SwingDossier } from "./dossier";
import { SWING_DOSSIER_VERSION } from "./dossier";
import type { ArchetypeVerdict } from "./archetype";
import {
  evaluateSwingManagement,
  GATING_RUNGS,
  type SwingManageInput,
  type SwingManageRung,
  type SwingManageVerdict,
} from "./manage";

const numOrNull = (n: number | null | undefined): number | null =>
  n != null && Number.isFinite(n) ? n : null;

const VALID_SUB_LANES: ReadonlySet<string> = new Set<SwingSubLane>(["TACTICAL", "STANDARD", "EXTENDED"]);
function coerceSubLane(raw: string | null | undefined): SwingSubLane | null {
  return raw != null && VALID_SUB_LANES.has(raw) ? (raw as SwingSubLane) : null;
}
function coerceArchetype(raw: string | null | undefined): SwingArchetype | null {
  return raw != null && (SWING_ARCHETYPES as readonly string[]).includes(raw) ? (raw as SwingArchetype) : null;
}

/** The fresh reads the refresh loop supplies per position. Every field optional/nullable — the manager skips
 *  any rung whose inputs are absent (null-honesty), never fabricating a signal from a missing feed. */
export interface ManageSyncReads {
  /** Live option mark (drives the premium ratchet + scale-out mechanics). */
  mark?: number | null;
  peakPremium?: number | null;
  scaledAlready?: boolean;
  /** Live underlying price + its structural stop (the thesis-primary reads). */
  underlyingPrice?: number | null;
  structuralStopLevel?: number | null;
  thesisBroken?: boolean | null;
  thesisBreakReason?: string;
  /** Calendar DTE of the held contract right now. */
  dte?: number | null;
  /** Running underlying favorable/adverse excursion (ratcheted by the ledger). */
  underlyingMfe?: number | null;
  underlyingMae?: number | null;
  // advisory evidence reads (each null when unknown → its rung is skipped, evidence-only anyway) —
  catalystShift?: boolean | null;
  regimeShift?: boolean | null;
  flowDecayed?: boolean | null;
  relStrengthLost?: boolean | null;
  volCollapsed?: boolean | null;
  sessionsHeld?: number | null;
  thesisProgress01?: number | null;
  addEligible?: boolean | null;
  /** Edge rungs the PR-16 ladder has graduated to enforced (gates ignore this). */
  graduatedRungs?: readonly SwingManageRung[];
}

/** The live-state latch this refresh will apply (mirrors updateSwingLiveState's arg). status NEVER terminal. */
export interface ManageSyncLiveState {
  status: string;
  mark: number | null;
  underlyingMfe: number | null;
  underlyingMae: number | null;
}

export interface ManageSyncPlan {
  positionId: number;
  verdict: SwingManageVerdict;
  liveState: ManageSyncLiveState;
  snapshot: SwingSnapshotInsert;
}

/**
 * Build the minimal dossier the manager reads (it only consults direction + subLane). Everything else is set
 * to an HONEST empty/null value — the pillar evidence isn't re-computed here, and a fabricated score would be
 * a lie. Ledger direction/sub-lane are the ground truth this position was committed on.
 */
function syntheticDossierFromPosition(row: SwingPositionRow): SwingDossier {
  const direction: PlayDirection = row.direction === "short" ? "SHORT" : "LONG";
  const fits = Object.fromEntries(SWING_ARCHETYPES.map((a) => [a, null])) as Record<SwingArchetype, number | null>;
  const archetype: ArchetypeVerdict = {
    archetype: coerceArchetype(row.archetype),
    confidence: 0,
    margin: 0,
    fits,
    reason: "synthetic (ledger-derived) — management reads direction/sub-lane only",
  };
  return {
    v: SWING_DOSSIER_VERSION,
    ticker: row.ticker,
    direction,
    asOf: row.updated_at,
    archetype,
    pillarSignals: {},
    score: { score: 0, archetype: archetype.archetype, subLane: coerceSubLane(row.sub_lane), contributions: [], presentCount: 0, reason: "synthetic" },
    subLane: coerceSubLane(row.sub_lane),
    dataQuality: { degraded: true, presentPillars: 0, missing: [] },
  };
}

/** Map a management verdict → a coarse thesis_state tag for the snapshot (surfaced to the desk/grader). */
function thesisStateOf(v: SwingManageVerdict): string {
  switch (v.rung) {
    case "structural_stop":
    case "thesis_stop":
      return "BROKEN";
    case "expiry_risk":
      return "EXPIRY_RISK";
    case "premium_stop":
      return "STOPPED";
    case "hold":
    case "insufficient_data":
      return "INTACT";
    default:
      return "WATCH"; // an advisory edge rung fired — worth watching, thesis not (yet) broken
  }
}

/**
 * PURE: turn a held position + fresh reads into the writes this refresh will make. Runs the PR-7 manager and
 * maps its verdict onto (a) a NON-TERMINAL live-state latch — the marks/MFE/MAE always land; the status is the
 * row's current status, never advanced to CLOSED/ROLLED (PR-15 owns terminal transitions) — and (b) an
 * append-only snapshot carrying the full verdict in `event_json` so the desk/grader see WHY, gate-vs-edge.
 */
export function planManageSync(
  row: SwingPositionRow,
  reads: ManageSyncReads,
  opts: { snapshotKind: string },
): ManageSyncPlan {
  const dossier = syntheticDossierFromPosition(row);
  const input: SwingManageInput = {
    dossier,
    dte: numOrNull(reads.dte),
    entryPremium: numOrNull(row.entry_premium),
    peakPremium: numOrNull(reads.peakPremium ?? row.peak_premium),
    lastMark: numOrNull(reads.mark),
    scaledAlready: reads.scaledAlready === true,
    underlyingPrice: numOrNull(reads.underlyingPrice),
    // Ledger stores the thesis-invalidation level in underlying terms — use it as the structural stop when a
    // live one wasn't supplied. Both null → the manager skips the structural rung (never guesses).
    structuralStopLevel: numOrNull(reads.structuralStopLevel ?? row.thesis_invalidation_px),
    thesisBroken: reads.thesisBroken ?? null,
    thesisBreakReason: reads.thesisBreakReason,
    catalystShift: reads.catalystShift ?? null,
    regimeShift: reads.regimeShift ?? null,
    flowDecayed: reads.flowDecayed ?? null,
    relStrengthLost: reads.relStrengthLost ?? null,
    volCollapsed: reads.volCollapsed ?? null,
    sessionsHeld: numOrNull(reads.sessionsHeld),
    thesisProgress01: numOrNull(reads.thesisProgress01),
    addEligible: reads.addEligible ?? null,
    graduatedRungs: reads.graduatedRungs,
  };
  const verdict = evaluateSwingManagement(input);

  const liveState: ManageSyncLiveState = {
    // NEVER-CLOSE invariant: keep the position's current (live) status. The updateSwingLiveState SQL guard
    // holds it monotonic; we deliberately never pass CLOSED/ROLLED here — terminal transitions are PR-15.
    status: row.status,
    mark: numOrNull(reads.mark),
    underlyingMfe: numOrNull(reads.underlyingMfe),
    underlyingMae: numOrNull(reads.underlyingMae),
  };

  const snapshot: SwingSnapshotInsert = {
    position_id: row.id,
    snapshot_kind: opts.snapshotKind,
    dte_remaining: numOrNull(reads.dte),
    underlying_px: numOrNull(reads.underlyingPrice),
    option_mark: numOrNull(reads.mark),
    running_mfe: numOrNull(reads.underlyingMfe),
    running_mae: numOrNull(reads.underlyingMae),
    thesis_state: thesisStateOf(verdict),
    event_json: {
      rung: verdict.rung,
      action: verdict.action,
      // Gate rungs (capital-preservation) enforce always; edge rungs stay evidence-only until graduated.
      enforced: verdict.enforced,
      gating: GATING_RUNGS.has(verdict.rung),
      reason: verdict.reason,
      dte_migration: verdict.dteMigration,
      roll_intent: verdict.rollIntent,
    },
  };

  return { positionId: row.id, verdict, liveState, snapshot };
}

/** Injected accessors — the PR-10 ledger surface this shell drives. Injected so the shell is testable without
 *  a live DB and asserts the never-commit/append-only invariants against fakes. */
export interface ManageSyncDeps {
  insertSnapshot: (s: SwingSnapshotInsert) => Promise<number>;
  updateLiveState: (id: number, s: { status: string; mark?: number | null; underlyingMfe?: number | null; underlyingMae?: number | null }) => Promise<void>;
}

export interface ManageSyncOutcome {
  positionId: number;
  verdict: SwingManageVerdict;
  snapshotId: number | null;
  liveStateUpdated: boolean;
  error?: string;
}

/**
 * Apply the plan for ONE position: append the snapshot, then latch live state. Fail-soft — a fetch/DB error is
 * caught and returned (never thrown), so one bad position can't abort the refresh loop. The snapshot append is
 * attempted first (the durable evidence), then the live-state latch.
 */
export async function syncSwingManagement(
  deps: ManageSyncDeps,
  row: SwingPositionRow,
  reads: ManageSyncReads,
  opts: { snapshotKind: string },
): Promise<ManageSyncOutcome> {
  const plan = planManageSync(row, reads, opts);
  let snapshotId: number | null = null;
  let liveStateUpdated = false;
  try {
    snapshotId = await deps.insertSnapshot(plan.snapshot);
    await deps.updateLiveState(plan.positionId, plan.liveState);
    liveStateUpdated = true;
  } catch (err) {
    return {
      positionId: plan.positionId,
      verdict: plan.verdict,
      snapshotId,
      liveStateUpdated,
      error: err instanceof Error ? err.message : String(err),
    };
  }
  return { positionId: plan.positionId, verdict: plan.verdict, snapshotId, liveStateUpdated };
}
