// 0DTE EXIT ENGINE (B-8, docs/audit/0DTE-BREAKTHROUGH-LEDGER.md) — the pure,
// deterministic "when do we get OUT" core. NO LLM in this path, no IO, no clock
// reads: everything arrives as input and the answer is a machine-readable decision,
// so the same tick is replayable in tests and auditable after the fact. The user's
// directive this file enforces: "never make a green trade turn red; if the thesis
// or logic breaks, enforce the exit strongly; everything should have a valid reason."
//
// Four rule families:
//   1. PROFIT RATCHET — an ACTIVATION-THRESHOLD floor (not a literal never-red lock
//      at +1%, which would scratch every winner into 0DTE noise — contracts oscillate
//      ±15% doing nothing): peak P&L ≥ +25% arms a breakeven floor; ≥ +50% raises it
//      to +20%; after a TRIM the runner's floor is +50%. The floor derives from the
//      LATCHED PEAK, so it is monotonic by construction — a retracing mark can never
//      lower it, only breach it.
//   2. THESIS-BREAK — unconditional and independent of P&L: a Cortex VETO-class
//      evidence item against the play, or ≥2 opposing items whose combined decayed
//      weight exceeds the entry's committed score margin, exits at market even at a
//      loss. A broken thesis is exited, not hoped on.
//   3. FLAT-TIMEOUT — ≥25 minutes inside the ±10% band is not "still working", it is
//      theta bleed: on 0DTE flat = losing, and a small scratch beats certain decay.
//   4. PLAN STOP/TARGET — the printed plan stays authoritative: stop exits, target
//      trims first (banks half) and exits the runner if already trimmed.
//
// PRECEDENCE (checked in this order — WHY documented per step):
//   protective exit (plan stop vs ratchet floor, whichever sits at the HIGHER mark)
//     > thesis break > plan target > flat timeout > hold.
//   - Protective exits first because they are the capital-preservation rules; when
//     both the stop and a ratchet floor are breached on the same tick, the HIGHER of
//     the two exit marks is the one that actually bounded the loss/protected the
//     profit, so its reason is the honest label for the exit that happened.
//   - Thesis break outranks the target: evidence that the play is WRONG beats a
//     rule that says "let it run" — taking the market price now is the strong-exit
//     enforcement the user asked for, and it fires at any P&L.
//   - Flat timeout last among the exits: it only exists for plays no other rule has
//     an opinion about (never reached when a stop/floor/thesis/target already fired).
//
// Missing data NEVER exits: no mark / no entry premium / no evidence → the engine
// holds (and keeps reporting the armed floor). Exits happen on observed numbers only.
//
// PROFIT-MANAGEMENT MODE (A/B, `exitMode`): family 1 above is the SHIPPED ratchet, the
// default. A second, DEFAULT-OFF family — `trim_scale` — replaces the ratchet floor with
// the E5-measured ⅓@+25% / ⅓@+50% / run-the-last-⅓ partial scale-out (regime-conditioned;
// see DEFAULT_EXIT_MODE / TRIM_SCALE_RULES / decideTrimScale). Families 2–4 (thesis break,
// flat timeout, plan stop/target) are shared by both modes; only HOW profit is taken
// changes. The trim graduates on the LIVE-ledger counterfactual grader, not an offline
// flip — the operator selects it via config; this leaf never reads an env or a clock.

import type { EvidenceItem } from "@/lib/nighthawk/cortex/types";
import { pinnedLivePnlPct } from "./marks-math";

/** v1 exit constants (B-8: "thresholds are v1 constants; the counterfactual exit
 *  grader measures scratched-winner cost vs saved-losses and tunes them with data"). */
export const EXIT_RULES = {
  /** Peak P&L % that ARMS the ratchet (floor at breakeven). Below this the trade is
   *  still inside 0DTE noise and gets room to work. */
  ratchet_arm_pnl_pct: 25,
  /** The armed floor: breakeven — a trade that reached +25% may never finish red. */
  ratchet_arm_floor_pct: 0,
  /** Peak P&L % that LOCKS profit: floor rises from breakeven to +20%. */
  ratchet_lock_pnl_pct: 50,
  ratchet_lock_floor_pct: 20,
  /** Post-TRIM runner floor: half is banked at target; the rest never gives back
   *  more than down to +50% of the remaining position's basis. */
  runner_floor_pct: 50,
  /** Flat-timeout: age ≥ this AND the play never left the ±band → theta bleed exit. */
  flat_timeout_min: 25,
  flat_band_pct: 10,
  /** Thesis-break via opposing (non-veto) evidence needs at least this many items —
   *  one contrary reading is a data point, a cluster is a broken thesis. */
  thesis_min_opposes: 2,
  /** Noise floor for the opposing-weight margin when the entry's committed Cortex
   *  score is unknown/zero: two microscopic decayed opposes (< this combined) are
   *  residue, not evidence. Same scale as compose.ts's decayed weights. */
  thesis_min_oppose_weight: 0.5,
} as const;

// ── EXIT MODE (A/B, default the shipped ratchet) ──────────────────────────────────
// The profit-management family is selectable. `ratchet` is the SHIPPED breakeven-
// floor ratchet above — unchanged live behavior, the default. `trim_scale` is the
// E5-measured replacement (FINDINGS 2026-07-23): a partial SCALE-OUT — trim ⅓ at
// +25%, trim ⅓ at +50%, then run the last ⅓ to the plan rails. That schedule beat
// BOTH pure-hold and the shipped floor-exit in EVERY split (calib+valid) and BOTH
// universes (all-names + index-only), lifting win-rate 32%→50%:
//   HOLD                  -0.8% calib / -12.1% valid / -3.7% all / 33% win
//   shipped floor arm+25   -4.4% / -10.1% / -5.8% / 32%
//   trim ⅓@25 + ⅓@50, run  +0.6% /  -4.4% / -0.7% / 50%   ← dominates every window
// The floor-exit dumps the WHOLE runner on a dip to breakeven (scratching momentum);
// a partial trim banks into strength while letting the rest run — positive-skew-
// preserving, the same edge as the banger scale-out.
//
// DEFAULT-OFF, DELIBERATELY: `DEFAULT_EXIT_MODE` stays "ratchet". FINDINGS is explicit
// that the trim is not to be flipped off the offline backtest alone — it graduates on
// the LIVE-ledger counterfactual grader (the same calibration-first ladder as
// confluence/accumulation/scale-out). The mode is a per-call input so the sim can A/B
// it and the operator can flip it (env-driven, in the IO shell — exit-sync.ts) once
// signed off, WITHOUT this pure leaf ever reading a clock or an env.
export type ZeroDteExitMode = "ratchet" | "trim_scale";
export const DEFAULT_EXIT_MODE: ZeroDteExitMode = "ratchet";

/** Day regime that conditions the trim-scale schedule. `neutral` is the E5-measured
 *  base; `trend` lets a runner run (later/looser trims — don't scratch a trend-day
 *  momentum leg); `range`/chop banks sooner (theta + mean-reversion punish the runner). */
export type ZeroDteRegime = "trend" | "neutral" | "range";

export const TRIM_SCALE_RULES = {
  /** Fraction of the ORIGINAL position banked at each of the two trim tranches; the
   *  remainder (the last ⅓) runs to the plan rails. ⅓/⅓/⅓ is the E5-measured split. */
  tranche_fraction: 1 / 3,
  /** Regime-conditioned tranche thresholds — the PEAK P&L % that arms each trim.
   *  `neutral` is the exact E5-measured winner (+25%, +50%). `trend`/`range` are the
   *  documented conditioning spread AROUND that base: v1 heuristics (like the ratchet's
   *  own "v1 constants tuned with data"), calibrated on the live ledger before they size
   *  real risk. Both tranches sit BELOW the +100% plan target, so the ladder always
   *  banks its two thirds before the target rule takes the runner. */
  tranches_by_regime: {
    trend: [40, 80],
    neutral: [25, 50],
    range: [20, 40],
  },
} as const satisfies Record<"tranche_fraction", number> & {
  tranches_by_regime: Record<ZeroDteRegime, readonly [number, number]>;
};

export type ExitAction = "HOLD" | "RAISE_FLOOR" | "TRIM" | "EXIT";

export type ExitDecision = {
  action: ExitAction;
  /** The active protective floor in P&L % terms (null = no floor armed). Populated
   *  on EVERY decision so consumers can render "floor: +20%" even on a HOLD. */
  floorPnlPct: number | null;
  /** Machine-readable snake_case reason — persisted, grepped, never prose. */
  reason: string;
  /** One human sentence arguing the decision with the actual numbers. */
  detail: string;
};

export type ExitEngineInput = {
  /** PINNED ledger entry premium — the only entry reference P&L may use. */
  entryPremium: number | null;
  /** Freshest usable mark (live-marks lane preferred, sync snapshot fallback). */
  currentMark: number | null;
  /** Latched peak premium since flag (widened with currentMark internally). */
  peakPremium: number | null;
  /** Minutes since first flag. */
  ageMinutes: number | null;
  /** Cortex evidence for the play's OWN direction (vetoes+opposes+supports, decayed
   *  weights) — null when the Cortex could not see this tick (thesis check skipped;
   *  everything else still runs — missing data never exits). */
  cortexEvidence: EvidenceItem[] | null;
  /** Plan stop/target premiums (plan.ts rules applied to the pinned entry). */
  planStop: number | null;
  planTarget: number | null;
  /** Current lifecycle status (derivePlayStatus). CLOSED rows are never re-decided. */
  status: string | null;
  /** True once the play has trimmed (status TRIM is sticky via the peak latch). */
  trimmed: boolean;
  /** The entry's committed Cortex score (entry_context.cortex.score) — the cushion
   *  the thesis was bought with; opposing weight must exceed it to break the thesis.
   *  Null/absent → the thesis_min_oppose_weight noise floor is the margin. */
  entryCortexScore?: number | null;
  /** Profit-management family (A/B). Omitted → DEFAULT_EXIT_MODE ("ratchet", the
   *  shipped floor-exit). "trim_scale" selects the E5 ⅓@+25% / ⅓@+50% / run scale-out. */
  exitMode?: ZeroDteExitMode;
  /** Day regime that conditions the trim-scale tranche thresholds (trim_scale only;
   *  ignored in ratchet mode). Omitted → "neutral" (the E5-measured base schedule). */
  regime?: ZeroDteRegime | null;
  /** How many trim-scale tranches the caller has ALREADY banked (0/1/2) — the latch
   *  the two-stage scale-out needs, same pattern as `trimmed` for the ratchet runner.
   *  trim_scale only; omitted → 0. Ignored in ratchet mode. */
  trimsTaken?: number;
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const fmtPct = (n: number | null) => (n == null ? "?" : `${n > 0 ? "+" : ""}${round2(n)}%`);

/**
 * The monotonic protective floor (P&L %) for a given PEAK P&L. Pure function of the
 * latched peak (which only ever grows) + the trim latch, so the floor can never
 * lower — the "monotonic ratchet" property is structural, not remembered state.
 */
export function ratchetFloorPct(peakPnlPct: number | null, trimmed: boolean): number | null {
  // Post-trim runner: +50% floor dominates every ratchet tier (20 < 50), so the
  // trim latch alone decides — a trimmed play's floor is never below +50%.
  if (trimmed) return EXIT_RULES.runner_floor_pct;
  if (peakPnlPct == null) return null;
  if (peakPnlPct >= EXIT_RULES.ratchet_lock_pnl_pct) return EXIT_RULES.ratchet_lock_floor_pct;
  if (peakPnlPct >= EXIT_RULES.ratchet_arm_pnl_pct) return EXIT_RULES.ratchet_arm_floor_pct;
  return null;
}

/** The snake_case reason for a floor breach/arm at this floor level. */
function floorReason(floor: number, trimmed: boolean): string {
  if (trimmed) return "runner_floor";
  return floor >= EXIT_RULES.ratchet_lock_floor_pct ? "ratchet_profit_floor" : "ratchet_breakeven_floor";
}

/**
 * How many trim-scale tranches the LATCHED PEAK has armed (0/1/2) under the regime
 * schedule. Pure function of the monotonic peak — the same structural property as
 * ratchetFloorPct: a retracing mark can never DIS-arm a tranche the peak already
 * reached, so "banked ⅓ at +25%" is remembered by the peak, not by mutable state.
 */
export function trimTranchesArmed(peakPnlPct: number | null, regime: ZeroDteRegime): number {
  if (peakPnlPct == null) return 0;
  const thresholds = TRIM_SCALE_RULES.tranches_by_regime[regime];
  let n = 0;
  for (const t of thresholds) if (peakPnlPct >= t) n += 1;
  return n;
}

export type ThesisBreak = {
  /** The evidence source that broke the thesis (veto source, or the heaviest oppose). */
  source: string;
  /** "veto" or "opposing cluster" — which arm of the rule fired. */
  kind: "veto" | "oppose_cluster";
  detail: string;
};

/**
 * Thesis-break detection over the play-direction Cortex evidence. The evidence is
 * composed FOR the play's own direction, so stance is already relative to the play:
 * a "veto" item IS a direction-opposing hard fact (one loud contrary fact can kill
 * a thesis — same veto asymmetry as entry), and "opposes" items are the soft
 * contrary readings that must CLUSTER (≥2) past the entry's committed score margin
 * before they outweigh the cushion the play was entered with.
 */
export function detectThesisBreak(
  evidence: EvidenceItem[] | null,
  entryCortexScore: number | null | undefined
): ThesisBreak | null {
  if (evidence == null) return null; // Cortex can't see → thesis check skipped, never an exit
  const veto = evidence.find((e) => e.stance === "veto");
  if (veto) {
    return { source: veto.source, kind: "veto", detail: `[${veto.source}] ${veto.detail}` };
  }
  const opposes = evidence.filter((e) => e.stance === "opposes" && e.weight > 0);
  if (opposes.length < EXIT_RULES.thesis_min_opposes) return null;
  const combined = round2(opposes.reduce((acc, o) => acc + o.weight, 0));
  // The margin is the cushion the entry was committed with (its net Cortex score);
  // when that is unknown or ~0, the noise floor keeps two microscopic decayed
  // opposes from scratching a healthy play.
  const margin = Math.max(entryCortexScore ?? 0, EXIT_RULES.thesis_min_oppose_weight);
  if (combined <= margin) return null;
  const top = [...opposes].sort((a, b) => b.weight - a.weight)[0]!;
  return {
    source: top.source,
    kind: "oppose_cluster",
    detail:
      `${opposes.length} opposing readings, combined weight ${combined} > entry margin ${round2(margin)} — ` +
      `strongest: [${top.source}] ${top.detail}`,
  };
}

/**
 * The trim-scale profit-management decision (EXIT_MODE "trim_scale"): the E5-measured
 * ⅓@+25% / ⅓@+50% / run-the-last-⅓ scale-out, regime-conditioned. Precedence MIRRORS
 * the ratchet path — protective plan stop > thesis break > profit management (the two
 * trim tranches + the runner's target) > flat timeout > hold — so the ONLY thing that
 * changes between modes is HOW profit is taken: partial trims into strength here vs the
 * single dump-to-breakeven floor-exit in ratchet mode. Called only after
 * evaluateExitState's shared guards + no-mark guard, so mark/entry/pnl are non-null.
 *
 * DELIBERATELY no trailing stop on the runner: the P3 exit study proved trailing/ratchet
 * HURTS same-day 0DTE (intraminute chop stops you out before the move completes —
 * scale-out.ts's own HORIZON NOTE). We reuse the partial-SCALE MECHANISM from
 * scale-out.ts (bank strength in fractional tranches), NOT its weekly trailing stop; the
 * last third runs to the plan target/stop/time-stop like any 0DTE runner.
 */
function decideTrimScale(
  input: ExitEngineInput,
  ctx: { entryPremium: number; currentMark: number; pnlPct: number; peakPnlPct: number | null }
): ExitDecision {
  const { currentMark, pnlPct, peakPnlPct } = ctx;
  const regime: ZeroDteRegime = input.regime ?? "neutral";
  const thresholds = TRIM_SCALE_RULES.tranches_by_regime[regime];
  // How many thirds the caller has already banked (clamped/floored — the latch is 0/1/2).
  const taken = Math.max(0, Math.min(thresholds.length, Math.floor(input.trimsTaken ?? 0)));

  // 1. Protective: the plan stop is the runner's only hard floor in this mode — the trims
  //    already banked the profit, so the last third simply rides the printed stop.
  if (input.planStop != null && currentMark <= input.planStop) {
    return {
      action: "EXIT",
      floorPnlPct: null,
      reason: "plan_stop",
      detail: `Mark ${currentMark} (${fmtPct(pnlPct)}) is at/below the plan stop ${input.planStop} — the printed stop is authoritative.`,
    };
  }

  // 2. Thesis break: the play is WRONG → dump the WHOLE remaining position at any P&L
  //    (outranks banking another third — same veto asymmetry as the ratchet path).
  const broken = detectThesisBreak(input.cortexEvidence, input.entryCortexScore);
  if (broken) {
    return {
      action: "EXIT",
      floorPnlPct: null,
      reason: `thesis_break:${broken.source}`,
      detail: `Thesis broken (${broken.kind}) at ${fmtPct(pnlPct)} — exiting the remaining position at market, not hoping: ${broken.detail}`,
    };
  }

  // 3. Trim ladder: the LATCHED PEAK arms tranches monotonically; bank the next third
  //    whenever the peak has armed more than the caller has already taken. One third per
  //    tick until caught up (same one-step-per-tick catch-up as the ratchet trim latch).
  const armed = trimTranchesArmed(peakPnlPct, regime);
  if (armed > taken) {
    const trancheIdx = taken + 1; // banking the 1st or 2nd third now
    const at = thresholds[taken]!;
    const pctEach = Math.round(TRIM_SCALE_RULES.tranche_fraction * 100);
    return {
      action: "TRIM",
      floorPnlPct: null,
      reason: trancheIdx === 1 ? "trim_scale_first" : "trim_scale_second",
      detail:
        `Peak ${fmtPct(peakPnlPct)} armed trim ${trancheIdx}/2 (+${at}%, regime ${regime}) — bank ${pctEach}% ` +
        `into strength and run the rest (E5 scale-out: don't scratch a momentum runner at breakeven).`,
    };
  }

  // 4. Runner target: both thirds banked and the last third tags +100% → bank it in full.
  if (taken >= thresholds.length && input.planTarget != null && currentMark >= input.planTarget) {
    return {
      action: "EXIT",
      floorPnlPct: null,
      reason: "trim_scale_runner_target",
      detail: `Mark ${currentMark} (${fmtPct(pnlPct)}) tagged the target ${input.planTarget} after both trims — the last third is banked in full.`,
    };
  }

  // 5. Flat timeout: the SAME theta-bleed scratch as the ratchet path (a play that never
  //    armed a tranche can still bleed out flat). Unreachable once a tranche armed — that
  //    needs peak ≥ +20%, which fails the peak < ±band condition below.
  if (
    input.ageMinutes != null &&
    input.ageMinutes >= EXIT_RULES.flat_timeout_min &&
    (peakPnlPct ?? 0) < EXIT_RULES.flat_band_pct &&
    pnlPct > -EXIT_RULES.flat_band_pct
  ) {
    return {
      action: "EXIT",
      floorPnlPct: null,
      reason: "flat_theta_bleed",
      detail:
        `${Math.floor(input.ageMinutes)}min in and the play never left the ±${EXIT_RULES.flat_band_pct}% band ` +
        `(peak ${fmtPct(peakPnlPct)}, now ${fmtPct(pnlPct)}) — on 0DTE flat is losing; a small scratch beats theta decay.`,
    };
  }

  // 6. Nothing fires: report the ladder state — thirds banked so far + the next arm level.
  if (taken > 0) {
    return {
      action: "RAISE_FLOOR",
      floorPnlPct: null,
      reason: "trim_scale_running",
      detail:
        `${taken}/2 thirds banked (regime ${regime}); running the last third at ${fmtPct(pnlPct)} ` +
        `(peak ${fmtPct(peakPnlPct)}) to the plan target/stop.`,
    };
  }
  return {
    action: "HOLD",
    floorPnlPct: null,
    reason: "hold",
    detail: `No trim armed yet at ${fmtPct(pnlPct)} (peak ${fmtPct(peakPnlPct)}); next trim at +${thresholds[0]}% (regime ${regime}).`,
  };
}

/**
 * THE exit decision for one open play at one tick. Pure and total: every input
 * combination returns exactly one decision with a reason — see the module doc for
 * the rule families and the precedence order (and WHY it is that order).
 */
export function evaluateExitState(input: ExitEngineInput): ExitDecision {
  const { entryPremium, currentMark } = input;
  const mode = input.exitMode ?? DEFAULT_EXIT_MODE;

  // ── Guards: never re-decide a closed row; never exit on missing data. ──────────
  if (input.status === "CLOSED") {
    return { action: "HOLD", floorPnlPct: null, reason: "already_closed", detail: "Play is already closed — terminal." };
  }
  if (entryPremium == null || entryPremium <= 0) {
    return {
      action: "HOLD",
      floorPnlPct: null,
      reason: "no_entry_premium",
      detail: "No pinned entry premium — P&L is underivable, so no exit rule may fire.",
    };
  }

  // Peak is widened with the current mark so the floor derivation can never see a
  // peak below the mark it is judging (the DB latch does the same GREATEST).
  const peakPremium =
    input.peakPremium != null && currentMark != null
      ? Math.max(input.peakPremium, currentMark)
      : (input.peakPremium ?? currentMark);
  const pnlPct = pinnedLivePnlPct(entryPremium, currentMark);
  const peakPnlPct = pinnedLivePnlPct(entryPremium, peakPremium);
  // The ratchet floor only exists in ratchet mode; trim_scale banks profit in tranches
  // and rides the plan stop, so it has no ratchet floor to report (null).
  const floor = mode === "ratchet" ? ratchetFloorPct(peakPnlPct, input.trimmed) : null;

  if (currentMark == null || pnlPct == null) {
    return {
      action: "HOLD",
      floorPnlPct: floor,
      reason: "no_live_mark",
      detail: "No usable live mark this tick — exits fire on observed prices only.",
    };
  }

  // trim_scale (A/B, default-off): the E5 ⅓@+25% / ⅓@+50% / run scale-out replaces the
  // ratchet's floor-exit. Shared guards + no-mark guard above still apply; only the
  // profit-taking family differs. mark/entry/pnl are all non-null past this point.
  if (mode === "trim_scale") {
    return decideTrimScale(input, { entryPremium, currentMark, pnlPct, peakPnlPct });
  }

  // ── 1. Protective exits: plan stop vs ratchet floor — the HIGHER mark wins. ────
  // Both rules cap damage; when both are breached on one tick, the higher exit
  // level is the one that actually protected more (a breakeven floor at entry ≫
  // the −50% stop), so its reason labels the exit.
  const stopBreached = input.planStop != null && currentMark <= input.planStop;
  const floorBreached = floor != null && pnlPct <= floor;
  if (stopBreached || floorBreached) {
    const floorMark = floor != null ? entryPremium * (1 + floor / 100) : null;
    const useFloor =
      floorBreached && (!stopBreached || (floorMark != null && floorMark >= (input.planStop as number)));
    if (useFloor) {
      const reason = floorReason(floor!, input.trimmed);
      return {
        action: "EXIT",
        floorPnlPct: floor,
        reason,
        detail:
          `Mark ${currentMark} (${fmtPct(pnlPct)}) is at/below the ${fmtPct(floor)} floor armed by a ` +
          `${fmtPct(peakPnlPct)} peak — the ratchet exits so the green trade cannot finish red.`,
      };
    }
    return {
      action: "EXIT",
      floorPnlPct: floor,
      reason: "plan_stop",
      detail: `Mark ${currentMark} (${fmtPct(pnlPct)}) is at/below the plan stop ${input.planStop} — the printed stop is authoritative.`,
    };
  }

  // ── 2. Thesis break: unconditional, fires at ANY P&L (including a loss). ───────
  const broken = detectThesisBreak(input.cortexEvidence, input.entryCortexScore);
  if (broken) {
    return {
      action: "EXIT",
      floorPnlPct: floor,
      reason: `thesis_break:${broken.source}`,
      detail:
        `Thesis broken (${broken.kind}) at ${fmtPct(pnlPct)} — exiting at market, not hoping: ${broken.detail}`,
    };
  }

  // ── 3. Plan target: trim first (bank half), exit the runner if already trimmed. ─
  if (input.planTarget != null && currentMark >= input.planTarget) {
    if (input.trimmed) {
      return {
        action: "EXIT",
        floorPnlPct: floor,
        reason: "plan_target_final",
        detail: `Mark ${currentMark} (${fmtPct(pnlPct)}) tagged the target ${input.planTarget} again after the trim — runner banked in full.`,
      };
    }
    return {
      action: "TRIM",
      floorPnlPct: EXIT_RULES.runner_floor_pct,
      reason: "plan_target_trim",
      detail:
        `Mark ${currentMark} (${fmtPct(pnlPct)}) is at/above the target ${input.planTarget} — bank half; ` +
        `the runner's floor is now ${fmtPct(EXIT_RULES.runner_floor_pct)}.`,
    };
  }

  // ── 4. Flat timeout: ≥25min inside the ±10% band = theta bleed, scratch it. ────
  // peak < +band means the play NEVER worked (a +12% excursion resets the clock's
  // premise — that play had a pulse); pnl > −band leaves the losing tail to the
  // stop rules, which own it.
  if (
    input.ageMinutes != null &&
    input.ageMinutes >= EXIT_RULES.flat_timeout_min &&
    (peakPnlPct ?? 0) < EXIT_RULES.flat_band_pct &&
    pnlPct > -EXIT_RULES.flat_band_pct
  ) {
    return {
      action: "EXIT",
      floorPnlPct: floor,
      reason: "flat_theta_bleed",
      detail:
        `${Math.floor(input.ageMinutes)}min in and the play never left the ±${EXIT_RULES.flat_band_pct}% band ` +
        `(peak ${fmtPct(peakPnlPct)}, now ${fmtPct(pnlPct)}) — on 0DTE flat is losing; a small scratch beats theta decay.`,
    };
  }

  // ── 5. Nothing fires: report the armed floor (RAISE_FLOOR) or plain hold. ──────
  if (floor != null) {
    return {
      action: "RAISE_FLOOR",
      floorPnlPct: floor,
      reason: input.trimmed ? "runner_floor_set" : `${floorReason(floor, false)}_set`,
      detail: `Floor ${fmtPct(floor)} armed by a ${fmtPct(peakPnlPct)} peak — holding above it (${fmtPct(pnlPct)}).`,
    };
  }
  return {
    action: "HOLD",
    floorPnlPct: null,
    reason: "hold",
    detail: `No exit rule fires at ${fmtPct(pnlPct)} (peak ${fmtPct(peakPnlPct)}) — plan stop/target stand.`,
  };
}

/** Coarse, member-facing category of an exit-engine `reason` — the five families the
 *  board surfaces so a consumer can distinguish (e.g.) a ratchet floor exit from a
 *  target trim, which the raw snake_case reason buries and `closed_reason` alone could
 *  not tell apart (both were null pre-this-change). */
export type ZeroDteExitReasonCategory = "ratchet" | "thesis" | "flat" | "target" | "stop";

/**
 * Map a raw engine `reason` (persisted on entry_context.exit, or a live decision) to its
 * coarse family. Single source of truth for the vocabulary so the board/pane never
 * re-derive it from string prefixes and drift. Returns null for reasons that are not an
 * exit (holds/floor-arms/guards) or an unknown token.
 */
export function categorizeExitReason(
  reason: string | null | undefined
): ZeroDteExitReasonCategory | null {
  if (!reason) return null;
  if (reason.startsWith("thesis_break")) return "thesis";
  if (reason === "plan_stop") return "stop";
  if (reason === "flat_theta_bleed") return "flat";
  // Profit-taking, either mode: the ratchet's plan-target trim/final, and the trim_scale
  // tranche + runner-target exits are all "we banked profit at/toward the target".
  if (reason.startsWith("plan_target") || reason.startsWith("trim_scale")) return "target";
  // The ratchet's breakeven/profit floor + the post-trim runner floor are the ratchet family.
  if (reason.startsWith("ratchet") || reason.startsWith("runner_floor")) return "ratchet";
  return null;
}

/** The counterfactual-grading record persisted into entry_context.exit on an engine
 *  EXIT — enough for the record page to later compute "exits saved X% vs riding to
 *  the close" without a new table (close_price lands on the row via the grader). */
export type ZeroDteExitContext = {
  reason: string;
  detail: string;
  /** The mark the engine exited at (becomes the row's frozen last_mark). */
  mark: number;
  pnl_pct: number | null;
  peak_pnl_pct: number | null;
  /** ISO instant of the decision. */
  at: string;
};

/** Pure assembly of the exit record (rounding at the data layer, per repo rule). */
export function buildExitContext(
  decision: ExitDecision,
  entryPremium: number | null,
  mark: number,
  peakPremium: number | null,
  nowMs: number
): ZeroDteExitContext {
  return {
    reason: decision.reason,
    detail: decision.detail,
    mark: round2(mark),
    pnl_pct: pinnedLivePnlPct(entryPremium, mark),
    peak_pnl_pct: pinnedLivePnlPct(entryPremium, peakPremium),
    at: new Date(nowMs).toISOString(),
  };
}
