import test from "node:test";
import assert from "node:assert/strict";
import { computeMomentumAcceleration, type MomentumBar } from "./momentum-acceleration.ts";

const etMs = (h: number, m = 0) => Date.parse(`2026-10-21T${String(h + 4).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`);

function bar(h: number, m: number, c: number): MomentumBar {
  return { t: etMs(h, m), h: c + 0.01, l: c - 0.01, c, v: 1000 };
}

test("computeMomentumAcceleration: flat tape -> no acceleration, no direction", () => {
  const bars: MomentumBar[] = [];
  for (let m = 0; m < 10; m++) bars.push(bar(10, m, 100));
  const r = computeMomentumAcceleration({ bars, recentWindowMin: 5, priorWindowMin: 5 });
  assert.equal(r.direction, null);
  assert.equal(r.accelerating, false);
});

test("computeMomentumAcceleration: steady linear climb (NOT accelerating) — recent and prior moves are equal", () => {
  const bars: MomentumBar[] = [];
  for (let m = 0; m < 10; m++) bars.push(bar(10, m, 100 + m * 0.1)); // +0.1 every bar, constant pace
  const r = computeMomentumAcceleration({ bars, recentWindowMin: 5, priorWindowMin: 5 });
  assert.equal(r.accelerating, false, "a constant-pace climb has recent ~= prior move, not accelerating");
});

test("computeMomentumAcceleration: genuinely accelerating up move -> direction up, accelerating true", () => {
  const bars: MomentumBar[] = [];
  // prior window (bars 0-4): slow climb 100 -> 100.2 (+0.2%)
  for (let m = 0; m < 5; m++) bars.push(bar(10, m, 100 + m * 0.04));
  // recent window (bars 5-9): fast climb 100.2 -> 102.2 (+2%)
  for (let m = 5; m < 10; m++) bars.push(bar(10, m, 100.2 + (m - 5) * 0.4));
  const r = computeMomentumAcceleration({ bars, recentWindowMin: 5, priorWindowMin: 5 });
  assert.equal(r.direction, "up");
  assert.equal(r.accelerating, true);
  assert.ok(r.recent_move_pct! > r.prior_move_pct!);
});

test("computeMomentumAcceleration: accelerating DOWN move -> direction down", () => {
  const bars: MomentumBar[] = [];
  for (let m = 0; m < 5; m++) bars.push(bar(10, m, 100 - m * 0.04));
  for (let m = 5; m < 10; m++) bars.push(bar(10, m, 99.8 - (m - 5) * 0.4));
  const r = computeMomentumAcceleration({ bars, recentWindowMin: 5, priorWindowMin: 5 });
  assert.equal(r.direction, "down");
  assert.equal(r.accelerating, true);
});

test("computeMomentumAcceleration: a reversal (recent move opposite sign of prior) is NOT 'accelerating' in the prior direction", () => {
  const bars: MomentumBar[] = [];
  for (let m = 0; m < 5; m++) bars.push(bar(10, m, 100 + m * 0.3)); // up
  for (let m = 5; m < 10; m++) bars.push(bar(10, m, 101.5 - (m - 5) * 0.3)); // reversing down
  const r = computeMomentumAcceleration({ bars, recentWindowMin: 5, priorWindowMin: 5 });
  assert.equal(r.accelerating, false, "sign flip is a reversal, not confirmed acceleration");
});

test("computeMomentumAcceleration: a move below minMovePct floor never reads accelerating (noise floor)", () => {
  const bars: MomentumBar[] = [];
  for (let m = 0; m < 5; m++) bars.push(bar(10, m, 100 + m * 0.0002));
  for (let m = 5; m < 10; m++) bars.push(bar(10, m, 100.001 + (m - 5) * 0.001));
  const r = computeMomentumAcceleration({ bars, recentWindowMin: 5, priorWindowMin: 5, minMovePct: 0.05 });
  assert.equal(r.accelerating, false);
});

test("computeMomentumAcceleration: too few bars -> null direction, never a guess", () => {
  const bars: MomentumBar[] = [bar(10, 0, 100), bar(10, 1, 100.1)];
  const r = computeMomentumAcceleration({ bars, recentWindowMin: 5, priorWindowMin: 5 });
  assert.equal(r.direction, null);
  assert.equal(r.recent_move_pct, null);
  assert.equal(r.prior_move_pct, null);
});

test("computeMomentumAcceleration: key_level_break reads 'above' when last close clears the reference high", () => {
  const bars: MomentumBar[] = [];
  for (let m = 0; m < 5; m++) bars.push(bar(10, m, 100 + m * 0.04));
  for (let m = 5; m < 10; m++) bars.push(bar(10, m, 100.2 + (m - 5) * 0.4));
  const r = computeMomentumAcceleration({
    bars,
    recentWindowMin: 5,
    priorWindowMin: 5,
    referenceLevel: { high: 101, low: 99 },
  });
  assert.equal(r.key_level_break, "above");
});

test("computeMomentumAcceleration: confirmed=true only when accelerating direction AND key-level break agree", () => {
  const bars: MomentumBar[] = [];
  for (let m = 0; m < 5; m++) bars.push(bar(10, m, 100 + m * 0.04));
  for (let m = 5; m < 10; m++) bars.push(bar(10, m, 100.2 + (m - 5) * 0.4));
  const confirmed = computeMomentumAcceleration({
    bars,
    recentWindowMin: 5,
    priorWindowMin: 5,
    referenceLevel: { high: 101, low: 99 },
  });
  assert.equal(confirmed.confirmed, true);

  // Same acceleration, but the reference level hasn't actually broken (last close still inside) -> not confirmed.
  const notBroken = computeMomentumAcceleration({
    bars,
    recentWindowMin: 5,
    priorWindowMin: 5,
    referenceLevel: { high: 500, low: -500 },
  });
  assert.equal(notBroken.confirmed, false);
});

test("computeMomentumAcceleration: confirmed=false when accelerating but no referenceLevel supplied (never guesses a break)", () => {
  const bars: MomentumBar[] = [];
  for (let m = 0; m < 5; m++) bars.push(bar(10, m, 100 + m * 0.04));
  for (let m = 5; m < 10; m++) bars.push(bar(10, m, 100.2 + (m - 5) * 0.4));
  const r = computeMomentumAcceleration({ bars, recentWindowMin: 5, priorWindowMin: 5 });
  assert.equal(r.accelerating, true);
  assert.equal(r.key_level_break, null);
  assert.equal(r.confirmed, false);
});

test("computeMomentumAcceleration: accelerating UP but key level broken the OPPOSITE way (below) -> not confirmed", () => {
  const bars: MomentumBar[] = [];
  for (let m = 0; m < 5; m++) bars.push(bar(10, m, 100 + m * 0.04));
  for (let m = 5; m < 10; m++) bars.push(bar(10, m, 100.2 + (m - 5) * 0.4));
  const r = computeMomentumAcceleration({
    bars,
    recentWindowMin: 5,
    priorWindowMin: 5,
    referenceLevel: { high: 1000, low: 500 }, // last close (102.2) reads "below" this absurd range
  });
  assert.equal(r.key_level_break, "below");
  assert.equal(r.confirmed, false, "break direction disagrees with acceleration direction");
});

test("computeMomentumAcceleration: bars supplied out of order are sorted internally before windowing", () => {
  const ordered: MomentumBar[] = [];
  for (let m = 0; m < 5; m++) ordered.push(bar(10, m, 100 + m * 0.04));
  for (let m = 5; m < 10; m++) ordered.push(bar(10, m, 100.2 + (m - 5) * 0.4));
  const shuffled = [...ordered].reverse();
  const a = computeMomentumAcceleration({ bars: ordered, recentWindowMin: 5, priorWindowMin: 5 });
  const b = computeMomentumAcceleration({ bars: shuffled, recentWindowMin: 5, priorWindowMin: 5 });
  assert.deepEqual(a, b);
});
