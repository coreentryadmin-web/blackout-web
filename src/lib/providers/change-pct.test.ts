import test from "node:test";
import assert from "node:assert/strict";
import { referenceCloseFromSnapshot, rebaseChangePct, withFreshPrice } from "./change-pct";

test("referenceCloseFromSnapshot prefers an explicit prev_close", () => {
  // prev_close is exact; the inversion is not. When both are available, never guess.
  const ref = referenceCloseFromSnapshot({ price: 778.08, prev_close: 772.49, change_pct: 0.72 });
  assert.equal(ref, 772.49);
});

test("referenceCloseFromSnapshot inverts change_pct when prev_close is absent", () => {
  const ref = referenceCloseFromSnapshot({ price: 7798.99, change_pct: 0.65 });
  assert.ok(ref != null);
  assert.ok(Math.abs(ref - 7748.6) < 1, `expected ~7748.6, got ${ref}`);
});

test("referenceCloseFromSnapshot returns null when there is nothing to recover from", () => {
  assert.equal(referenceCloseFromSnapshot(null), null);
  assert.equal(referenceCloseFromSnapshot({}), null);
  assert.equal(referenceCloseFromSnapshot({ price: 100 }), null, "no change_pct, no prev_close");
  assert.equal(referenceCloseFromSnapshot({ price: 0, change_pct: 1 }), null);
  assert.equal(referenceCloseFromSnapshot({ price: 100, change_pct: null }), null);
});

test("referenceCloseFromSnapshot refuses a -100% divisor instead of returning Infinity", () => {
  // Dividing by zero here would yield Infinity, which reads downstream as a plausible-looking
  // enormous percentage rather than an obvious absence.
  assert.equal(referenceCloseFromSnapshot({ price: 100, change_pct: -100 }), null);
  assert.equal(referenceCloseFromSnapshot({ price: 100, change_pct: -150 }), null);
});

test("referenceCloseFromSnapshot treats a zero prev_close as absent, not as a reference", () => {
  // Polygon emits prev.c = 0 for untraded/pre-open rows; using it would divide by zero.
  const ref = referenceCloseFromSnapshot({ price: 100, prev_close: 0, change_pct: 25 });
  assert.ok(ref != null && Math.abs(ref - 80) < 0.01, `expected ~80 via inversion, got ${ref}`);
});

test("rebaseChangePct re-derives the percentage for a fresher price", () => {
  // Snapshot said +0.72% at 778.08 off a 772.49 close; WS now prints 781.00.
  const pct = rebaseChangePct(781.0, { price: 778.08, prev_close: 772.49, change_pct: 0.72 });
  assert.equal(pct, 1.1); // (781 - 772.49) / 772.49 * 100
});

test("rebaseChangePct reproduces the original percentage when the price has not moved", () => {
  const snap = { price: 778.08, prev_close: 772.49, change_pct: 0.72 };
  assert.equal(rebaseChangePct(778.08, snap), 0.72);
});

test("rebaseChangePct returns null rather than fabricating a percentage", () => {
  assert.equal(rebaseChangePct(100, {}), null, "no reference close");
  assert.equal(rebaseChangePct(0, { price: 100, prev_close: 99 }), null, "unusable fresh price");
  assert.equal(rebaseChangePct(null, { price: 100, prev_close: 99 }), null);
  assert.equal(rebaseChangePct(NaN, { price: 100, prev_close: 99 }), null);
});

test("rebaseChangePct handles a genuine decline", () => {
  const pct = rebaseChangePct(760.0, { price: 778.08, prev_close: 772.49, change_pct: 0.72 });
  assert.equal(pct, -1.62);
});

test("withFreshPrice moves BOTH halves of the quote together", () => {
  const out = withFreshPrice({ price: 778.08, prev_close: 772.49, change_pct: 0.72 }, 781.0);
  assert.equal(out.price, 781.0);
  assert.equal(out.change_pct, 1.1);
});

test("withFreshPrice keeps the stale percentage when it cannot be rebased", () => {
  // Better a real measurement from a moment ago than an invented 0.00%.
  const out = withFreshPrice({ price: 778.08, change_pct: null }, 781.0);
  assert.equal(out.price, 781.0);
  assert.equal(out.change_pct, null);
});

test("withFreshPrice leaves a good snapshot untouched when the fresh price is unusable", () => {
  const snap = { price: 778.08, prev_close: 772.49, change_pct: 0.72 };
  assert.deepEqual(withFreshPrice(snap, 0), snap);
  assert.deepEqual(withFreshPrice(snap, null), snap);
  assert.deepEqual(withFreshPrice(snap, -5), snap);
});

test("withFreshPrice preserves unrelated fields", () => {
  const out = withFreshPrice(
    { symbol: "I:SPX", price: 7798.99, prev_close: 7748.5, change_pct: 0.65, day_high: 7810 },
    7820.0
  );
  assert.equal(out.symbol, "I:SPX");
  assert.equal(out.day_high, 7810);
  assert.equal(out.price, 7820.0);
  assert.equal(out.change_pct, 0.92);
});
