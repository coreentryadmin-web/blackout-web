import test from "node:test";
import assert from "node:assert/strict";
import { shouldAdoptFullVectorPageSeed } from "./vector-seed-upgrade-guard";

test("shouldAdoptFullVectorPageSeed rejects a degraded (empty-bars) full seed when the fast seed already had real bars", () => {
  // This is the exact regression: the fast seed rendered 390 real bars, the phase-2 upgrade's
  // bars fetch degraded to empty on a transient failure, and the pre-fix code adopted it anyway,
  // blanking an already-correct chart.
  assert.equal(shouldAdoptFullVectorPageSeed(390, 0), false);
});

test("shouldAdoptFullVectorPageSeed adopts a full seed that genuinely carries bars", () => {
  assert.equal(shouldAdoptFullVectorPageSeed(390, 391), true);
});

test("shouldAdoptFullVectorPageSeed adopts an empty full seed when the fast seed was ALSO empty", () => {
  // Both legitimately empty (e.g. a pre-open session with no bars yet) is not a regression — the
  // full seed's other fields (wall history, gamma flip) should still be allowed to land.
  assert.equal(shouldAdoptFullVectorPageSeed(0, 0), true);
});
