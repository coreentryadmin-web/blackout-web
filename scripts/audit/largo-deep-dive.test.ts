import test from "node:test";
import assert from "node:assert/strict";

// @ts-expect-error — .mjs audit module, no types
import { extractClaim, whichFieldMatches } from "./largo-deep-dive.mjs";

/**
 * The grader is checked before it is trusted.
 *
 * The previous grounding check in largo-spx-adversarial.mjs shipped with a `\d{4,5}` pattern that
 * could not match "7,707.98" — so it reported "no SPX-magnitude number stated" about an answer
 * containing five of them, and the grounding test PASSED because it was blind. A guard that cannot
 * see the thing it guards is worse than no guard: it launders an unchecked answer as a verified one.
 *
 * So every pattern here is tested against the prose Largo actually emits, thousands separators and
 * both word orders included.
 */

test("extracts levels written with thousands separators", () => {
  // The exact shape that defeated the previous parser.
  assert.equal(extractClaim("SPX spot 7,707.98, +0.21% on the day.", "spot"), 7707.98);
  assert.equal(extractClaim("Call wall sits at 7,800.", "call_wall"), 7800);
});

test("extracts both word orders", () => {
  assert.equal(extractClaim("the call wall at 7800", "call_wall"), 7800);
  assert.equal(extractClaim("7800 is the call wall", "call_wall"), 7800);
  assert.equal(extractClaim("gamma flip 7891.94", "gex_flip"), 7891.94);
  assert.equal(extractClaim("7891.94 gamma flip sits above spot", "gex_flip"), 7891.94);
});

test("does NOT confuse the put wall with the call wall", () => {
  // The single most damaging extraction bug available: both labels, both numbers, one sentence.
  const s = "Call wall 7800 (+92 pts), put wall 7700 (-8 pts).";
  assert.equal(extractClaim(s, "call_wall"), 7800);
  assert.equal(extractClaim(s, "put_wall"), 7700);
});

test("a bare number elsewhere is not captured as a claim", () => {
  // Anchoring on the label is what stops "net premium -$101M ... 7700" becoming a wall claim.
  assert.equal(extractClaim("0DTE net premium -$101.2M with puts leading.", "call_wall"), null);
  assert.equal(extractClaim("TICK +265, TRIN 2.0.", "spot"), null);
});

test("returns null rather than guessing when the label is absent", () => {
  assert.equal(extractClaim("Structure looks constructive into the close.", "gex_flip"), null);
});

test("REGRESSION: a DISTANCE is not a level", () => {
  // Verbatim from prod. The grader reported `spot: said 185, truth 7707.98 (97.6% off)` about an
  // answer whose first token is the correct spot — a false accusation of a 97% data error against
  // a correct answer. Manufacturing failures wastes as much time as missing them.
  const a = "SPX 7,707.98, up 0.21% on the session. Spot is 185 points below the gamma flip at 7,892.98, sitting just above the 7,700 put wall.";
  assert.equal(extractClaim(a, "spot"), 7707.98);
  assert.equal(extractClaim(a, "gex_flip"), 7892.98);
  assert.equal(extractClaim(a, "put_wall"), 7700);
});

test("REGRESSION: extraction must not read across a clause boundary", () => {
  // Both verbatim from prod, both CORRECT answers that the first grader failed.
  const a = "support at 7,700 (put wall) and resistance at 7,800 (call wall) are the levels that matter";
  assert.equal(extractClaim(a, "put_wall"), 7700, "must not jump the 'and' into the call wall");
  assert.equal(extractClaim(a, "call_wall"), 7800);

  const b = "SPX sits at 7,707.98, in a short-gamma pocket below the 7,893.07 flip — support at 7,700";
  assert.equal(extractClaim(b, "gex_flip"), 7893.07, "must take the number before 'flip', not past the dash");
});

test("nearest-number wins when a label has candidates on both sides", () => {
  assert.equal(extractClaim("the 7,893.07 flip", "gex_flip"), 7893.07);
  assert.equal(extractClaim("flip at 7,893.07", "gex_flip"), 7893.07);
});

test("whichFieldMatches identifies WHICH source a wrong number came from", () => {
  // The production case: three live gamma-flip values, and an answer quoting the pin one under
  // the label that belongs to the matrix one.
  const fields = { spot: 7707.98, gex_flip: 7892.93, regime_flip: 7887.06, pin_flip: 6982.33, call_wall: 7800 };
  assert.deepEqual(whichFieldMatches(6982.33, fields, "gex_flip"), ["pin_flip"]);
  assert.deepEqual(whichFieldMatches(7800, fields, "gex_flip"), ["call_wall"]);
  // A genuinely invented number matches nothing — that is a real fabrication, not source confusion.
  assert.deepEqual(whichFieldMatches(5123.45, fields, "gex_flip"), []);
});

test("whichFieldMatches excludes the field being checked", () => {
  // Otherwise every correct answer would report itself as a source-confusion hit.
  const fields = { gex_flip: 7892.93, spot: 7707.98 };
  assert.deepEqual(whichFieldMatches(7892.93, fields, "gex_flip"), []);
});

test("near-miss inside tolerance is treated as the same level", () => {
  // Spot moves between the truth snapshot and the answer; demanding equality would fail a healthy
  // system during RTH. 0.15% of 7700 is ~11pts.
  const fields = { spot: 7707.98 };
  assert.deepEqual(whichFieldMatches(7708.5, fields, "call_wall"), ["spot"]);
  assert.deepEqual(whichFieldMatches(7750, fields, "call_wall"), []);
});
