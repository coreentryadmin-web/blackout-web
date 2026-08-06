// src/lib/swing/serving.ts — the SWING serving-section router (PR-9). Pure, no IO.
//
// WHY (docs/audit/SWING-ENGINE.md §4 PR-9): the desk cannot show a member 200 swing candidates as one
// undifferentiated list. A member needs to know, at a glance, WHICH ACTION each name demands right now:
// commit capital, wait for a clean fill, keep watching, dig deeper, or manage a live position. This
// module is that triage — it maps one play's OBSERVABLE state onto exactly one of seven serving
// sections. Nothing else in the engine decides "what bucket does this show in"; the board renders these.
//
// THE LOAD-BEARING RULE (SEV-6, and the whole reason this is its own module): the router keys ONLY on
// OBSERVABLE state — the setup maturity (setupState), the entry-execution stance (entryStatus), a live
// position's status/management action, and the thesis-health level. It NEVER routes on an ungraduated
// STATISTIC (a probability, an EV, a raw conviction score). A 91-point name that has run past its trigger
// is WAITING_FOR_ENTRY, not COMMIT_NOW — the score is high but the OBSERVABLE fact is "no clean entry
// left", and that fact, not the number, decides the section.
//
// COMMIT_NOW ≠ "score cleared a provisional floor." COMMIT_NOW is reserved for setups whose entry geometry
// is clean — triggered + at-trigger. Archetype×sub-lane calibration (graduation) is EVIDENCE-ONLY (2026-08-06,
// matches commit.ts's real-time-gates model — see its file header): it no longer withholds COMMIT_NOW, since
// the backend now opens a real position on the real-time gates (contract/budget/caps/idempotency) regardless
// of graduation status. Budget/caps stay model-book-only (members are not on the reference book).
// The one score-derived input we DO consume is the COMMIT/WATCH floor gate (aboveFloor) — a mechanical GATE
// RESULT (did the score clear the lane floor: yes/no), not the raw statistic itself.
//
// SCOPE: sections populate for the SWING lane only. 0DTE keeps its ratchet flow and LEAPS its thesis flow;
// their boards carry no `sections`, and `committed`/`watch` stay as derived back-compat views everywhere.

import type { SwingSetupState, SwingEntryState } from "./taxonomy";
import type { SwingManageAction } from "./manage";
import type { HorizonPlay } from "../horizon-plays";

/**
 * The seven serving sections — the member-facing triage buckets a swing name can land in.
 * Four are PRE-ENTRY (before any capital is committed); three are LIVE-POSITION management states.
 */
export type SwingServingSection =
  // ── pre-entry ──
  | "COMMIT_NOW" //         triggered + at trigger + floor cleared → member may act (graduation is evidence-only)
  | "WAITING_FOR_ENTRY" //  live thesis, but no clean fill yet
  | "WATCH" //              forming, or a real contract still under the commit floor → not actionable yet
  | "RESEARCH" //           unclassified, invalidated, or degraded → needs work before it can be served
  // ── live position ──
  | "MANAGING" //           open + thesis intact → hold and manage to plan
  | "SCALING_OUT" //        open + banking a tranche / trailing the runner (profit-ladder, TRIM)
  | "EXITING"; //           open + exit signalled (thesis broke, capital backstop, or forced-manage)

/** Stable render/iteration order for the sections. */
export const SWING_SERVING_SECTIONS: readonly SwingServingSection[] = [
  "COMMIT_NOW",
  "WAITING_FOR_ENTRY",
  "WATCH",
  "RESEARCH",
  "MANAGING",
  "SCALING_OUT",
  "EXITING",
] as const;

/** A live-position status. Kept minimal (the three states an ACTIVELY-managed swing can be in) so the
 *  router only treats a genuinely-open position as "live"; closed/watch names fall to the pre-entry path. */
export type SwingLiveStatus = "OPEN" | "HOLD" | "TRIM";

/** Thesis-health read (mirrors command-deck's ThesisLevel WITHOUT a lib→features import — the router keys
 *  on the observable level, not the render shape). "break" forces an exit; the rest are non-decisive here. */
export type SwingThesisLevel = "intact" | "warn" | "break" | "unknown";

const LIVE_STATUSES: ReadonlySet<SwingLiveStatus> = new Set<SwingLiveStatus>(["OPEN", "HOLD", "TRIM"]);

/**
 * The OBSERVABLE inputs the router keys on. Every field is optional/nullable — a missing read is honestly
 * absent (null), never fabricated, and the router degrades to WATCH/RESEARCH rather than guessing. NONE of
 * these is a probability/EV/raw score: they are maturity, entry stance, live status, management action,
 * thesis level, and the one mechanical floor-gate result.
 */
export interface SwingServingObservables {
  /** Setup maturity (setup-state.ts): FORMING → TRIGGERED → EXTENDED → INVALIDATED. */
  setupState?: SwingSetupState | null;
  /** Entry-execution stance (entry-model.ts): PRE_TRIGGER → AT_TRIGGER → PULLBACK_TO_ENTRY → EXTENDED_CHASE. */
  entryStatus?: SwingEntryState | null;
  /** Live-position status when this play is an OPEN position (else absent → pre-entry routing). */
  liveStatus?: SwingLiveStatus | null;
  /** The management state machine's action (manage.ts) for a live position — drives the live sections. */
  manageAction?: SwingManageAction | null;
  /** Thesis-health level for a live position — "break" forces EXITING. */
  thesisLevel?: SwingThesisLevel | null;
  /** Mechanical GATE RESULT: did the score clear the lane commit floor (COMMIT) or not (WATCH). This is a
   *  yes/no gate, NOT the raw score — the only score-derived input the router is allowed to consume. */
  aboveFloor?: boolean | null;
  /**
   * Whether this play's archetype×sub-lane bucket has cleared the staged Wilson-LB graduation ladder.
   * DIAGNOSTIC ONLY (2026-08-06) — does not gate COMMIT_NOW; the model ledger itself opens on real-time
   * gates (contract/budget/caps/idempotency) regardless of graduation, see commit.ts's file header.
   */
  bucketGraduated?: boolean | null;
  /** When true, the play is visible in RESEARCH — seen but below the persistence bar. */
  persistenceObserved?: boolean | null;
}

/**
 * Route one swing play to its serving section from OBSERVABLE state only. Precedence:
 *
 *   LIVE POSITION (status OPEN/HOLD/TRIM) → the three management sections, by management action / thesis:
 *     • thesis broke / EXIT / STOP_OUT ............................ EXITING
 *     • banking a tranche / trailing a runner / TRIM ............. SCALING_OUT
 *     • otherwise (intact, holding to plan) ..................... MANAGING
 *
 *   PRE-ENTRY (no live position) → the four pre-entry sections, by setup maturity + entry stance:
 *     • unclassified (no setup state at all) ................... RESEARCH
 *     • INVALIDATED (thesis broke pre-entry) .................. RESEARCH
 *     • FORMING (thesis still building) ....................... WATCH
 *     • real contract under the commit floor .................. WATCH
 *     • EXTENDED (moved too far past trigger — no clean fill) . WAITING_FOR_ENTRY
 *     • TRIGGERED + AT_TRIGGER ................................ COMMIT_NOW
 *     • TRIGGERED + any other entry stance (pre/pullback/chase) WAITING_FOR_ENTRY
 *
 * NEVER branches on a probability/EV/raw score — only the observable states above (aboveFloor is the
 * mechanical floor-gate result, not the statistic).
 */
export function sectionForSwingPlay(o: SwingServingObservables): SwingServingSection {
  // ── LIVE POSITION → management sections ──────────────────────────────────────────────────────
  // Managed purely off the observable management action + thesis level, never off live P&L magnitude.
  if (o.liveStatus != null && LIVE_STATUSES.has(o.liveStatus)) {
    if (o.thesisLevel === "break" || o.manageAction === "EXIT" || o.manageAction === "STOP_OUT") {
      return "EXITING";
    }
    if (o.liveStatus === "TRIM" || o.manageAction === "TAKE_PARTIAL" || o.manageAction === "EXIT_RUNNER") {
      return "SCALING_OUT";
    }
    return "MANAGING";
  }

  // ── PRE-ENTRY → the four pre-entry sections, keyed on setup maturity + entry stance ──────────────
  // Persistence-observed (below cross-session bar) → RESEARCH with an honest gap reason.
  if (o.persistenceObserved === true) return "RESEARCH";

  const setup = o.setupState ?? null;

  // Unclassified (no maturity read at all) or a broken thesis → RESEARCH (needs work before serving).
  if (setup == null) return "RESEARCH";
  if (setup === "INVALIDATED") return "RESEARCH";

  // Still building the thesis → WATCH (not yet actionable).
  if (setup === "FORMING") return "WATCH";

  // A real contract that hasn't cleared the commit floor is the "shown but not committed" watch rail —
  // the mechanical gate result, not the raw score, keeps it out of the actionable sections.
  if (o.aboveFloor === false) return "WATCH";

  // The move already ran past the trigger — the thesis is live but there's no clean entry, so it waits.
  if (setup === "EXTENDED") return "WAITING_FOR_ENTRY";

  // Triggered + at trigger → COMMIT_NOW. Graduation status is evidence-only (2026-08-06, matches the
  // commit gate in commit.ts — see its file header): a real position now opens on the real-time gates
  // (contract/budget/caps/idempotency) regardless of the calibration ladder, so the display no longer
  // withholds "Act now" from an ungraduated setup that the backend will, in fact, open.
  if (setup === "TRIGGERED") {
    if (o.entryStatus === "AT_TRIGGER") return "COMMIT_NOW";
    return "WAITING_FOR_ENTRY";
  }

  // Exhaustive by the SwingSetupState union; anything unforeseen degrades honestly to RESEARCH.
  return "RESEARCH";
}

/**
 * Extract the router's observables from a produced HorizonPlay. The pre-entry swing fields (setupState/
 * entryStatus) ride the play as optional metadata (PR-12 wires the real reads); `aboveFloor` is the play's
 * existing COMMIT/WATCH status — the mechanical floor gate, not the score. Produced plays are pre-entry,
 * so no live status is derived here; live-position observables come from the ledger in later PRs.
 */
export function observablesFromHorizonPlay(play: HorizonPlay): SwingServingObservables {
  return {
    setupState: play.setupState ?? null,
    entryStatus: play.entryStatus ?? null,
    aboveFloor: play.status === "COMMIT",
    // Diagnostic only (2026-08-06) — no longer gates COMMIT_NOW; kept so the calibration ladder's
    // progress stays observable on the play/board without influencing what section it serves in.
    bucketGraduated: play.bucketGraduated === true,
    persistenceObserved: play.persistenceObserved === true,
    // Live-position observables — stamped by live-plays.ts from the open ledger.
    liveStatus: play.liveStatus ?? null,
    manageAction: play.manageAction ?? null,
    thesisLevel: play.thesisLevel ?? null,
  };
}

/** Serving sections as play buckets — the SWING lane's replacement for the flat committed/watch split. */
export type SwingServingSections = Record<SwingServingSection, HorizonPlay[]>;

/** An empty section map (all seven present, so the board always renders every bucket). */
export function emptySwingSections(): SwingServingSections {
  return {
    COMMIT_NOW: [],
    WAITING_FOR_ENTRY: [],
    WATCH: [],
    RESEARCH: [],
    MANAGING: [],
    SCALING_OUT: [],
    EXITING: [],
  };
}

/**
 * Group a lane's plays into the seven serving sections. Each play is stamped with its resolved `serving`
 * section (so a consumer reading a single play knows its bucket without re-running the router). Order
 * within a section is preserved from the input (already score-sorted by produceHorizonPlays).
 */
export function buildSwingSections(plays: readonly HorizonPlay[]): SwingServingSections {
  const out = emptySwingSections();
  for (const play of plays) {
    const section = sectionForSwingPlay(observablesFromHorizonPlay(play));
    out[section].push({ ...play, serving: section });
  }
  return out;
}
