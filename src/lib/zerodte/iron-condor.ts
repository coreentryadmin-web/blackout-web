/**
 * 0DTE IRON-CONDOR ENGINE — the HIGH-WIN-RATE premium-selling counterpart to the directional board.
 *
 * WHY (docs/audit/0DTE-RESEARCH.md): buying 0DTE options is inherently ~40-50% WR / big-payoff — you
 * need a rare directional move to double. Backtest (25 sessions, SPY/QQQ/IWM) proved the mirror image:
 * SELLING a 0DTE iron condor with short strikes ~±0.6-0.8% from the midday price wins 77-92% of the
 * time, because price stays in a range most days. Same infra, opposite skew — condors win on range
 * days, directional wins on trend days, so the two are naturally hedged.
 *
 * WIN-RATE ← STRIKE WIDTH (measured, 11:00 entry, close settlement):
 *   ±0.40% → 61% | ±0.60% → 77% | ±0.80% → 92% | ±1.00% → 96% | ±1.50% → 100%
 *
 * This module picks the condor's four strikes from spot + the desired win rate, pushed BEYOND the
 * dealer GEX walls (resistance/support) when those sit further out than the width — you sell where
 * price rarely goes. Defined-risk (long wings cap the loss). PURE + testable: no IO, no option quotes
 * (credit/fill come from the live chain at trade time); this is the geometry only.
 *
 * HONEST SKEW WARNING (documented, enforced by the caller's sizing/stop): high WR here is NEGATIVE
 * skew — small credit ~80% of days, a bigger (but DEFINED) loss on the ~10-20% breakout days. WR is
 * real; profitability needs the credit priced right + a breach stop + small size. This module returns
 * geometry + max-risk; it does NOT claim EV without a live credit.
 */

/** Measured width → win-rate map (from the 25-session condor backtest). Exported for the UI/label. */
export const CONDOR_WINRATE_BY_WIDTH: ReadonlyArray<{ width_pct: number; win_rate: number }> = [
  { width_pct: 0.004, win_rate: 61 },
  { width_pct: 0.006, win_rate: 77 },
  { width_pct: 0.008, win_rate: 92 },
  { width_pct: 0.010, win_rate: 96 },
  { width_pct: 0.015, win_rate: 100 },
];

/** Smallest short-strike width whose measured win rate is >= the target. Defaults to the widest
 *  (most conservative) when the target exceeds the table. */
export function widthPctForWinRate(targetWinRate: number): number {
  for (const row of CONDOR_WINRATE_BY_WIDTH) {
    if (row.win_rate >= targetWinRate) return row.width_pct;
  }
  return CONDOR_WINRATE_BY_WIDTH[CONDOR_WINRATE_BY_WIDTH.length - 1]!.width_pct;
}

export type IronCondorLegs = {
  short_put: number;
  long_put: number;
  short_call: number;
  long_call: number;
  /** Actual short-strike distances from spot (%), after wall-pushing + rounding. */
  put_width_pct: number;
  call_width_pct: number;
  /** Wing width in points (per side) — the defined-risk distance short→long. */
  wing_pts: number;
  /** Approx expected win rate from the tighter of the two short widths (measured table, interpolated down). */
  est_win_rate: number;
  /** Max loss per 1-lot spread (per side) in $ — (wing_pts − credit)·100; credit unknown here so this
   *  is the GROSS wing risk (upper bound). The caller subtracts the live credit. */
  gross_wing_risk_per_side: number;
};

/** Standard strike increment for an underlying's price (mirrors listing granularity). */
export function strikeIncrementFor(spot: number): number {
  if (spot < 25) return 0.5;
  if (spot < 100) return 1;
  if (spot < 250) return 2.5;
  return 5;
}

const roundTo = (v: number, inc: number, dir: "up" | "down" | "near"): number => {
  const q = v / inc;
  const r = dir === "up" ? Math.ceil(q) : dir === "down" ? Math.floor(q) : Math.round(q);
  return Number((r * inc).toFixed(4));
};

/** Estimated win rate for a given short-strike width via the measured table (nearest-not-above). */
export function estWinRateForWidth(widthPct: number): number {
  let wr = CONDOR_WINRATE_BY_WIDTH[0]!.win_rate;
  for (const row of CONDOR_WINRATE_BY_WIDTH) {
    if (widthPct >= row.width_pct) wr = row.win_rate;
  }
  return wr;
}

/**
 * Pick the iron-condor legs. Short strikes are the FURTHER of (a) the width for the target win rate
 * and (b) just beyond the dealer wall (call wall = resistance above, put wall = support below), so we
 * sell where both the statistical range AND dealer positioning say price won't go. Wings sit `wingPts`
 * (or `wingPct`·spot) beyond each short for defined risk. Returns null on bad inputs.
 */
export function selectIronCondor(input: {
  spot: number;
  /** Desired win rate (e.g. 80). Mapped to a short-strike width via the measured table. */
  targetWinRate?: number;
  /** Explicit short width override (e.g. 0.007). Takes precedence over targetWinRate. */
  shortWidthPct?: number;
  /** Dealer resistance — short call is pushed to at/above this when it's further than the width. */
  callWall?: number | null;
  /** Dealer support — short put is pushed to at/below this when it's further than the width. */
  putWall?: number | null;
  /** Wing distance in points (defined risk). Defaults to `wingPct`·spot. */
  wingPts?: number;
  /** Wing distance as a fraction of spot when wingPts is absent (default 0.005 = 0.5%). */
  wingPct?: number;
  strikeIncrement?: number;
}): IronCondorLegs | null {
  const { spot } = input;
  if (!(spot > 0) || !Number.isFinite(spot)) return null;
  const inc = input.strikeIncrement ?? strikeIncrementFor(spot);
  const widthPct = input.shortWidthPct ?? widthPctForWinRate(input.targetWinRate ?? 80);
  if (!(widthPct > 0)) return null;

  // Base short strikes from the width, then push BEYOND the walls when those are further out.
  const callWidthTarget = spot * (1 + widthPct);
  const putWidthTarget = spot * (1 - widthPct);
  const shortCallBase = input.callWall != null && Number.isFinite(input.callWall)
    ? Math.max(callWidthTarget, input.callWall)
    : callWidthTarget;
  const shortPutBase = input.putWall != null && Number.isFinite(input.putWall)
    ? Math.min(putWidthTarget, input.putWall)
    : putWidthTarget;

  // Sell the offer beyond price: short call rounds UP, short put rounds DOWN (away from spot).
  const short_call = roundTo(shortCallBase, inc, "up");
  const short_put = roundTo(shortPutBase, inc, "down");
  if (!(short_call > spot) || !(short_put < spot)) return null;

  const wingPts = input.wingPts ?? Math.max(inc, roundTo(spot * (input.wingPct ?? 0.005), inc, "near"));
  const long_call = roundTo(short_call + wingPts, inc, "up");
  const long_put = roundTo(short_put - wingPts, inc, "down");

  // LOWER-BOUND invariant (audit 2026-07-23): the guard above only checks the upper/inversion
  // side (short_call > spot, short_put < spot). On a low-priced underlying the rounded short_put
  // can floor to 0 and long_put go NEGATIVE while both still sit below spot — a malformed,
  // negative-strike "condor" with put_width_pct→1.0 and est_win_rate mislabeled 100. Every real
  // strike must be strictly positive; reject rather than emit a nonsense contract. (Unreachable on
  // today's index/mega-cap 0DTE universe, but load-bearing the moment this geometry is reused on a
  // cheaper banger universe.)
  if (!(short_put > 0) || !(long_put > 0)) return null;

  const call_width_pct = (short_call - spot) / spot;
  const put_width_pct = (spot - short_put) / spot;
  const tighter = Math.min(call_width_pct, put_width_pct);

  return {
    short_put,
    long_put,
    short_call,
    long_call,
    put_width_pct: Number(put_width_pct.toFixed(4)),
    call_width_pct: Number(call_width_pct.toFixed(4)),
    wing_pts: Number((long_call - short_call).toFixed(4)),
    est_win_rate: estWinRateForWidth(tighter),
    gross_wing_risk_per_side: Number(((long_call - short_call) * 100).toFixed(2)),
  };
}
