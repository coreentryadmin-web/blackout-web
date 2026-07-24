// src/lib/swing/manage-sync.ts — the management IO shell for held swing positions (PR-13, roll-wired in PR-15).
//
// WHY (docs/audit/SWING-ENGINE.md §4 PR-13): the active-refresh cron must, for every OPEN position, run the
// pure PR-7 management state machine (`evaluateSwingManagement`) against fresh reads and PERSIST the result —
// latch the live mark ratchet + append a longitudinal snapshot. This module is the thin, testable seam
// between the ledger rows and that pure verdict: `planManageSync` (PURE) turns a position row + fresh reads
// into the exact writes to make; `syncSwingManagement` (shell) applies them through injected accessors.
//
// PR-15 ROLL WIRING (the change): the shell now EXECUTES a roll/close on the GATING path instead of merely
// recording the intent — but ONLY when the caller injects a roll executor AND supplies the roll plan (the
// frozen parent grade + the child leg to open). The wiring is entirely OPT-IN and gated:
//   • `decideRollAction` (roll.ts) is the one arbiter: GATING-ONLY (edge/hold rungs never write a terminal
//     status), and THESIS-BROKEN = CLOSE-NOT-ROLL (a broken thesis exits; only a still-valid thesis with a
//     theta/expiry problem rolls). The manager's `rollIntent` already vetoes a broken thesis upstream.
//   • With no `executeRoll`/`buildRollPlan` dep (or when the plan can't be built — no forward bars / no new
//     contract), the shell falls back to the PR-13 evidence-only behaviour byte-for-byte: latch live state +
//     append the snapshot, record the intent, act on nothing. So the standing invariants below still hold on
//     every path that does not deliberately opt into execution.
//
// STANDING INVARIANTS (all encoded here, all commented at the call sites):
//   • APPEND-ONLY snapshots — each refresh is a distinct observation of the path; `insertSwingSnapshot` is an
//     INSERT, never an upsert, so the longitudinal series (the grader's input) is preserved intact. A roll
//     appends its snapshot through the same accessor (via `closeAndRollSwingPosition`), so the series is
//     unbroken across the roll boundary.
//   • CLOSE/ROLL ONLY VIA THE ROLL EXECUTOR — the evidence-only latch (`updateLiveState`) never writes a
//     terminal status; the ONLY terminal transition is `closeAndRollSwingPosition`, which the SQL
//     monotonic-status guard forbids from un-rolling. Capital-preservation gates act; edge rungs stay
//     evidence-only until the PR-16 ladder graduates them.
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
import {
  closeAndRollSwingPosition,
  decideRollAction,
  type ParentGradeFreeze,
  type RollChildSpec,
  type RollLedgerDeps,
  type RollOutcome,
} from "./roll";

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

/** The roll plan a caller supplies when it can EXECUTE a gating roll/close: the frozen parent grade (from the
 *  PR-8 grader over forward bars) plus, for a ROLL, the child leg to open (a freshly-picked further-out
 *  contract). `childSpec` is REQUIRED to roll and IGNORED on a close; a null plan means "can't execute this
 *  tick" → the shell stays evidence-only (records the intent, acts on nothing). */
export interface ManageSyncRollPlan {
  parentGrade: ParentGradeFreeze;
  childSpec?: RollChildSpec;
}

/** Injected accessors — the PR-10 ledger surface this shell drives. Injected so the shell is testable without
 *  a live DB and asserts the append-only / gating-only invariants against fakes. `insertSnapshot` +
 *  `updateLiveState` drive the evidence-only path; the OPTIONAL roll seam (`buildRollPlan` + `executeRoll`)
 *  drives the PR-15 gating execution — absent → the shell behaves exactly as PR-13 (evidence-only, HOLD). */
export interface ManageSyncDeps extends Partial<RollLedgerDeps> {
  insertSnapshot: (s: SwingSnapshotInsert) => Promise<number>;
  updateLiveState: (id: number, s: { status: string; mark?: number | null; underlyingMfe?: number | null; underlyingMae?: number | null }) => Promise<void>;
  /** Build the frozen parent grade + child leg for a gating roll/close. Null → can't execute (evidence-only). */
  buildRollPlan?: (row: SwingPositionRow, verdict: SwingManageVerdict, reads: ManageSyncReads) => Promise<ManageSyncRollPlan | null>;
  /** Execute the transactional roll/close (wraps `closeAndRollSwingPosition` with the PR-10 accessors bound).
   *  When omitted, the shell uses `closeAndRollSwingPosition` directly IF the three roll-ledger accessors are
   *  present on this deps object; when they aren't either, the gating path stays evidence-only. */
  executeRoll?: (deps: RollLedgerDeps, req: Parameters<typeof closeAndRollSwingPosition>[1]) => Promise<RollOutcome>;
}

export interface ManageSyncOutcome {
  positionId: number;
  verdict: SwingManageVerdict;
  snapshotId: number | null;
  liveStateUpdated: boolean;
  /** Set when the gating path EXECUTED a roll/close this tick (PR-15). Absent on the evidence-only path. */
  roll?: RollOutcome;
  error?: string;
}

/** True when this deps object carries the full PR-10 roll-ledger surface (grade parent + insert child +
 *  insert snapshot) — the minimum needed to execute a transactional roll/close. */
function hasRollLedger(deps: ManageSyncDeps): deps is ManageSyncDeps & RollLedgerDeps {
  return (
    typeof deps.gradeParent === "function" &&
    typeof deps.insertChild === "function" &&
    typeof deps.insertSnapshot === "function"
  );
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

  // ── PR-15 gating execution: a capital-preservation gate that the caller can act on EXECUTES a roll/close ──
  // `decideRollAction` is GATING-ONLY (edge/hold → SKIP) and encodes THESIS-BROKEN = CLOSE-NOT-ROLL. We only
  // take this path when (a) the verdict is a gate to act on, (b) the roll-ledger accessors are injected, and
  // (c) the caller can build the roll plan for THIS tick (grade + child). Any of those absent → fall through
  // to the evidence-only latch below, exactly as PR-13 (record the intent, act on nothing).
  const decision = decideRollAction(plan.verdict);
  if (decision.action !== "SKIP" && deps.buildRollPlan && hasRollLedger(deps)) {
    let rollPlan: ManageSyncRollPlan | null = null;
    try {
      rollPlan = await deps.buildRollPlan(row, plan.verdict, reads);
    } catch (err) {
      // A plan-build failure must not sink the refresh — degrade to evidence-only, carrying the reason.
      const outcome = await applyEvidenceOnly(deps, plan);
      return { ...outcome, error: outcome.error ?? (err instanceof Error ? err.message : String(err)) };
    }
    if (rollPlan) {
      const runRoll = deps.executeRoll ?? closeAndRollSwingPosition;
      try {
        // The roll executor OWNS the snapshot append for this tick (append-only, unbroken across the roll
        // boundary), so we do NOT also run the evidence-only latch — the parent is going terminal.
        const roll = await runRoll(deps, {
          parent: row,
          verdict: plan.verdict,
          parentGrade: rollPlan.parentGrade,
          childSpec: rollPlan.childSpec,
          snapshot: plan.snapshot,
        });
        return {
          positionId: plan.positionId,
          verdict: plan.verdict,
          snapshotId: roll.snapshotId,
          liveStateUpdated: false,
          roll,
          error: roll.error,
        };
      } catch (err) {
        return {
          positionId: plan.positionId,
          verdict: plan.verdict,
          snapshotId: null,
          liveStateUpdated: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }
    // rollPlan == null → the caller couldn't build a plan this tick; fall through to evidence-only.
  }

  return applyEvidenceOnly(deps, plan);
}

/** The PR-13 evidence-only application: append the snapshot (durable evidence first), then latch live state.
 *  NEVER writes a terminal status — the status carried on `plan.liveState` is the row's current live rung. */
async function applyEvidenceOnly(deps: ManageSyncDeps, plan: ManageSyncPlan): Promise<ManageSyncOutcome> {
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
