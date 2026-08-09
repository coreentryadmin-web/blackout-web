import test from "node:test";
import assert from "node:assert/strict";
import { rowsInBand, scrollOffsetForSpot } from "./vector-ladder-align";

const rows = (...s: number[]) => s.map((strike) => ({ strike }));

test("rows are scoped to the chart's visible price band", () => {
  // The observed NVDA case: ladder 162.5-300, chart ~197.5-247.5. Scoping brings the rail onto the
  // chart's scale instead of spanning nearly 3x its range.
  const all = rows(300, 260, 247.5, 240, 223.8, 210, 197.5, 180, 162.5);
  const kept = rowsInBand(all, { min: 197.5, max: 247.5 }, 0);
  assert.deepEqual(kept.map((r) => r.strike), [247.5, 240, 223.8, 210, 197.5]);
});

test("padding keeps just-off-screen walls visible", () => {
  // A wall a hair outside the viewport is still context; a hard cut also makes the rail look
  // truncated at both ends.
  const all = rows(255, 250, 225, 200, 195);
  const kept = rowsInBand(all, { min: 200, max: 250 }, 0.15); // pad = 7.5 => [192.5, 257.5]
  assert.deepEqual(kept.map((r) => r.strike), [255, 250, 225, 200, 195]);
});

test("no band means no filtering — never guess a range", () => {
  const all = rows(300, 225, 150);
  assert.equal(rowsInBand(all, null), all, "null band returns the same array");
  assert.equal(rowsInBand(all, undefined), all);
  // A malformed band must not silently narrow the rail either.
  assert.equal(rowsInBand(all, { min: 250, max: 100 }), all, "inverted");
  assert.equal(rowsInBand(all, { min: NaN, max: 100 }), all, "non-finite");
  assert.equal(rowsInBand(all, { min: 200, max: 200 }), all, "zero width");
});

test("an excluding band falls back to the full rail, never a blank panel", () => {
  // Stale band from a previous ticker, or a chart zoomed far outside the strike set.
  const all = rows(300, 225, 150);
  assert.equal(rowsInBand(all, { min: 1000, max: 2000 }), all);
});

test("spot is biased into the upper third, not centred", () => {
  // Centring pushes spot to the middle of a tall rail, below the chart's price action. 0.38 lifts
  // it to read level with the chart while keeping puts visible underneath.
  const centred = scrollOffsetForSpot(1000, 20, 800, 3000, 0.5);
  const biased = scrollOffsetForSpot(1000, 20, 800, 3000, 0.38);
  assert.ok(biased > centred, "a smaller bias scrolls further, lifting spot higher in the viewport");
  assert.equal(biased, 1000 - 800 * 0.38 + 10);
});

test("scroll offset is clamped to the scrollable range", () => {
  // A short list must not scroll into empty space below its content.
  assert.equal(scrollOffsetForSpot(50, 20, 800, 400, 0.38), 0, "content shorter than viewport");
  assert.equal(scrollOffsetForSpot(5000, 20, 800, 3000, 0.38), 2200, "clamped to scrollHeight - viewport");
  assert.ok(scrollOffsetForSpot(0, 20, 800, 3000, 0.38) >= 0, "never negative");
});

test("degenerate geometry yields no scroll rather than NaN", () => {
  // getBoundingClientRect can return zeros before layout settles; NaN would silently break scrolling.
  for (const v of [NaN, Infinity]) {
    assert.equal(scrollOffsetForSpot(v, 20, 800, 3000), 0, `targetTop=${v}`);
  }
  assert.equal(scrollOffsetForSpot(100, 20, 0, 3000), 0, "zero-height viewport");
});
