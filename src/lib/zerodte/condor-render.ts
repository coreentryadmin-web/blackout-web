// Wave 2 — pure derivations for the iron-condor render (Night Hawk Command Deck left card +
// right terminal). Dependency-free leaf (no IO, no React, no provider imports) so the board
// assembler (mapLedgerRow), the sim feeder, the client adapter, and their tests all share ONE
// derivation of the "price-inside-the-tent" gauge + distance-to-breach math.
//
// WHY THIS EXISTS. Wave 1 shipped is_condor on the payload but left the terminal drawing only a
// neutral "condor-specific view is a later wave" placeholder — a condor row showed no geometry at
// all. A credit iron condor's whole thesis is spatial: the underlying must stay BETWEEN the two
// short strikes (the dealer-defended range it was sold inside of). This module resolves that
// geometry into the render inputs: where spot sits inside the short-strike tent, how many points of
// room remain to each breach, and whether the range is already breached — the honest picture a
// member needs, never a directional long-premium P&L (inverted for a credit structure).
//
// HONEST-SKEW RULE (condor.ts / iron-condor.ts): a condor's win-rate is high (~80-98%) but the tail
// is a defined LOSS on breakout days — negative skew. WR must NEVER be surfaced alone; it is always
// paired with the intraday-breach companion (est_intraday_breach_pct). condorWinRateLine() below
// enforces that pairing so no render can show a flattering bare WR.

/** The condor geometry the payload carries per row (snake_case, a strict subset of CondorPlan —
 *  condor.ts). `spot` is the COMMIT-time underlying pinned in the plan; the live underlying is
 *  threaded separately (the setup's underlying_price) so the tent can mark the CURRENT price. */
export type CondorGeometry = {
  /** Commit-time underlying pinned on the plan (fallback marker when no live spot is available). */
  spot: number | null;
  short_put: number;
  long_put: number;
  short_call: number;
  long_call: number;
  /** Wing width per side in points (short→long) — the defined-risk distance. */
  wing_pts: number;
  /** Net credit received per 1-lot, $ (×100). Null when a leg lacked its quote at commit. */
  net_credit: number | null;
  /** Defined max loss per 1-lot, $. Null without a credit. */
  max_loss: number | null;
  /** Underlying breach levels = the short strikes. A WIN closes STRICTLY inside (lower, upper). */
  breach_lower: number; // short_put
  breach_upper: number; // short_call
  /** Surfaced win-rate estimate (CAPPED at 97 upstream — never a bare 100). Null on a legacy blob. */
  est_win_rate: number | null;
  /** The negative-skew intraday-breach companion (the honest tail). Null unless the shipped geometry. */
  est_intraday_breach_pct: number | null;
};

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/**
 * Validate a raw blob (entry_context.condor, a CondorPlan, or a sim frame's condor object) into the
 * strict CondorGeometry the render needs. The two short strikes (breach_lower/upper) are REQUIRED and
 * must form a real range (lower < upper) — a blob missing them, or with an inverted/degenerate range,
 * yields null so the terminal falls back to the honest "geometry unavailable" state rather than
 * drawing a nonsense tent. Every other field degrades to null independently (rendered "—"), never a
 * fabricated value. Pure + structural — never throws on a malformed shape.
 */
export function condorGeometryFrom(raw: unknown): CondorGeometry | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const breachLower = num(r.breach_lower) ?? num(r.short_put);
  const breachUpper = num(r.breach_upper) ?? num(r.short_call);
  // A real, sellable range requires two distinct, ordered short strikes. Fail closed otherwise.
  if (breachLower == null || breachUpper == null || !(breachLower < breachUpper)) return null;
  return {
    spot: num(r.spot),
    short_put: num(r.short_put) ?? breachLower,
    long_put: num(r.long_put) ?? breachLower,
    short_call: num(r.short_call) ?? breachUpper,
    long_call: num(r.long_call) ?? breachUpper,
    wing_pts: num(r.wing_pts) ?? 0,
    net_credit: num(r.net_credit),
    max_loss: num(r.max_loss),
    breach_lower: breachLower,
    breach_upper: breachUpper,
    est_win_rate: num(r.est_win_rate),
    est_intraday_breach_pct: num(r.est_intraday_breach_pct),
  };
}

/** The resolved "price-inside-the-tent" gauge state for one condor. */
export type CondorTent = {
  /** 0..1 position of `spot` across [breach_lower, breach_upper]; CLAMPED so a breached spot pins to
   *  the edge (0 or 1). Null when there is no spot to place. */
  spotFrac: number | null;
  /** Underlying points of room from spot DOWN to the lower breach (spot − breach_lower). Null w/o spot. */
  roomDown: number | null;
  /** Underlying points of room from spot UP to the upper breach (breach_upper − spot). Null w/o spot. */
  roomUp: number | null;
  /** True when spot is already at/through a short strike — the defended range has FAILED. */
  breached: boolean;
  /** Tent width in underlying points (breach_upper − breach_lower). */
  widthPts: number;
};

/**
 * Resolve the tent gauge from the geometry + a live underlying spot. `liveSpot` is the CURRENT
 * underlying (the setup's underlying_price) when the board carries it; otherwise the caller passes the
 * commit-time `geom.spot` — either way this places the marker honestly and reports the room to each
 * breach. Pure: a null spot leaves spotFrac/room null (the gauge renders the range with no marker,
 * never a guessed position). `breached` is true only with a real spot at/through a short strike.
 */
export function condorTent(geom: CondorGeometry, liveSpot: number | null): CondorTent {
  const width = geom.breach_upper - geom.breach_lower;
  const spot = num(liveSpot);
  if (spot == null || !(width > 0)) {
    return { spotFrac: null, roomDown: null, roomUp: null, breached: false, widthPts: Math.max(0, width) };
  }
  const roomDown = spot - geom.breach_lower;
  const roomUp = geom.breach_upper - spot;
  const breached = spot <= geom.breach_lower || spot >= geom.breach_upper;
  const frac = Math.max(0, Math.min(1, (spot - geom.breach_lower) / width));
  return { spotFrac: frac, roomDown, roomUp, breached, widthPts: width };
}

/** The honest WR line for a condor — win-rate ALWAYS paired with its negative-skew breach companion,
 *  never a flattering bare WR (the honest-skew rule, enforced structurally). Returns the two figures
 *  plus a flag: when the breach rate is absent we still SHOW the WR but flag it so the render captions
 *  the tail as unmeasured rather than implying a free 80-98% edge. */
export type CondorWinRateLine = {
  winRate: number | null;
  breachRatePct: number | null;
  /** True when a WR exists but the breach companion does NOT — the caller must caption the missing tail. */
  breachUnmeasured: boolean;
};

export function condorWinRateLine(geom: Pick<CondorGeometry, "est_win_rate" | "est_intraday_breach_pct">): CondorWinRateLine {
  const winRate = num(geom.est_win_rate);
  const breachRatePct = num(geom.est_intraday_breach_pct);
  return { winRate, breachRatePct, breachUnmeasured: winRate != null && breachRatePct == null };
}
