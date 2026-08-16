import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FILL_ALPHA_MAX,
  FILL_ALPHA_MIN,
  HALF_PX_MAX,
  HALF_PX_MIN,
  BEAD_TUNING_DEFAULT,
  beadKey,
  beadRenderTuning,
  fillAlpha,
  kingKey,
  kingStrikeByTime,
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

test("targetHalfPx: a real notional uses the absolute $ ladder", () => {
  const small = targetHalfPx(10, 1e8, 100);
  const large = targetHalfPx(10, 1e12, 100);
  assert.ok(large > small, `expected the larger notional to draw larger (${large} vs ${small})`);
});

test("targetHalfPx: dollarMode false ignores notional (frame-relative only)", () => {
  const withNotional = targetHalfPx(50, 2e9, 100, BEAD_TUNING_DEFAULT, { dollarMode: false });
  const without = targetHalfPx(50, undefined, 100, BEAD_TUNING_DEFAULT, { dollarMode: false });
  assert.equal(withNotional, without);
});

test("compare bead profile shrinks radius vs default but keeps weak beads legible", () => {
  const compare = beadRenderTuning("compare");
  assert.ok(compare.halfMax < BEAD_TUNING_DEFAULT.halfMax);
  assert.ok(targetHalfPx(50, undefined, 100, compare) < targetHalfPx(50, undefined, 100));
  // Member feedback 2026-08-15: compare beads felt too dim — fill range boosted vs default floor.
  assert.ok(fillAlpha(5, 100, compare) >= 0.55, "weak compare bead stays visible on dark grid");
  assert.ok(
    fillAlpha(5, 100, compare) * (compare.modeledAlphaScale ?? 1) >= 0.35,
    "modeled weak compare bead stays a ghost, not gone"
  );
  assert.ok(fillAlpha(80, 100, compare) >= 0.85, "strong compare bead reads at Thermal contrast");
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

test("default bead tuning caps fill alpha so king beads do not paint solid over candles", () => {
  const tuning = beadRenderTuning("default");
  assert.ok((tuning.beadAlphaCap ?? 1) <= 0.75, "default profile must cap bead opacity");
  assert.ok(tuning.kingBoost <= 0.2, "king radius boost stays moderate");
  assert.ok((tuning.strokeAlphaBoost ?? 0) > 0, "default desk beads get crisp outlines");
  assert.ok(fillAlpha(80, 100, tuning) >= 0.68, "strong wall reads boldly");
  assert.ok(fillAlpha(3, 100, tuning) >= 0.48, "weak wall stays legible");
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

test("kingStrikeByTime: the crown belongs to whoever led AT THAT BUCKET", () => {
  // The member-reported bug: 7760 was emphasised across the whole session because it led at the
  // END. Here 100 leads early and 105 takes over — each bucket must name its own king.
  const trails = [
    { strike: 100, points: [{ time: 1, pct: 40 }, { time: 2, pct: 30 }, { time: 3, pct: 10 }] },
    { strike: 105, points: [{ time: 1, pct: 12 }, { time: 2, pct: 35 }, { time: 3, pct: 60 }] },
  ];
  const kings = kingStrikeByTime(trails);
  assert.equal(kings.get(1), 100, "100 held the crown at t=1");
  assert.equal(kings.get(2), 105, "handover at t=2");
  assert.equal(kings.get(3), 105);
});

test("kingStrikeByTime: a late leader is NOT crowned retroactively", () => {
  // Directly encodes the defect. Under the old per-strike scalar, 105 (the latest leader) would
  // have been emphasised at t=1 too, where it held 1% share.
  const trails = [
    { strike: 100, points: [{ time: 1, pct: 90 }] },
    { strike: 105, points: [{ time: 1, pct: 1 }, { time: 2, pct: 99 }] },
  ];
  const kings = kingStrikeByTime(trails);
  assert.equal(kings.get(1), 100);
  assert.notEqual(kings.get(1), 105, "the eventual king must not wear the crown before it won it");
});

test("kingStrikeByTime: ties are deterministic, not flickering", () => {
  const trails = [
    { strike: 100, points: [{ time: 1, pct: 50 }] },
    { strike: 105, points: [{ time: 1, pct: 50 }] },
  ];
  assert.equal(kingStrikeByTime(trails).get(1), 100, "first encountered wins — stable across repaints");
  assert.equal(kingStrikeByTime(trails).get(1), 100);
});

test("kingStrikeByTime: junk points and strikes are skipped, never crowned", () => {
  const trails = [
    { strike: Number.NaN, points: [{ time: 1, pct: 99 }] },
    { strike: 100, points: [{ time: Number.NaN, pct: 99 }, { time: 1, pct: 5 }, { time: 2, pct: Number.NaN }] },
  ];
  const kings = kingStrikeByTime(trails);
  assert.equal(kings.get(1), 100);
  assert.equal(kings.has(2), false, "a bucket with no usable pct has no king");
});

test("kingStrikeByTime: empty input yields no kings", () => {
  assert.equal(kingStrikeByTime([]).size, 0);
  assert.equal(kingStrikeByTime([{ strike: 100, points: [] }]).size, 0);
});
