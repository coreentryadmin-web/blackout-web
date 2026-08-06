/**
 * SESSION VOLUME PROFILE — bucket-by-PRICE (not by-time) volume distribution for the current
 * session's bars (CTO audit P2 #4). Pairs with the GEX ladder's volume-at-STRIKE view: this shows
 * volume-at-PRICE for the underlying, so a member can see whether the heaviest-traded zone lines
 * up with a dealer wall (a confluence read the audit specifically called out).
 *
 * PURE by construction — no Date.now, no chart handles — so the bucketing/POC/value-area math is
 * fully unit-testable independent of the lightweight-charts primitive that draws it
 * (`vector-volume-profile-primitive.ts`). Uses the SAME 1m session bars already seeded/streamed
 * for the candlestick chart — no new data source, matching the audit's framing.
 *
 * Distribution method: each bar's volume is split evenly across every price bucket its [low,high]
 * range touches (the standard even-distribution approximation used when only OHLCV bars — not
 * tick-level prints — are available; TradingView's built-in profile uses the same approximation
 * absent tick data). A single-price bar (high===low) contributes its whole volume to one bucket.
 */

export type VolumeProfileBar = {
  high: number;
  low: number;
  volume?: number | null;
};

export type VolumeProfileBucket = {
  /** Bucket midpoint price. */
  price: number;
  volume: number;
};

export type VolumeProfile = {
  buckets: readonly VolumeProfileBucket[];
  /** Price bucket height (buckets[i].price ± bucketSize/2 gives the bucket's price range). */
  bucketSize: number;
  /** Point of Control — the single price level with the most volume. Null when there's no volume. */
  poc: number | null;
  /** Value-area bounds (the price band containing ~70% of volume around the POC). Null when empty. */
  valueAreaLow: number | null;
  valueAreaHigh: number | null;
  maxVolume: number;
  totalVolume: number;
};

export const VOLUME_PROFILE_DEFAULT_BUCKETS = 24;
export const VOLUME_PROFILE_VALUE_AREA_PCT = 0.7;

const EMPTY_PROFILE: VolumeProfile = {
  buckets: [],
  bucketSize: 0,
  poc: null,
  valueAreaLow: null,
  valueAreaHigh: null,
  maxVolume: 0,
  totalVolume: 0,
};

/** Bucket ascending/unordered bars into a price-keyed volume profile. Bars with no/zero volume or a
 *  non-finite high/low are dropped rather than fabricating a contribution. */
export function computeVolumeProfile(
  bars: readonly VolumeProfileBar[],
  numBuckets: number = VOLUME_PROFILE_DEFAULT_BUCKETS
): VolumeProfile {
  const clean = bars.filter(
    (b) =>
      b.volume != null &&
      b.volume > 0 &&
      Number.isFinite(b.high) &&
      Number.isFinite(b.low) &&
      b.high >= b.low
  );
  if (!clean.length || numBuckets < 1) return EMPTY_PROFILE;

  let lo = Infinity;
  let hi = -Infinity;
  for (const b of clean) {
    lo = Math.min(lo, b.low);
    hi = Math.max(hi, b.high);
  }

  const totalVolume = clean.reduce((s, b) => s + (b.volume ?? 0), 0);

  // Degenerate/flat range (all bars at one price, or a single tick) — one bucket holds everything.
  if (!(hi > lo)) {
    return {
      buckets: [{ price: lo, volume: totalVolume }],
      bucketSize: 0,
      poc: lo,
      valueAreaLow: lo,
      valueAreaHigh: lo,
      maxVolume: totalVolume,
      totalVolume,
    };
  }

  const bucketSize = (hi - lo) / numBuckets;
  const vols = new Array<number>(numBuckets).fill(0);
  for (const b of clean) {
    const loIdx = Math.max(0, Math.min(numBuckets - 1, Math.floor((b.low - lo) / bucketSize)));
    const hiIdx = Math.max(0, Math.min(numBuckets - 1, Math.floor((b.high - lo) / bucketSize)));
    const span = hiIdx - loIdx + 1;
    const share = (b.volume ?? 0) / span;
    for (let i = loIdx; i <= hiIdx; i++) vols[i]! += share;
  }

  const buckets: VolumeProfileBucket[] = vols.map((v, i) => ({ price: lo + (i + 0.5) * bucketSize, volume: v }));
  const maxVolume = Math.max(...vols);
  const pocIdx = vols.indexOf(maxVolume);
  const poc = maxVolume > 0 ? buckets[pocIdx]!.price : null;

  // Value area: expand outward from the POC bucket, each step taking whichever adjacent bucket
  // (above or below the current range) carries more volume, until ~70% of total volume is covered.
  // A -1 sentinel on an exhausted side always loses to a real (>=0) volume on the other side.
  let loIdx = pocIdx;
  let hiIdx = pocIdx;
  let cum = vols[pocIdx] ?? 0;
  const target = totalVolume * VOLUME_PROFILE_VALUE_AREA_PCT;
  while (cum < target && (loIdx > 0 || hiIdx < numBuckets - 1)) {
    const nextLo = loIdx > 0 ? vols[loIdx - 1]! : -1;
    const nextHi = hiIdx < numBuckets - 1 ? vols[hiIdx + 1]! : -1;
    if (nextHi >= nextLo) {
      hiIdx++;
      cum += nextHi;
    } else {
      loIdx--;
      cum += nextLo;
    }
  }
  const valueAreaLow = totalVolume > 0 ? buckets[loIdx]!.price - bucketSize / 2 : null;
  const valueAreaHigh = totalVolume > 0 ? buckets[hiIdx]!.price + bucketSize / 2 : null;

  return { buckets, bucketSize, poc, valueAreaLow, valueAreaHigh, maxVolume, totalVolume };
}
