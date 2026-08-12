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

// ── Too FEW rows is a failure too ─────────────────────────────────────────────────────────────

/** SPY-shaped rail: $1 strikes, spot ~772.94, as served live on 2026-08-12 (163 rows). */
const spyRows = Array.from({ length: 163 }, (_, i) => ({ strike: 850 - i }));

test("REGRESSION: a tight chart zoom must not leave the panel nearly empty", () => {
  // Live capture SPY 2026-08-12: chart zoomed to ~770-776, strikes $1 apart, so the band matched
  // SEVEN rows in a panel with room for ~40 — while the API had served 163. The member saw an
  // almost-blank column and no idea where the real walls sat. The old guard only caught a band
  // that matched NOTHING; everything between "nothing" and "useful" fell through.
  const tight = rowsInBand(spyRows, { min: 770, max: 776 }, 0.15, { anchor: 772.94 });
  assert.ok(
    tight.length >= 24,
    `a 6-point band on $1 strikes must still fill the panel, got ${tight.length}`
  );
});

test("the widened rail stays STRIKE-DESCENDING, not distance-sorted", () => {
  // The panel renders strike-desc and finds the spot marker by scanning for the first row at/below
  // spot. Returning the rows in the distance order used to PICK them would scramble both.
  const out = rowsInBand(spyRows, { min: 770, max: 776 }, 0.15, { anchor: 772.94 });
  const strikes = out.map((r) => r.strike);
  assert.deepEqual(strikes, [...strikes].sort((a, b) => b - a), "rail must stay descending");
});

test("the widen-out centres on SPOT, not the band centre, when both are known", () => {
  // The panel auto-scrolls to spot; growing the rail around anything else pushes the rows a member
  // is looking for out of the visible part of the list.
  const out = rowsInBand(spyRows, { min: 700, max: 706 }, 0.15, { anchor: 772.94 });
  const mid = out.map((r) => r.strike).sort((a, b) => Math.abs(a - 772.94) - Math.abs(b - 772.94))[0]!;
  assert.ok(Math.abs(mid - 772.94) <= 1, `nearest kept row should hug spot, got ${mid}`);
});

test("a band that already yields plenty of rows is left completely alone", () => {
  // The widen-out must not quietly override a legitimately narrow-but-sufficient scope — that
  // would undo the whole reason the band exists.
  const wide = rowsInBand(spyRows, { min: 700, max: 800 }, 0.15, { anchor: 750 });
  const expected = spyRows.filter((r) => r.strike >= 685 && r.strike <= 815);
  assert.deepEqual(wide, expected, "a sufficient band must pass through untouched");
});

test("on a THIN chain the band still wins — the floor must not undo the original fix", () => {
  // The reason band-scoping exists is the NVDA case: a 9-row rail spanning 162.5-300 cut to the
  // chart's 197.5-247.5. Five rows, correctly. If the "panel looks empty" floor widened that back
  // out it would undo the fix rather than complement it. A panel is only too empty when rows are
  // being HIDDEN, which requires the full set to be big enough to hide something worth seeing.
  const thin = [{ strike: 30 }, { strike: 25 }, { strike: 20 }, { strike: 15 }, { strike: 10 }];
  const out = rowsInBand(thin, { min: 19, max: 21 }, 0.15, { anchor: 20 });
  assert.deepEqual(out.map((r) => r.strike), [20], "thin chain keeps the tight band");
  assert.ok(out.length <= thin.length, "never invents rows");
});

test("no anchor falls back to the band centre rather than throwing or returning everything", () => {
  const out = rowsInBand(spyRows, { min: 770, max: 776 }, 0.15, {});
  assert.ok(out.length >= 24);
  assert.ok(out.some((r) => r.strike === 773), "band centre 773 must be in the widened set");
});
