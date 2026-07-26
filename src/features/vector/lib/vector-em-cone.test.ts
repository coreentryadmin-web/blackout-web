import { test } from "node:test";
import assert from "node:assert/strict";
import {
  emConeGeometry,
  emConeFromExpectedMove,
  remainingFrac,
  RTH_OPEN_ET_MIN,
  RTH_CLOSE_ET_MIN,
} from "./vector-em-cone";
import type { ExpectedMove } from "./vector-expected-move";

const H1 = 40; // full-session ±1σ half-width (pts)
const H2 = 80; // ±2σ
const SPOT = 7500;

test("remainingFrac: full at window start, zero at window end, clamps outside", () => {
  // Anchored at NOW → close (the cone's real usage), not the session open.
  assert.equal(remainingFrac(720, 720, RTH_CLOSE_ET_MIN), 1, "at now → full");
  assert.equal(remainingFrac(RTH_CLOSE_ET_MIN, 720, RTH_CLOSE_ET_MIN), 0, "at close → zero");
  // Halfway between now(720) and close(960) is 840 → half the now→close window ahead.
  assert.ok(Math.abs(remainingFrac(840, 720, RTH_CLOSE_ET_MIN) - 0.5) < 1e-9);
  // Before the window start clamps to 1, past the end clamps to 0 (never negative / >1).
  assert.equal(remainingFrac(700, 720, RTH_CLOSE_ET_MIN), 1);
  assert.equal(remainingFrac(1000, 720, RTH_CLOSE_ET_MIN), 0);
});

test("the widest (leftmost) half-width == H1 at a MID-SESSION now (matches the flat band, no double decay)", () => {
  // The bug: the cone re-decayed H1 off the session OPEN, so at now=12:00 the left edge was
  // H1·√((960-720)/(960-570)) = H1·√0.615 < H1 — inside the flat band. Corrected: left edge == H1.
  const cone = emConeGeometry({ spot: SPOT, sigma1HalfWidth: H1, sigma2HalfWidth: H2, nowEtMin: 720 }); // 12:00 ET
  assert.ok(cone);
  const first = cone![0]!;
  assert.ok(Math.abs(first.upper1 - (SPOT + H1)) < 1e-6, "leftmost ±1σ upper == spot + H1");
  assert.ok(Math.abs(first.lower1 - (SPOT - H1)) < 1e-6, "leftmost ±1σ lower == spot - H1");
  assert.ok(Math.abs(first.upper2 - (SPOT + H2)) < 1e-6, "leftmost ±2σ upper == spot + H2");
  // σ=2 edge is exactly twice the σ=1 edge distance at every sample.
  assert.ok(Math.abs(first.upper2 - SPOT - 2 * (first.upper1 - SPOT)) < 1e-6);
  // Same at the open, and at any other mid-session now — always H1 at the left edge.
  for (const now of [RTH_OPEN_ET_MIN, 600, 855]) {
    const c = emConeGeometry({ spot: SPOT, sigma1HalfWidth: H1, sigma2HalfWidth: H2, nowEtMin: now });
    assert.ok(c && Math.abs(c[0]!.upper1 - (SPOT + H1)) < 1e-6, `left edge == H1 at now=${now}`);
  }
});

test("the cone converges to ≈ spot at the close (remaining budget spent), from any now", () => {
  const cone = emConeGeometry({ spot: SPOT, sigma1HalfWidth: H1, sigma2HalfWidth: H2, nowEtMin: 720 });
  assert.ok(cone);
  const last = cone![cone!.length - 1]!;
  assert.ok(Math.abs(last.upper1 - SPOT) < 1e-6, "±1σ upper collapses to spot");
  assert.ok(Math.abs(last.lower1 - SPOT) < 1e-6, "±1σ lower collapses to spot");
  assert.ok(Math.abs(last.upper2 - SPOT) < 1e-6, "±2σ upper collapses to spot");
});

test("half-width narrows monotonically from now → close", () => {
  const cone = emConeGeometry({
    spot: SPOT,
    sigma1HalfWidth: H1,
    sigma2HalfWidth: H2,
    nowEtMin: 600, // 10:00 ET
    steps: 12,
  });
  assert.ok(cone);
  let prev = Infinity;
  for (const s of cone!) {
    const hw = s.upper1 - SPOT;
    assert.ok(hw <= prev + 1e-9, "each sample is no wider than the previous");
    assert.ok(hw >= -1e-9, "half-width never goes negative");
    prev = hw;
  }
  // Symmetric around spot at every sample.
  for (const s of cone!) {
    assert.ok(Math.abs(s.upper1 - SPOT - (SPOT - s.lower1)) < 1e-6);
    assert.ok(Math.abs(s.upper2 - SPOT - (SPOT - s.lower2)) < 1e-6);
  }
});

test("√time decay is anchored at now: halfway from now→close → H1·√0.5", () => {
  // now=12:00 (720), close=16:00 (960); halfway is 840 (14:00). The sample there must be H1·√0.5,
  // decaying off NOW (denominator close−now=240), NOT off the session open.
  const cone = emConeGeometry({ spot: SPOT, sigma1HalfWidth: H1, sigma2HalfWidth: H2, nowEtMin: 720, steps: 3 });
  assert.ok(cone);
  const mid = cone![1]!; // steps=3 → samples at 720, 840, 960
  assert.ok(Math.abs(mid.etMin - 840) < 1e-9, "middle sample is at 14:00");
  assert.ok(Math.abs(mid.upper1 - SPOT - H1 * Math.sqrt(0.5)) < 1e-6, "√time decay off now, not open");
});

test("nowEtMin at/after the close → null (budget spent)", () => {
  assert.equal(emConeGeometry({ spot: SPOT, sigma1HalfWidth: H1, sigma2HalfWidth: H2, nowEtMin: RTH_CLOSE_ET_MIN }), null);
  assert.equal(emConeGeometry({ spot: SPOT, sigma1HalfWidth: H1, sigma2HalfWidth: H2, nowEtMin: 1000 }), null);
});

test("pre-open nowEtMin → null (no live anchor)", () => {
  assert.equal(emConeGeometry({ spot: SPOT, sigma1HalfWidth: H1, sigma2HalfWidth: H2, nowEtMin: 540 }), null);
});

test("non-finite / non-positive inputs → null (never fabricated)", () => {
  const base = { spot: SPOT, sigma1HalfWidth: H1, sigma2HalfWidth: H2, nowEtMin: 600 };
  assert.equal(emConeGeometry({ ...base, spot: NaN }), null);
  assert.equal(emConeGeometry({ ...base, sigma1HalfWidth: 0 }), null);
  assert.equal(emConeGeometry({ ...base, sigma1HalfWidth: -5 }), null);
  assert.equal(emConeGeometry({ ...base, sigma2HalfWidth: NaN }), null);
  assert.equal(emConeGeometry({ ...base, nowEtMin: Infinity }), null);
  // Degenerate session window (close <= open).
  assert.equal(emConeGeometry({ ...base, openEtMin: 960, closeEtMin: 570 }), null);
});

test("emConeFromExpectedMove: derives H1/H2 from the band, uses live spot, honest null", () => {
  const em: ExpectedMove = {
    atmIv: 0.14,
    dteDays: 0.5,
    spot: SPOT,
    movePct: H1 / SPOT,
    bands: [
      { sigma: 1, movePts: H1, low: SPOT - H1, high: SPOT + H1 },
      { sigma: 2, movePts: H2, low: SPOT - H2, high: SPOT + H2 },
    ],
  };
  const cone = emConeFromExpectedMove(em, 7510, RTH_OPEN_ET_MIN);
  assert.ok(cone);
  // Live spot (7510) is the anchor, not em.spot (7500).
  assert.ok(Math.abs(cone![0]!.upper1 - (7510 + H1)) < 1e-6);
  // Missing σ=2 band → falls back to 2·H1.
  const em1: ExpectedMove = { ...em, bands: [em.bands[0]!] };
  const cone1 = emConeFromExpectedMove(em1, 7510, RTH_OPEN_ET_MIN);
  assert.ok(cone1);
  assert.ok(Math.abs(cone1![0]!.upper2 - (7510 + 2 * H1)) < 1e-6);
  // No band, null em, or off-hours → null.
  assert.equal(emConeFromExpectedMove(null, 7510, RTH_OPEN_ET_MIN), null);
  assert.equal(emConeFromExpectedMove({ ...em, bands: [] }, 7510, RTH_OPEN_ET_MIN), null);
  assert.equal(emConeFromExpectedMove(em, 7510, RTH_CLOSE_ET_MIN), null);
  // Null/degenerate live spot falls back to em.spot rather than nulling.
  const coneFallback = emConeFromExpectedMove(em, null, RTH_OPEN_ET_MIN);
  assert.ok(coneFallback);
  assert.ok(Math.abs(coneFallback![0]!.upper1 - (SPOT + H1)) < 1e-6);
});
