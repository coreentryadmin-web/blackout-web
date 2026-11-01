// Pure helpers for zerodte-flow-atm-selector-real-cost-ab.mjs — kept separate and unit-tested so
// the strike-selection math and the paired-comparison statistics can be verified independently of
// the live Polygon/admin-route fetching the main script does. Same discipline as
// swing-early-trim-eval.mjs's comparePolicies().

/** Nearest real listed strike to `spot`, by absolute distance. Returns null for an empty list —
 *  never a fabricated strike. Ties resolve to whichever candidate is encountered first. */
export function nearestStrike(strikes, spot) {
  if (!Array.isArray(strikes) || strikes.length === 0) return null;
  let best = strikes[0];
  let bestDist = Math.abs(strikes[0] - spot);
  for (const s of strikes) {
    const d = Math.abs(s - spot);
    if (d < bestDist) {
      best = s;
      bestDist = d;
    }
  }
  return best;
}

/**
 * Paired comparison of two contract picks (actual vs. ATM-counterfactual) graded through the
 * SAME real exit-engine replay for the SAME commit instant — a paired delta, far more powerful
 * than treating the two sides as independent samples of different trades (they are the same
 * trade, re-priced). Mirrors swing-early-trim-eval.mjs's comparePolicies() verdict taxonomy.
 * @param {{ actual: number, atm: number, delta: number }[]} pairs
 */
export function pairedCompare(pairs) {
  const n = pairs.length;
  if (n === 0) return { n: 0, meanActual: null, meanAtm: null, meanDelta: null, ci: null, verdict: "NO DATA" };
  const meanActual = pairs.reduce((a, p) => a + p.actual, 0) / n;
  const meanAtm = pairs.reduce((a, p) => a + p.atm, 0) / n;
  const meanDelta = pairs.reduce((a, p) => a + p.delta, 0) / n;
  const variance = n > 1 ? pairs.reduce((a, p) => a + (p.delta - meanDelta) ** 2, 0) / (n - 1) : 0;
  const stderr = Math.sqrt(variance / n);
  const ci = { lo: meanDelta - 1.96 * stderr, hi: meanDelta + 1.96 * stderr };
  const verdict =
    n < 2 ? "INSUFFICIENT N" : ci.lo > 0 ? "ATM SEPARATED (better)" : ci.hi < 0 ? "ACTUAL (top_strike) SEPARATED (better)" : "INCONCLUSIVE";
  return {
    n,
    meanActual: Math.round(meanActual * 100) / 100,
    meanAtm: Math.round(meanAtm * 100) / 100,
    meanDelta: Math.round(meanDelta * 100) / 100,
    ci: { lo: Math.round(ci.lo * 100) / 100, hi: Math.round(ci.hi * 100) / 100 },
    verdict,
  };
}

/** % of paired rows where `side` ("actual" or "atm") graded a real win (pnl_pct > 0). Null for an
 *  empty population — never a fabricated rate. */
export function winRate(pairs, side) {
  const n = pairs.length;
  if (!n) return null;
  return Math.round((pairs.filter((p) => p[side] > 0).length / n) * 1000) / 10;
}
