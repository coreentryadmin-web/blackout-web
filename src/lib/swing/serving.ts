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
// left", and that fact, not the number, decides the section. The one score-derived input we DO consume is
// the COMMIT/WATCH floor gate (aboveFloor) — but that is a mechanical GATE RESULT (did the score clear the
// lane floor: yes/no), the same observable "shown-but-not-committed" line the board already draws, not the
// raw statistic itself. Routing on the raw score/EV is exactly the calibration-first violation this guards.
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
  | "COMMIT_NOW" //         triggered AND at the trigger, floor cleared → act now
  | "WAITING_FOR_ENTRY" //  live thesis, but no clean fill yet (pre-trigger / pullback / extended past it)
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
 *     • TRIGGERED + AT_TRIGGER (in the entry window) .......... COMMIT_NOW
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

  // Triggered and in the valid entry window → act now; triggered but pre/pulling-back/chasing → wait.
  if (setup === "TRIGGERED") {
    return o.entryStatus === "AT_TRIGGER" ? "COMMIT_NOW" : "WAITING_FOR_ENTRY";
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
