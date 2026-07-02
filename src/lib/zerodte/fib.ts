// Fibonacci retracement levels — pure math over a swing range. Used by the 0DTE
// board to annotate setups ("price sitting in the weekly golden pocket") and the
// SPX header block. Levels are only ever computed from REAL swing data the caller
// already holds (weekly/prior-day high-low from the technical card) — never invented.

export type FibLevel = {
  ratio: number;
  price: number;
  label: string;
  /** The 0.618 retracement ("golden") and the 0.618-0.65 pocket get special badging. */
  golden: boolean;
};

const RATIOS: Array<{ ratio: number; label: string; golden: boolean }> = [
  { ratio: 0.236, label: "23.6%", golden: false },
  { ratio: 0.382, label: "38.2%", golden: false },
  { ratio: 0.5, label: "50%", golden: false },
  { ratio: 0.618, label: "61.8% (golden)", golden: true },
  { ratio: 0.786, label: "78.6%", golden: false },
];

/**
 * Retracement levels for a swing from `low` to `high`. `direction` is the move being
 * retraced: "up" = pullback levels below the high (buy-the-dip zones); "down" =
 * bounce levels above the low (short-the-pop zones).
 */
export function computeFibLevels(
  low: number,
  high: number,
  direction: "up" | "down"
): FibLevel[] {
  if (!(low > 0) || !(high > 0) || high <= low) return [];
  const range = high - low;
  return RATIOS.map(({ ratio, label, golden }) => ({
    ratio,
    price: direction === "up" ? high - range * ratio : low + range * ratio,
    label,
    golden,
  }));
}

export type FibNote = {
  label: string;
  price: number;
  golden: boolean;
  distance_pct: number;
};

/**
 * The fib level the price is currently sitting AT (within `tolerancePct`, default
 * 0.35%), or null. Golden-pocket proximity wins ties.
 */
export function nearestFibNote(
  price: number,
  levels: FibLevel[],
  tolerancePct = 0.35
): FibNote | null {
  if (!(price > 0) || !levels.length) return null;
  let best: FibNote | null = null;
  for (const l of levels) {
    const distPct = Math.abs((price - l.price) / price) * 100;
    if (distPct > tolerancePct) continue;
    const candidate: FibNote = {
      label: l.label,
      price: l.price,
      golden: l.golden,
      distance_pct: Math.round(distPct * 100) / 100,
    };
    // Prefer golden when both qualify; otherwise closest.
    if (!best) best = candidate;
    else if (candidate.golden && !best.golden) best = candidate;
    else if (candidate.golden === best.golden && candidate.distance_pct < best.distance_pct) best = candidate;
  }
  return best;
}
