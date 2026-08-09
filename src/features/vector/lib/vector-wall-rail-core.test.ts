import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FILL_ALPHA_MAX,
  FILL_ALPHA_MIN,
  HALF_PX_MAX,
  HALF_PX_MIN,
  beadKey,
  fillAlpha,
  kingKey,
  targetHalfPx,
  withA,
} from "./vector-wall-rail-core";

// ── withA ────────────────────────────────────────────────────────────────────

test("withA: expands 6- and 3-digit hex to rgba", () => {
  assert.equal(withA("#ffd60a", 1), "rgba(255, 214, 10, 1)");
  assert.equal(withA("#d97bff", 0.5), "rgba(217, 123, 255, 0.5)");
  // The 3-digit form doubles each nibble: #abc -> aa bb cc.
  assert.equal(withA("#abc", 1), "rgba(170, 187, 204, 1)");
});

test("withA: a MALFORMED hex falls through instead of producing rgba(NaN)", () => {
  // The bug this guards. The old check was startsWith("#") plus a length test, so anything of the
  // right length went to parseInt — and `rgba(NaN, NaN, NaN, 1)` is not a parse error to canvas,
  // it is a NO-OP: fillStyle keeps its previous value. Beads would draw in whatever colour was
  // last set, on the panel whose only job is showing where the walls are.
  for (const bad of ["#gggggg", "#12345z", "#zzz", "#--", "#1234567"]) {
    const out = withA(bad, 1);
    assert.doesNotMatch(out, /NaN/, `withA(${bad}) must not emit NaN`);
    assert.equal(out, bad, "unparseable input is returned as-is for the browser to reject visibly");
  }
});

test("withA: non-hex colours pass through untouched for globalAlpha to carry", () => {
  assert.equal(withA("rgba(1, 2, 3, 0.4)", 0.9), "rgba(1, 2, 3, 0.4)");
  assert.equal(withA("gold", 0.2), "gold");
});

test("withA: alpha is clamped, and a non-finite alpha does not leak into the string", () => {
  assert.equal(withA("#000000", -5), "rgba(0, 0, 0, 0)");
  assert.equal(withA("#000000", 42), "rgba(0, 0, 0, 1)");
  assert.equal(withA("#000000", Number.NaN), "rgba(0, 0, 0, 1)", "NaN alpha falls back to opaque");
});

// ── targetHalfPx ─────────────────────────────────────────────────────────────

test("targetHalfPx: always inside the [MIN, MAX] px band", () => {
  for (const pct of [0, 0.0001, 1, 25, 50, 100, 1e9]) {
    for (const notional of [undefined, 0, -1, 1e3, 1e12]) {
      const r = targetHalfPx(pct, notional, 100);
      assert.ok(
        r >= HALF_PX_MIN - 1e-9 && r <= HALF_PX_MAX + 1e-9,
        `pct=${pct} notional=${notional} -> ${r} outside [${HALF_PX_MIN}, ${HALF_PX_MAX}]`
      );
    }
  }
});

test("targetHalfPx: a bigger wall is never a smaller bead", () => {
  // Monotonicity is the property a member actually reads off the rail. If it inverts anywhere, the
  // biggest wall on screen can render smaller than a lesser one.
  let prev = -Infinity;
  for (const pct of [0.5, 1, 2, 5, 10, 20, 40, 80, 100]) {
    const r = targetHalfPx(pct, undefined, 100);
    assert.ok(r >= prev - 1e-9, `pct=${pct} produced ${r}, smaller than the previous ${prev}`);
    prev = r;
  }
});

test("targetHalfPx: degenerate magnitude still renders a bead, never a collapse", () => {
  // Off-hours / degraded data: no notional and no usable pct. The rail must still draw something.
  for (const pct of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    const r = targetHalfPx(pct, undefined, 0);
    assert.ok(Number.isFinite(r), `pct=${pct} produced a non-finite radius`);
    assert.ok(r >= HALF_PX_MIN - 1e-9, `pct=${pct} produced ${r}, below the floor`);
  }
});

test("targetHalfPx: a real notional overrides the pct proxy", () => {
  // Same pct, wildly different $ — the absolute ladder must win, else threading a real notional
  // through later would silently change nothing.
  const small = targetHalfPx(10, 1e3, 100);
  const large = targetHalfPx(10, 1e12, 100);
  assert.ok(large > small, `expected the larger notional to draw larger (${large} vs ${small})`);
});

// ── fillAlpha ────────────────────────────────────────────────────────────────

test("fillAlpha: spans [MIN, MAX] and never leaves the band", () => {
  for (const [pct, maxPct] of [[0, 100], [50, 100], [100, 100], [200, 100], [-5, 100], [1, 0]] as const) {
    const a = fillAlpha(pct, maxPct);
    assert.ok(
      a >= FILL_ALPHA_MIN - 1e-9 && a <= FILL_ALPHA_MAX + 1e-9,
      `pct=${pct} max=${maxPct} -> ${a} outside [${FILL_ALPHA_MIN}, ${FILL_ALPHA_MAX}]`
    );
  }
  assert.ok(fillAlpha(100, 100) > fillAlpha(1, 100), "the dominant wall is the most opaque");
});

// ── keys ─────────────────────────────────────────────────────────────────────

test("beadKey: side, strike and bucket are all part of identity", () => {
  assert.notEqual(beadKey("c", 225, 100), beadKey("p", 225, 100), "sides must not collide");
  assert.notEqual(beadKey("c", 225, 100), beadKey("c", 230, 100), "strikes must not collide");
  assert.notEqual(beadKey("c", 225, 100), beadKey("c", 225, 160), "buckets must not collide");
  assert.equal(beadKey("c", 225, 100), beadKey("c", 225, 100), "and it is stable across calls");
});

test("beadKey: no ambiguity between adjacent fields", () => {
  // A separator-free or sloppy join can make (strike 2, time 25) and (strike 22, time 5) the same
  // key, which would silently fuse two beads' easing state.
  assert.notEqual(beadKey("c", 2, 25), beadKey("c", 22, 5));
});

test("kingKey: per-strike and time-independent — the king persists across buckets", () => {
  assert.equal(kingKey("c", 225), kingKey("c", 225));
  assert.notEqual(kingKey("c", 225), kingKey("p", 225));
  assert.notEqual(kingKey("c", 225), kingKey("c", 226));
});
