/**
 * EXECUTION REALISM — quote → fill → spread → slippage (design-review #5, ⭐⭐⭐⭐⭐).
 *
 * This is where otherwise-excellent systems quietly lose money: they grade on an IDEALIZED entry (the mid,
 * or a flow's average fill) and never model what it costs to actually get in and out. On 0DTE especially,
 * the bid/ask spread is the tax that eats the edge — a setup that looks +0.6R on the mid can be flat once
 * you pay half the spread on entry and half on exit.
 *
 * This module makes execution EXPLICIT so grading reflects executable reality:
 *   quoted mid → expected fill (given how aggressively you cross) → actual fill → realized slippage → the
 *   round-trip spread drag folded into P&L.
 *
 * Sign convention: `slippageCost` is always a COST (positive = adverse), whichever side you're on — a BUY
 * paying above mid and a SELL receiving below mid both cost you. PURE & deterministic; the live fill-capture
 * that feeds `fill` in is a separate additive step at the persist/exit points.
 */

export type OptionSide = "BUY" | "SELL"; // BUY = opening a long option (pay toward ask); SELL = short (receive toward bid)

export interface Quote {
  bid: number | null;
  ask: number | null;
  /** Optional explicit mid; else (bid+ask)/2. */
  mid?: number | null;
}

export interface ExecutionInputs {
  quote: Quote;
  side: OptionSide;
  /** The actual fill, when known (from the live capture). Null → only the EXPECTED read is produced. */
  fill?: number | null;
  /** How aggressively the order crosses: 0 = rest at mid, 0.5 = marketable-limit split, 1 = pay full spread.
   *  Default 0.5 — a realistic marketable-limit assumption for a liquid 0DTE contract. */
  aggressiveness?: number;
}

export type ExecutionQuality = "GOOD" | "FAIR" | "POOR";

export interface ExecutionAssessment {
  mid: number | null;
  spread: number | null;
  /** Spread as a fraction of mid — the single best "is this tradeable" number. */
  spreadPct: number | null;
  /** Expected fill given side + aggressiveness. */
  expectedFill: number | null;
  /** Expected slippage COST per share (positive = adverse), = aggressiveness × half-spread. */
  expectedSlippageCost: number | null;
  fill: number | null;
  /** Realized slippage COST per share (positive = adverse): BUY fill−mid, SELL mid−fill. */
  realizedSlippageCost: number | null;
  /** Realized minus expected (negative = executed BETTER than assumed). */
  slippageVsExpected: number | null;
  /** Round-trip spread drag as a fraction of mid — you cross half on entry AND half on exit = the full
   *  spread. This is the honest fixed cost every scalp pays before the thesis even plays out. */
  roundTripCostPct: number | null;
  /** Execution grade of the actual fill vs expectation (null when no fill yet). */
  quality: ExecutionQuality | null;
}

const finite = (n: number | null | undefined): n is number => n != null && Number.isFinite(n);

function midOf(q: Quote): number | null {
  if (finite(q.mid) && q.mid > 0) return q.mid;
  if (finite(q.bid) && finite(q.ask) && q.ask >= q.bid && q.bid >= 0) return (q.bid + q.ask) / 2;
  return null;
}

const r4 = (n: number): number => Math.round(n * 10000) / 10000;

/**
 * Assess execution quality for a contract. Produces the EXPECTED read from the quote alone; when `fill` is
 * supplied it also computes the REALIZED slippage and grades the fill against expectation.
 */
export function assessExecution(input: ExecutionInputs): ExecutionAssessment {
  const { quote, side } = input;
  const aggr = finite(input.aggressiveness) ? Math.max(0, Math.min(1, input.aggressiveness)) : 0.5;
  const mid = midOf(quote);
  const spread = finite(quote.bid) && finite(quote.ask) && quote.ask >= quote.bid ? r4(quote.ask - quote.bid) : null;
  const halfSpread = spread != null ? spread / 2 : null;
  const spreadPct = spread != null && mid ? r4(spread / mid) : null;
  const roundTripCostPct = spreadPct; // half in + half out = one full spread over the round trip

  const sign = side === "BUY" ? 1 : -1; // BUY pays UP (mid+), SELL receives DOWN (mid−)
  const expectedFill = mid != null && halfSpread != null ? r4(mid + sign * aggr * halfSpread) : null;
  const expectedSlippageCost = halfSpread != null ? r4(aggr * halfSpread) : null;

  let realizedSlippageCost: number | null = null;
  let slippageVsExpected: number | null = null;
  let quality: ExecutionQuality | null = null;
  if (finite(input.fill) && mid != null) {
    realizedSlippageCost = r4(sign * (input.fill - mid)); // positive = adverse for either side
    if (expectedSlippageCost != null) {
      slippageVsExpected = r4(realizedSlippageCost - expectedSlippageCost);
      // GOOD = at/better than expected; FAIR = a small overage; POOR = materially worse (e.g. crossing to
      // the full ask when a marketable-limit fill was assumed). Tolerance is a quarter of the half-spread.
      const tol = halfSpread != null ? halfSpread * 0.25 : 0;
      quality = slippageVsExpected <= 0 ? "GOOD" : slippageVsExpected <= tol ? "FAIR" : "POOR";
    }
  }

  return {
    mid,
    spread,
    spreadPct,
    expectedFill,
    expectedSlippageCost,
    fill: finite(input.fill) ? input.fill : null,
    realizedSlippageCost,
    slippageVsExpected,
    roundTripCostPct,
    quality,
  };
}

/**
 * Fold execution into a graded return: the idealized P&L (computed on the mid/plan entry) minus the honest
 * round-trip spread drag, expressed on the same premium basis. `idealReturnPct` is the plan's return; the
 * result is what the trade would ACTUALLY have returned after paying to get in and out. Both legs cost half
 * the spread; the drag is the full spread as a % of the entry premium.
 */
export function executionAdjustedReturnPct(
  idealReturnPct: number | null,
  entryPremium: number | null,
  spread: number | null,
): number | null {
  if (!finite(idealReturnPct)) return null;
  if (!finite(spread) || !finite(entryPremium) || entryPremium <= 0) return idealReturnPct; // no drag we can price
  const dragPct = (spread / entryPremium) * 100; // full round-trip spread as % of entry premium
  return r4(idealReturnPct - dragPct);
}
