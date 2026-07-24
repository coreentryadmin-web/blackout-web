/**
 * Night Hawk — horizon spine (the 3-lane remodel foundation).
 *
 * ONE engine, THREE horizons, differentiated ONLY by the parameters in this file. Every lane runs the
 * same pipeline — whole-market scan → score → pick contract → exit engine → grade → ledger — and this
 * module is the per-lane configuration that pipeline reads. It is the single source of truth for "what
 * is a 0DTE / Swing / LEAPS play," so the remodel never hard-codes a DTE cutoff or an exit rule in the
 * scan/plan/UI code again.
 *
 * DTE windows (operator-set 2026-07-23):
 *   0DTE  — same-day plays. Window [0,1] DTE: expiry today is the target; 1-DTE is folded into the
 *           shortest bucket so there is no coverage gap. A name only appears in this lane if it lists a
 *           contract in range (index/ETF daily expiries every day; every weekly-optionable name on its
 *           Friday) AND clears a hard liquidity gate.
 *   SWING — 2–30 DTE.
 *   LEAPS — 31–90 DTE (90 max). NOTE: at ≤90 DTE this is a position / catalyst play, not a multi-year
 *           LEAPS — the contract stance is tuned for that (see `contract`). We keep the operator's name.
 *   Anything >90 DTE is out of scope and maps to no lane.
 *
 * Exit routing — the repo already has TWO proven, backtested exit primitives whose own headers warn they
 * must NOT be cross-applied. This spine's job is to route each horizon to the correct one by DTE:
 *   RATCHET   — src/lib/zerodte/exit-engine.ts (`EXIT_RULES`): fast, fixed −50/+100, ratchet-arm / lock /
 *               flat-timeout. Correct for 0DTE theta decay.
 *   SCALE_OUT — src/lib/zerodte/scale-out.ts (`SCALE_OUT_RULES`): partial @2× + trail 50% of peak + hard
 *               stop. The positive-skew spine, correct for multi-day holds (Swing + LEAPS).
 *
 * Score floors — 0DTE's 65 is EVIDENCE-BACKED (see src/lib/zerodte/calibration.ts band record: sub-65
 * bands run net-negative EV on live grades). Swing/LEAPS floors are PROVISIONAL and must GRADUATE on
 * their own backtest evidence before they size real risk (`scoreFloorGraduated: false`). This is the
 * repo's calibration-first law made explicit per lane — a provisional floor is a placeholder, not a claim.
 */

export type Horizon = "ZERO_DTE" | "SWING" | "LEAPS";

/** Which of the two proven exit primitives a horizon routes to. */
export type ExitPrimitive = "RATCHET" | "SCALE_OUT";

/** Bar timeframe the grader walks over the hold. */
export type GraderTimeframe = "minute" | "hour" | "day";

/** How often a lane re-scans on the live desk. */
export type RefreshCadence = "live" | "daily";

export interface ContractPreference {
  /** Target absolute delta for the primary contract at this horizon. */
  targetDelta: number;
  /** Acceptable absolute-delta band [min, max] the contract picker may accept around the target. */
  deltaBand: [number, number];
  /** One-line human description of the instrument stance for the lane. */
  note: string;
}

export interface HorizonSpec {
  id: Horizon;
  /** UI tab label (replaces "Today's plays" / "Tonight's playbook"). */
  label: string;
  /** Short mono code for badges. */
  tag: string;
  /** Human hold-time descriptor. */
  holdLabel: string;
  /** Inclusive calendar-DTE window. A contract fits this lane iff dteMin <= dte <= dteMax. */
  dteMin: number;
  dteMax: number;
  /** The exit primitive this horizon routes to. */
  exit: ExitPrimitive;
  /** Commit threshold on the 0–100 conviction score. */
  scoreFloor: number;
  /**
   * True only when `scoreFloor` is calibration-graduated (backed by real graded evidence). False marks a
   * PROVISIONAL floor that must not be treated as validated — the lane graduates it via its own backtest.
   */
  scoreFloorGraduated: boolean;
  /** Bar timeframe the grader uses over the hold. */
  grader: GraderTimeframe;
  /** Live-desk re-scan cadence. */
  refresh: RefreshCadence;
  /** Default contract stance for the lane. */
  contract: ContractPreference;
}

export const HORIZONS: Record<Horizon, HorizonSpec> = {
  ZERO_DTE: {
    id: "ZERO_DTE",
    label: "0DTE",
    tag: "0DTE",
    holdLabel: "minutes–hours",
    dteMin: 0,
    dteMax: 1,
    exit: "RATCHET",
    scoreFloor: 65,
    scoreFloorGraduated: true, // evidence-backed: calibration.ts band record, sub-65 = net-negative EV
    grader: "minute",
    refresh: "live",
    contract: {
      targetDelta: 0.5,
      deltaBand: [0.4, 0.6],
      note: "ATM/near, shortest listed expiry; hard liquidity gate so a thin small-cap weekly can't print",
    },
  },
  SWING: {
    id: "SWING",
    label: "Swing",
    tag: "SWING",
    holdLabel: "days–weeks",
    dteMin: 2,
    dteMax: 30,
    exit: "SCALE_OUT",
    scoreFloor: 60,
    scoreFloorGraduated: false, // PROVISIONAL — graduates on the whole-market banger backtest
    grader: "hour",
    refresh: "live",
    contract: {
      // DIRECTIONAL stance (PR-4, SEV-4/FM#5): 0.60Δ near-the-money, band [0.50,0.75]. This REPLACES
      // the old 0.35Δ / [0.25,0.50] "cheap OTM banger" stance — a multi-session thesis wants an
      // instrument that TRACKS the underlying with less premium-decay drag and better breakeven
      // headroom, not a low-delta lotto. The per-sub-lane bands (taxonomy.ts SWING_SUB_LANES) refine
      // this; this lane-level fallback is the default when no sub-lane is resolved. Scale-out exit unchanged.
      targetDelta: 0.6,
      deltaBand: [0.5, 0.75],
      note: "0.50–0.75Δ directional call/put that tracks the underlying over the swing hold; positive-skew scale-out exit",
    },
  },
  LEAPS: {
    id: "LEAPS",
    label: "LEAPS",
    tag: "LEAPS",
    holdLabel: "weeks–months (≤90d)",
    dteMin: 31,
    dteMax: 90,
    exit: "SCALE_OUT",
    scoreFloor: 62,
    scoreFloorGraduated: false, // PROVISIONAL — graduates on the LEAPS/position backtest
    grader: "day",
    refresh: "daily",
    contract: {
      targetDelta: 0.6,
      deltaBand: [0.5, 0.72],
      note: "ATM-to-slightly-ITM monthly, catalyst-timed (a ≤90d position play, not multi-year stock replacement)",
    },
  },
};

/** Display / iteration order for the three lanes (fast → slow). */
export const HORIZON_ORDER: Horizon[] = ["ZERO_DTE", "SWING", "LEAPS"];

/**
 * The horizon a given calendar DTE falls into, or null if it is outside every lane (>90 DTE, or a
 * negative/non-finite DTE). Windows are contiguous and non-overlapping, so at most one lane ever matches.
 */
export function horizonForDte(dte: number): Horizon | null {
  if (!Number.isFinite(dte) || dte < 0) return null;
  for (const id of HORIZON_ORDER) {
    const h = HORIZONS[id];
    if (dte >= h.dteMin && dte <= h.dteMax) return id;
  }
  return null;
}

/** Does a listed expiry (in calendar DTE) qualify for this horizon's window? */
export function dteFitsHorizon(dte: number, horizon: Horizon): boolean {
  const h = HORIZONS[horizon];
  return Number.isFinite(dte) && dte >= h.dteMin && dte <= h.dteMax;
}

/** All three horizon specs in display order — the fan-out set a candidate is evaluated against. */
export function allHorizons(): HorizonSpec[] {
  return HORIZON_ORDER.map((id) => HORIZONS[id]);
}

/** Convenience: the exit primitive a horizon routes to. */
export function exitPrimitiveFor(horizon: Horizon): ExitPrimitive {
  return HORIZONS[horizon].exit;
}
