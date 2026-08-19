import { test } from "node:test";
import assert from "node:assert/strict";
import { projectBucketX, containingBarIndex } from "./vector-bead-x-projection";

// A 3-minute candle grid, 9px apart, starting at an arbitrary session time.
const T0 = 1_700_000_000;
const BAR_SEC = 180;
const SPACING = 9;
const BARS = Array.from({ length: 20 }, (_, i) => T0 + i * BAR_SEC);
/** The chart's own lookup: a real bar time resolves, anything else is null — this is exactly what
 *  lightweight-charts does, and it is the whole reason the rail was capped at one bead per candle. */
const coord = (t: number) => {
  const i = BARS.indexOf(t);
  return i < 0 ? null : i * SPACING;
};

test("containingBarIndex: finds the bar a bucket falls inside", () => {
  assert.equal(containingBarIndex(BARS, T0), 0, "exactly on the first bar");
  assert.equal(containingBarIndex(BARS, T0 + 5), 0, "5s into the first bar");
  assert.equal(containingBarIndex(BARS, T0 + BAR_SEC), 1, "exactly on the second bar");
  assert.equal(containingBarIndex(BARS, T0 + BAR_SEC * 3 + 179), 3, "last second of the 4th bar");
  assert.equal(containingBarIndex(BARS, T0 - 1), -1, "before every bar");
  assert.equal(containingBarIndex([], T0), -1, "no bars at all");
});

// ── THE DEFECT (2026-08-19) ──────────────────────────────────────────────────────────────────
// The rail positioned buckets with `ts.timeToCoordinate(bucketTime)`, which resolves ONLY times
// present in the series data. Under a 3m candle, 35 of every 36 five-second buckets are not bar
// times, so it returned null for each and the caller's `continue` discarded them. The recorder's
// cadence could never reach the screen: one bead per candle was the ceiling.

test("a 5s rail under a 3m candle yields 36 DISTINCT x positions, not one", () => {
  const xs = new Set<number>();
  for (let k = 0; k < 36; k++) {
    const x = projectBucketX(T0 + k * 5, BARS, coord, SPACING, BAR_SEC);
    assert.ok(x != null, `bucket ${k} (t+${k * 5}s) must be placeable`);
    xs.add(Math.round(x! * 1000));
  }
  assert.equal(xs.size, 36, "every 5s bucket lands on its own x within the candle");
});

test("the old projection is what dropped them — proving the contrast", () => {
  // Same 36 buckets, straight through the chart lookup the rail used to call.
  const placed = Array.from({ length: 36 }, (_, k) => coord(T0 + k * 5)).filter((x) => x != null);
  assert.equal(placed.length, 1, "only the bucket that coincides with the bar time survived");
});

test("a bucket's x is its position WITHIN the candle, monotonically", () => {
  const a = projectBucketX(T0, BARS, coord, SPACING, BAR_SEC)!;
  const mid = projectBucketX(T0 + BAR_SEC / 2, BARS, coord, SPACING, BAR_SEC)!;
  const end = projectBucketX(T0 + BAR_SEC - 5, BARS, coord, SPACING, BAR_SEC)!;
  const nextBar = projectBucketX(T0 + BAR_SEC, BARS, coord, SPACING, BAR_SEC)!;
  assert.equal(a, 0, "start of bar 0 sits on bar 0");
  assert.ok(Math.abs(mid - SPACING / 2) < 1e-9, "half way through the bar is half a bar-width along");
  assert.ok(a < mid && mid < end && end < nextBar, "x increases with time, never jumps back");
  assert.equal(nextBar, SPACING, "the next bar's bucket lands exactly on the next bar");
});

test("a session gap scales across the REAL pixel distance, not a nominal bar width", () => {
  // Two bars either side of an overnight break: adjacent indices, but hours apart in time.
  const gapBars = [T0, T0 + 60 * 60 * 16];
  const gapCoord = (t: number) => (t === gapBars[0] ? 0 : t === gapBars[1] ? SPACING : null);
  const half = projectBucketX(T0 + 60 * 60 * 8, gapBars, gapCoord, SPACING, BAR_SEC)!;
  assert.ok(Math.abs(half - SPACING / 2) < 1e-9, "half way through the gap is half the pixel gap");
});

test("the LAST bar steps by bar width — the live edge must not freeze onto one column", () => {
  // The newest bucket always lands on the final bar, which has no successor to interpolate against.
  const last = BARS[BARS.length - 1]!;
  const x0 = projectBucketX(last, BARS, coord, SPACING, BAR_SEC)!;
  const x1 = projectBucketX(last + 5, BARS, coord, SPACING, BAR_SEC)!;
  const x2 = projectBucketX(last + 90, BARS, coord, SPACING, BAR_SEC)!;
  assert.ok(x0 < x1 && x1 < x2, "successive live buckets advance");
  assert.ok(Math.abs(x2 - (x0 + SPACING / 2)) < 1e-9, "half a bar of tape is half a bar of pixels");
  // Clamped at one bar so a late bucket cannot drift out past the rail's right edge.
  const wayPast = projectBucketX(last + BAR_SEC * 5, BARS, coord, SPACING, BAR_SEC)!;
  assert.equal(wayPast, x0 + SPACING);
});

test("unplaceable inputs return null rather than a wrong pixel", () => {
  assert.equal(projectBucketX(T0 - 1, BARS, coord, SPACING, BAR_SEC), null, "before the first bar");
  assert.equal(projectBucketX(T0, [], coord, SPACING, BAR_SEC), null, "no bar grid");
  assert.equal(projectBucketX(Number.NaN, BARS, coord, SPACING, BAR_SEC), null, "nonsense time");
  assert.equal(projectBucketX(T0, BARS, () => null, SPACING, BAR_SEC), null, "scale cannot resolve");
});

test("a degenerate bar grid still yields a sane pixel, never NaN", () => {
  // Duplicate bar times give a zero span. The bucket must not divide by it — it falls through to
  // the nominal-width step, which keeps it inside its own bar.
  const dup = [T0, T0];
  const x = projectBucketX(T0 + 5, dup, () => 42, SPACING, BAR_SEC)!;
  assert.ok(Number.isFinite(x), "no NaN from a zero-width bar");
  assert.ok(x >= 42 && x <= 42 + SPACING, `stays within its own bar, got ${x}`);
  // No spacing and no interval to step by: the bar's x is the only honest answer.
  assert.equal(projectBucketX(T0 + 5, [T0], () => 42, 0, 0), 42);
});
