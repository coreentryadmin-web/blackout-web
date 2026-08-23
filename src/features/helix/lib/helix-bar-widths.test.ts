import { test } from "node:test";
import assert from "node:assert/strict";

import { leaderBarWidths } from "@/features/helix/lib/helix-bar-widths";

const row = (calls: number, puts: number) => ({ calls, puts, total: calls + puts });

test("THE DEFECT: a zero-premium row rendered width: NaN%", () => {
  // Executed against the shipped expressions before the fix: `Math.round((row.calls / row.total)
  // * barW)` with total 0 gave NaN for BOTH bars — while `callPct`, computed two lines earlier in
  // the same file, correctly guarded the identical ratio and returned 50.
  const w = leaderBarWidths(row(0, 0), 1_000_000);
  assert.equal(w.barW, 0);
  assert.equal(w.callBarW, 0);
  assert.equal(w.putBarW, 0);
  for (const v of Object.values(w)) assert.ok(Number.isFinite(v), "no width may be NaN");
});

test("a zero-premium row draws nothing, not a 50/50 split", () => {
  // `barW` is already 0 for such a row, so half a bar of each colour would be inventing width the
  // row has no premium to justify.
  const w = leaderBarWidths(row(0, 0), 500);
  assert.equal(w.callBarW + w.putBarW, 0);
});

test("an empty leaderboard (maxTotal 0) yields empty bars, not infinite ones", () => {
  const w = leaderBarWidths(row(0, 0), 0);
  assert.deepEqual(w, { barW: 0, callBarW: 0, putBarW: 0 });
});

test("the largest row fills the rail and splits by its call share", () => {
  const w = leaderBarWidths(row(750_000, 250_000), 1_000_000);
  assert.equal(w.barW, 100);
  assert.equal(w.callBarW, 75);
  assert.equal(w.putBarW, 25);
});

test("a smaller row scales against the largest, not against itself", () => {
  const w = leaderBarWidths(row(200_000, 200_000), 1_000_000);
  assert.equal(w.barW, 40);
  assert.equal(w.callBarW, 20);
  assert.equal(w.putBarW, 20);
});

test("the two slices ALWAYS sum to barW, so the rail cannot over- or under-fill", () => {
  // putBarW is derived by subtraction rather than a second division precisely for this. Rounding
  // two independent divisions can land a pixel over or under, and the rail is overflow-hidden.
  for (const [c, p] of [[1, 2], [333, 667], [1, 999_999], [7, 7], [12_345, 67_890]]) {
    const w = leaderBarWidths(row(c, p), 100_000);
    assert.equal(w.callBarW + w.putBarW, w.barW, `${c}/${p}`);
  }
});

test("an all-put row gives the call slice nothing, and vice versa", () => {
  assert.equal(leaderBarWidths(row(0, 400_000), 400_000).callBarW, 0);
  assert.equal(leaderBarWidths(row(400_000, 0), 400_000).putBarW, 0);
});
