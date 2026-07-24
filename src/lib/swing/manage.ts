// src/lib/swing/manage.ts — the SWING management state machine (PR-7). Pure, no IO.
//
// WHY (docs/audit/SWING-ENGINE.md §4 PR-7): a multi-session swing is NOT a 0DTE. The 0DTE exit is
// premium-primary — the option's own P&L IS the thesis, so a fixed −50/+100 governs everything
// (scale-out.ts's HORIZON NOTE spells this out). A swing's edge lives in the UNDERLYING over days;
// the option is just the instrument tracking it. So this manager is UNDERLYING-THESIS-PRIMARY: a
// position exits because the *thesis* broke — even when the option is green — and the premium hard
// stop is only the last-resort capital backstop, not the primary signal. Getting that precedence
// wrong (premium-first, like 0DTE) is exactly failure mode #6 (stopped out of a still-valid thesis
// by option chop, or held a broken thesis because the option happened to be up).
//
// PRECEDENCE (highest wins) — the load-bearing ordering:
//   1. expiry_risk     (GATE) — too little time / theta cliff for the lane → force manage.
//   2. structural_stop (GATE) — the UNDERLYING broke its structural stop (thesis invalidation in
//                               underlying terms). Fires at ANY premium P&L, even +30% — the thesis
//                               is what broke, not the option.
//   3. thesis_stop     (GATE) — an archetype-specific invalidation signal (reclaim failed, flow
//                               reversed, …) computed upstream.
//   4. premium_stop    (GATE) — the −60% capital backstop, via deriveScaleOutAction STOP_OUT
//                               (SCALE_OUT_RULES.hard_stop_mult 0.4). Last line, not the first.
//   5+. [advisory / evidence-only] catalyst/regime shift → profit-ladder (TAKE_PARTIAL@2× /
//       EXIT_RUNNER trail via deriveScaleOutAction) → flow-decay / rel-strength-loss / vol-collapse
//       → time-stop → add-eligible.
//
// ENFORCE-vs-ADVISORY SPLIT (calibration-first, the repo's standing law): the four capital-
// preservation rungs GATE (enforced:true always) — you never wait on a graded bucket to protect
// capital. Every EDGE rung is evidence-only (enforced:false) until its name appears in the caller's
// `graduatedRungs` (which the PR-16 ladder flips once the rung's own bucket clears n≥10, delta≥15pt).
// So the desk can SHOW "flow decayed → consider trimming" long before that recommendation is allowed
// to act — same discipline as the sub-lane/archetype score floors in taxonomy.ts.
//
// NULL-HONESTY: every rung evaluates ONLY when its own inputs are present; a missing feed skips the
// rung, never fabricates a signal. With nothing evaluable we return HOLD/insufficient_data — we do
// not act on a hollow read (dossier.ts's standing rule, carried through management).

import type { SwingDossier } from "./dossier";
import type { SwingSubLane } from "./taxonomy";
import { subLaneForDte } from "./taxonomy";
import {
  deriveScaleOutAction,
  SCALE_OUT_RULES,
  type ScaleOutAction,
} from "../zerodte/scale-out";

const numOrNull = (n: number | null | undefined): number | null =>
  n != null && Number.isFinite(n) ? n : null;

/** The action the desk should take. Reuses the scale-out vocabulary for the premium mechanics and
 *  adds the thesis-level `EXIT` (full close on a broken/expiring thesis) and `ADD` (advisory add). */
export type SwingManageAction = ScaleOutAction | "EXIT" | "ADD";

/** The rung that decided the verdict. The first four are capital-preservation GATES; the rest are
 *  evidence-only until graduated. `hold`/`insufficient_data` are the two no-action outcomes. */
export type SwingManageRung =
  | "expiry_risk"
  | "structural_stop"
  | "thesis_stop"
  | "premium_stop"
  | "catalyst_shift"
  | "regime_shift"
  | "profit_ladder"
  | "flow_decay"
  | "rel_strength_loss"
  | "vol_collapse"
  | "time_stop"
  | "add_eligible"
  | "hold"
  | "insufficient_data";

/** The capital-preservation rungs — these GATE (enforced:true) regardless of graduation. */
export const GATING_RUNGS: ReadonlySet<SwingManageRung> = new Set<SwingManageRung>([
  "expiry_risk",
  "structural_stop",
  "thesis_stop",
  "premium_stop",
]);

// ─── Per-sub-lane management params (fast lanes carry tighter time discipline) ──────────────────
// A Tactical (2–7d) contract sits on a theta cliff — its expiry-risk floor + roll horizon are tight
// and its time-stop short; an Extended (22–30d) contract has room, so its floors are looser. These
// are the management analogue of taxonomy.ts's per-lane thetaSensitivity/earningsHazard.
export interface SwingSubLaneManageSpec {
  id: SwingSubLane;
  /** DTE at/below which expiry_risk force-manages (the lane's theta cliff). GATE. */
  expiryRiskDte: number;
  /** DTE at/below which a still-valid but theta-bleeding thesis becomes a roll candidate. Advisory. */
  migrationDte: number;
  /** Sessions held with the thesis NOT progressing before the advisory time-stop fires. */
  timeStopSessions: number;
}

export const SWING_SUBLANE_MANAGE: Record<SwingSubLane, SwingSubLaneManageSpec> = {
  // Tactical: on the cliff by DTE 1; roll horizon by DTE 3; a stalled tactical is dead in ~3 sessions.
  TACTICAL: { id: "TACTICAL", expiryRiskDte: 1, migrationDte: 3, timeStopSessions: 3 },
  // Standard: the balanced lane — a session of runway before the cliff, ~8 sessions of patience.
  STANDARD: { id: "STANDARD", expiryRiskDte: 2, migrationDte: 4, timeStopSessions: 8 },
  // Extended: slow structures / catalyst run-ups — the loosest floors and the longest leash.
  EXTENDED: { id: "EXTENDED", expiryRiskDte: 3, migrationDte: 6, timeStopSessions: 14 },
} as const;

/** Below this thesis-progress (0–1) a position that has run out its time-stop counts as "not
 *  progressing" — the advisory time-stop only fires when we actually KNOW progress is low. */
const TIME_STOP_STAGNANT_PROGRESS = 0.34;

export interface SwingManageInput {
  /** The one thesis carrier — supplies direction, sub-lane and data-quality. */
  dossier: SwingDossier;
  /** Calendar DTE of the held contract. */
  dte?: number | null;
  // ── premium state (caller latches peak + scaledAlready, same split as deriveScaleOutAction) ──
  entryPremium?: number | null;
  peakPremium?: number | null;
  lastMark?: number | null;
  scaledAlready?: boolean;
  // ── underlying / structural (the thesis-primary reads) ──
  /** Current underlying price. */
  underlyingPrice?: number | null;
  /** Structural stop level in UNDERLYING terms (LONG breaks ≤ level, SHORT breaks ≥ level). */
  structuralStopLevel?: number | null;
  /** Archetype-specific thesis-break signal, computed upstream (true = invalidated). */
  thesisBroken?: boolean | null;
  /** Optional human reason for the thesis break. */
  thesisBreakReason?: string;
  // ── advisory evidence reads (each null when unknown → its rung is skipped) ──
  /** A scheduled catalyst resolved / broke against the thesis. */
  catalystShift?: boolean | null;
  /** The broad-market regime flipped against the thesis. */
  regimeShift?: boolean | null;
  /** The accumulation flow that seeded the thesis has faded. */
  flowDecayed?: boolean | null;
  /** The name lost relative-strength leadership vs its benchmark. */
  relStrengthLost?: boolean | null;
  /** IV crush is eating the premium faster than the underlying pays. */
  volCollapsed?: boolean | null;
  /** Sessions the position has been held. */
  sessionsHeld?: number | null;
  /** Thesis progress toward target, 0–1 (drives time-stop + theta-disproportion for migration). */
  thesisProgress01?: number | null;
  /** The position qualifies to add to (advisory add-eligible). */
  addEligible?: boolean | null;
  /** Edge rungs that have graduated to enforced (PR-16 ladder output). Gates ignore this. */
  graduatedRungs?: readonly SwingManageRung[];
}

export interface SwingManageVerdict {
  action: SwingManageAction;
  rung: SwingManageRung;
  /** True for the four capital-preservation gates always; for an edge rung only once graduated. */
  enforced: boolean;
  reason: string;
  /** Low-DTE roll assessment (theta bleeding a still-valid thesis) — always computed. */
  dteMigration: { migrate: boolean; reason: string };
  /** Roll INTENT only (no execution here — PR-15 executes). Always computed. */
  rollIntent: { roll: boolean; reason: string };
}

/** The sub-lane owning this position: the dossier's resolved lane, else derived from live DTE. */
function resolveLane(input: SwingManageInput): SwingSubLane | null {
  if (input.dossier.subLane) return input.dossier.subLane;
  const dte = numOrNull(input.dte);
  return dte != null ? subLaneForDte(dte) : null;
}

/** Did the UNDERLYING break its structural stop? Direction-aware; skipped (broken:false, not
 *  evaluable) when price / stop / direction are missing — never guessed. */
function structuralStopBroken(input: SwingManageInput): { broken: boolean; reason: string } {
  const price = numOrNull(input.underlyingPrice);
  const stop = numOrNull(input.structuralStopLevel);
  const dir = input.dossier.direction;
  if (price == null || stop == null || dir == null) {
    return { broken: false, reason: "no underlying / stop / direction — structural stop not evaluable" };
  }
  if (dir === "LONG" && price <= stop) {
    return { broken: true, reason: `underlying ${price} ≤ structural stop ${stop} — LONG thesis broken in underlying terms` };
  }
  if (dir === "SHORT" && price >= stop) {
    return { broken: true, reason: `underlying ${price} ≥ structural stop ${stop} — SHORT thesis broken in underlying terms` };
  }
  return { broken: false, reason: "underlying holding its structural stop" };
}

function isEnforced(rung: SwingManageRung, graduated?: readonly SwingManageRung[]): boolean {
  if (GATING_RUNGS.has(rung)) return true; // capital preservation never waits on graduation
  if (rung === "hold" || rung === "insufficient_data") return false;
  return (graduated ?? []).includes(rung); // edge rung: evidence-only until graduated
}

/**
 * Low-DTE roll assessment: at/below the lane's migration horizon, if the option is decaying FASTER
 * than the thesis is progressing (theta disproportion) while the thesis is still valid, the position
 * is a roll candidate — you'd rather buy time-in-thesis than watch theta bleed a right idea. Returns
 * migrate:false (honest, with a reason) whenever any input is missing or the thesis is already broken
 * (a broken thesis is an exit, not a roll).
 */
export function evaluateDteMigration(input: SwingManageInput): { migrate: boolean; reason: string } {
  const lane = resolveLane(input);
  const spec = lane ? SWING_SUBLANE_MANAGE[lane] : null;
  const dte = numOrNull(input.dte);
  if (!spec || dte == null) return { migrate: false, reason: "no DTE / sub-lane — migration not evaluable" };
  if (dte > spec.migrationDte) return { migrate: false, reason: `DTE ${dte} > migration horizon ${spec.migrationDte} — ample time` };
  if (input.thesisBroken === true) return { migrate: false, reason: "thesis broken — exit, not roll" };

  const entry = numOrNull(input.entryPremium);
  const mark = numOrNull(input.lastMark);
  if (entry == null || entry <= 0 || mark == null) {
    return { migrate: false, reason: "no usable premium — theta disproportion not evaluable" };
  }
  const premiumRatio = mark / entry; // < 1 = the option is bleeding
  const progress = numOrNull(input.thesisProgress01) ?? 0; // absent progress = treated as none advanced
  const decaying = premiumRatio < 1;
  // Theta outpaces thesis when the fraction of premium already lost exceeds the thesis progress made.
  const thetaOutpacingThesis = 1 - premiumRatio > progress;
  if (decaying && thetaOutpacingThesis) {
    return {
      migrate: true,
      reason: `DTE ${dte} ≤ ${spec.migrationDte} and premium at ${premiumRatio.toFixed(2)}× entry decaying faster than thesis progress ${progress.toFixed(2)} — roll to preserve time-in-thesis`,
    };
  }
  return { migrate: false, reason: "no theta-vs-thesis disproportion at low DTE" };
}

/**
 * Roll candidate — INTENT ONLY (execution is PR-15). A roll only makes sense for a still-valid
 * thesis at low DTE with theta disproportion; a broken thesis or a hit structural stop is a CLOSE,
 * not a roll, so those veto the intent.
 */
export function detectRollCandidate(input: SwingManageInput): { roll: boolean; reason: string } {
  const migration = evaluateDteMigration(input);
  if (!migration.migrate) return { roll: false, reason: migration.reason };
  if (input.thesisBroken === true) return { roll: false, reason: "thesis broken — close, do not roll" };
  const sb = structuralStopBroken(input);
  if (sb.broken) return { roll: false, reason: "underlying structural stop hit — close, do not roll" };
  return { roll: true, reason: `roll intent — ${migration.reason} (INTENT ONLY; execution deferred to PR-15)` };
}

/**
 * The management verdict for one open swing. Walks the precedence top-down (capital-preservation
 * gates first, edge rungs after) and returns the first rung that fires, with `enforced` reflecting
 * the gate/edge split. Always attaches the DTE-migration + roll-intent assessments (they are
 * orthogonal signals, surfaced even when a higher rung owns the primary action).
 */
export function evaluateSwingManagement(input: SwingManageInput): SwingManageVerdict {
  const lane = resolveLane(input);
  const spec = lane ? SWING_SUBLANE_MANAGE[lane] : null;
  const dte = numOrNull(input.dte);

  const dteMigration = evaluateDteMigration(input);
  const rollIntent = detectRollCandidate(input);

  const mk = (action: SwingManageAction, rung: SwingManageRung, reason: string): SwingManageVerdict => ({
    action,
    rung,
    enforced: isEnforced(rung, input.graduatedRungs),
    reason,
    dteMigration,
    rollIntent,
  });

  // Premium mechanics via the shared scale-out state machine (never reimplemented). Usable only with
  // a positive entry + finite mark; otherwise deriveScaleOutAction HOLDs and we treat premium as absent.
  const entry = numOrNull(input.entryPremium);
  const mark = numOrNull(input.lastMark);
  const premiumUsable = entry != null && entry > 0 && mark != null;
  const scale = deriveScaleOutAction({
    entryPremium: entry ?? 0,
    peakPremium: numOrNull(input.peakPremium) ?? Math.max(entry ?? 0, mark ?? 0),
    lastMark: mark ?? Number.NaN,
    scaledAlready: input.scaledAlready === true,
  });

  const structural = structuralStopBroken(input);

  // ── 1. expiry_risk (GATE) — the lane's theta cliff ──
  if (spec && dte != null && dte <= spec.expiryRiskDte) {
    return mk("EXIT", "expiry_risk", `DTE ${dte} ≤ ${spec.expiryRiskDte} (${spec.id} theta cliff) — force manage`);
  }

  // ── 2. structural_stop (GATE) — the UNDERLYING broke, at ANY premium P&L ──
  if (structural.broken) {
    return mk("EXIT", "structural_stop", structural.reason);
  }

  // ── 3. thesis_stop (GATE) — archetype-specific invalidation ──
  if (input.thesisBroken === true) {
    return mk("EXIT", "thesis_stop", input.thesisBreakReason ?? "archetype thesis-invalidation signal fired");
  }

  // ── 4. premium_stop (GATE) — the −60% capital backstop (only fires pre-scale, by design) ──
  if (premiumUsable && scale.action === "STOP_OUT") {
    return mk("STOP_OUT", "premium_stop", `capital backstop: ${scale.reason}`);
  }

  // ── 5+. advisory / evidence-only rungs (enforced:false until graduated) ──
  if (input.catalystShift === true) {
    return mk("TAKE_PARTIAL", "catalyst_shift", "catalyst resolved/broke against the thesis — consider trimming into it");
  }
  if (input.regimeShift === true) {
    return mk("TAKE_PARTIAL", "regime_shift", "broad regime flipped against the thesis — consider de-risking");
  }
  // Profit ladder: the scale-out mechanics for a green runner (partial @2×, trail off peak).
  if (premiumUsable && (scale.action === "TAKE_PARTIAL" || scale.action === "EXIT_RUNNER")) {
    return mk(scale.action, "profit_ladder", scale.reason);
  }
  if (input.flowDecayed === true) {
    return mk("TAKE_PARTIAL", "flow_decay", "the accumulation flow that seeded the thesis has faded — consider trimming");
  }
  if (input.relStrengthLost === true) {
    return mk("TAKE_PARTIAL", "rel_strength_loss", "name lost leadership vs its benchmark — consider trimming");
  }
  if (input.volCollapsed === true) {
    return mk("TAKE_PARTIAL", "vol_collapse", "IV crush eating premium faster than the underlying pays — consider trimming");
  }
  const sessionsHeld = numOrNull(input.sessionsHeld);
  const progress = numOrNull(input.thesisProgress01);
  if (
    spec &&
    sessionsHeld != null &&
    sessionsHeld >= spec.timeStopSessions &&
    progress != null &&
    progress < TIME_STOP_STAGNANT_PROGRESS
  ) {
    return mk("EXIT", "time_stop", `held ${sessionsHeld} ≥ ${spec.timeStopSessions} sessions with thesis progress ${progress.toFixed(2)} < ${TIME_STOP_STAGNANT_PROGRESS} — dead-money time-stop`);
  }
  if (input.addEligible === true) {
    return mk("ADD", "add_eligible", "position qualifies to add (advisory)");
  }

  // ── nothing fired ──
  // Null-honesty: if NOTHING was evaluable (no premium, no structural read, no thesis flag, no
  // lane/DTE, no advisory read) we return insufficient_data — a hollow read, not a confident HOLD.
  const anyEvaluable =
    premiumUsable ||
    numOrNull(input.underlyingPrice) != null ||
    input.thesisBroken != null ||
    (spec != null && dte != null) ||
    input.catalystShift != null ||
    input.regimeShift != null ||
    input.flowDecayed != null ||
    input.relStrengthLost != null ||
    input.volCollapsed != null ||
    sessionsHeld != null ||
    input.addEligible != null;
  if (!anyEvaluable) {
    return mk("HOLD", "insufficient_data", "no usable management read — holding (null-honesty)");
  }
  return mk("HOLD", "hold", `thesis intact, premium above the ${SCALE_OUT_RULES.hard_stop_mult}× backstop, ample time — hold`);
}
