/**
 * Sub-bar x projection for bead buckets.
 *
 * ── THE CEILING THIS REMOVES (2026-08-19) ────────────────────────────────────────────
 * The rail recorded a bead every 5 seconds and then drew, at most, ONE PER CANDLE — and nothing in
 * the pipeline said so. The rail primitive positioned every bucket with
 *
 *     const x = ts.timeToCoordinate(p.time as Time);
 *     if (x == null) continue;            // "off-screen bucket"
 *
 * `timeToCoordinate` resolves a time to a pixel only when that time is IN THE SERIES DATA. A bar
 * grid is 3-minute candles; a bucket grid is 5 seconds. 35 of every 36 buckets are therefore not
 * bar times, `timeToCoordinate` returns null for each of them, and the `continue` — commented as an
 * off-screen skip, which is what it looks like — threw them away. The rail could never be denser
 * than the candles regardless of how fast the recorder ran.
 *
 * This is why every earlier fix in this area moved the number and not the picture. The recorder
 * genuinely was writing 5s samples (SPX: 3964 samples, median gap 5s, measured against prod); the
 * API genuinely was serving them; `bucketWallHistoryForInterval` genuinely was keeping them. They
 * died in the last hop, at a line that reads like a bounds check.
 *
 * ── THE RULE ─────────────────────────────────────────────────────────────────────────
 * A bucket's x is its position WITHIN its containing candle, not the candle's own x. Find the bar
 * that contains the bucket, take that bar's pixel and the next bar's, and interpolate by how far
 * through the bar the bucket falls. A 5s bucket under a 3m candle lands 1/36th of a bar-width past
 * its candle, which is exactly where the reference product draws it.
 *
 * Interpolating between the two REAL bar coordinates (rather than adding `barSpacing`) keeps the
 * projection correct across a session gap: the overnight break is a wide pixel jump between two
 * adjacent bar indices, and a bucket inside that break scales across the real gap instead of
 * landing a nominal bar-width away, in the middle of the previous session's air.
 */

/** Ascending bar times (epoch seconds) → pixel, as the chart's own time scale reports it. */
export type BarCoordinateLookup = (barTimeSec: number) => number | null;

/**
 * Index of the last bar at or before `timeSec`, or -1 when the time precedes every bar.
 *
 * Binary search because this runs per bucket per strike per frame: a 20-row rail over an RTH
 * session is ~80k lookups, and a linear scan of the bar array turns the rail into a scroll stutter.
 */
export function containingBarIndex(barTimes: readonly number[], timeSec: number): number {
  let lo = 0;
  let hi = barTimes.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const t = barTimes[mid]!;
    if (t <= timeSec) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

/**
 * Pixel x for a bucket time, interpolated within its containing bar.
 *
 * Returns null only when the position is genuinely unknowable — no bars, a time before the first
 * bar, or a time scale that cannot resolve the containing bar. Null means "skip this bead"; it must
 * never be the normal case, which is precisely the bug above.
 *
 * `barSpacingPx` and `intervalSec` are used only for the LAST bar, which has no successor to
 * interpolate against — a live session's newest bucket lands there on every tick, so falling back
 * to the bar's own x (the old behaviour) would freeze the live edge of the rail onto one column.
 */
export function projectBucketX(
  timeSec: number,
  barTimes: readonly number[],
  coordOfBar: BarCoordinateLookup,
  barSpacingPx: number,
  intervalSec: number
): number | null {
  if (!Number.isFinite(timeSec) || !barTimes.length) return null;
  const i = containingBarIndex(barTimes, timeSec);
  if (i < 0) return null; // before the first bar — no candle contains it

  const barTime = barTimes[i]!;
  const x0 = coordOfBar(barTime);
  if (x0 == null || !Number.isFinite(x0)) return null;

  // Exactly on the bar: no interpolation to do, and this is the common case for the coarse
  // historical frames where bucket == candle.
  if (timeSec === barTime) return x0;

  const next = i + 1 < barTimes.length ? barTimes[i + 1]! : null;
  if (next != null) {
    const span = next - barTime;
    if (!(span > 0)) return x0;
    const x1 = coordOfBar(next);
    // A resolvable next bar gives the true pixel width of THIS bar, session gaps included.
    if (x1 != null && Number.isFinite(x1)) {
      const frac = Math.min(1, (timeSec - barTime) / span);
      return x0 + frac * (x1 - x0);
    }
  }

  // Last bar (or an unresolvable neighbour): step by the nominal bar width. Clamped to one bar so a
  // bucket recorded after the final candle's close cannot drift out past the rail's right edge.
  if (!(barSpacingPx > 0) || !(intervalSec > 0)) return x0;
  const frac = Math.min(1, (timeSec - barTime) / intervalSec);
  return x0 + frac * barSpacingPx;
}
