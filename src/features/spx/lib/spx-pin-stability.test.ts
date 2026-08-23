import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isPinStable,
  nextConfirmedPin,
  pushPinSample,
  PIN_STABILITY_WINDOW,
  PIN_STABILITY_TOLERANCE_PTS,
} from "./spx-pin-stability";

test("isPinStable: false with fewer than window samples", () => {
  assert.equal(isPinStable([7600]), false);
  assert.equal(isPinStable([7600, 7600]), false); // window defaults to 3
});

test("isPinStable: true when the last N samples agree within tolerance", () => {
  assert.equal(isPinStable([7600, 7602, 7599]), true);
  assert.equal(isPinStable([7600, 7600, 7600, 7600]), true);
});

test("isPinStable: false when the trailing window disagrees beyond tolerance", () => {
  assert.equal(isPinStable([7600, 7602, 7650]), false); // last-3 spread 51pts >> 5pt tolerance
});

test("isPinStable: only the TRAILING window matters — an old disagreement ages out", () => {
  // 7300 is stale by the time the trailing 3 (7600,7601,7599) are evaluated.
  assert.equal(isPinStable([7300, 7600, 7601, 7599]), true);
});

test("isPinStable: any null in the trailing window breaks the streak (no skip-over-gaps)", () => {
  assert.equal(isPinStable([7600, null, 7600, 7600]), false);
});

test("isPinStable: respects a custom tolerance", () => {
  assert.equal(isPinStable([7600, 7605, 7595], 10), true);
  assert.equal(isPinStable([7600, 7605, 7595], 4), false);
});

test("isPinStable: respects a custom window", () => {
  assert.equal(isPinStable([7600, 7600], PIN_STABILITY_TOLERANCE_PTS, 2), true);
  assert.equal(isPinStable([7600, 7700], PIN_STABILITY_TOLERANCE_PTS, 2), false);
});

test("pushPinSample: appends and bounds to maxLen (default = window)", () => {
  let h: (number | null)[] = [];
  h = pushPinSample(h, 7600);
  h = pushPinSample(h, 7601);
  h = pushPinSample(h, 7602);
  h = pushPinSample(h, 7603);
  assert.deepEqual(h, [7601, 7602, 7603]);
  assert.equal(h.length, PIN_STABILITY_WINDOW);
});

test("pushPinSample: a null sample RESETS the window instead of appending", () => {
  let h: (number | null)[] = [7600, 7601, 7602];
  h = pushPinSample(h, null);
  assert.deepEqual(h, [null]);
});

test("pushPinSample: a non-finite sample (NaN/Infinity) is treated as unavailable", () => {
  const h = pushPinSample([7600, 7601], NaN);
  assert.deepEqual(h, [null]);
});

test("end-to-end: three agreeing polls confirm, one wild poll un-confirms, re-agreement re-confirms", () => {
  let h: (number | null)[] = [];
  const polls = [7600, 7601, 7599, 7650, 7648, 7651];
  const stableAt: boolean[] = [];
  for (const p of polls) {
    h = pushPinSample(h, p);
    stableAt.push(isPinStable(h));
  }
  assert.deepEqual(stableAt, [false, false, true, false, false, true]);
});

// ── nextConfirmedPin: the "held steady" half of the contract ────────────────────────────────────
//
// Regression for the defect measured live 2026-08-07: `pinConfirmed === pin` on 16/16 consecutive
// observations while the "confirmed" pin travelled 9.8 points in six minutes. The old wrapper did
// `if (stable) confirmed = latest`, so the held value tracked the raw pin instead of resisting it.

test("nextConfirmedPin: an unstable window never moves the displayed number", () => {
  // A single wild poll breaks the window; whatever is displayed must survive it untouched.
  assert.equal(nextConfirmedPin(7700, [7700, 7702, 7850]), 7700);
  assert.equal(nextConfirmedPin(7700, [7700, null, 7701]), 7700);
  // ...including before anything has ever been confirmed.
  assert.equal(nextConfirmedPin(null, [7700, 7850, 7600]), null);
});

test("nextConfirmedPin: first stable cluster of the session is adopted", () => {
  assert.equal(nextConfirmedPin(null, [7700, 7701, 7703]), 7703);
});

test("REGRESSION: a stable cluster that AGREES with the held value does not move it", () => {
  // This is the line whose absence was the bug. Every one of these is within tolerance (5pts) of
  // 7700, so the member-facing number must not budge — previously each returned `latest`.
  assert.equal(nextConfirmedPin(7700, [7701, 7702, 7703]), 7700);
  assert.equal(nextConfirmedPin(7700, [7699, 7698, 7697]), 7700);
  assert.equal(nextConfirmedPin(7700, [7703, 7704, 7705]), 7700, "exactly at tolerance still holds");
});

test("REGRESSION: the 2026-08-07 drift — 9.8pts of wiggle no longer drags the displayed pin", () => {
  // Replays the shape of the live capture: a slow walk, each step tiny, each window internally
  // agreeing. The old code re-stamped `confirmed` every pass and followed the walk all the way.
  const walk = [7721.33, 7722.4, 7723.1, 7724.0, 7725.2, 7726.1, 7727.0, 7728.2, 7729.4, 7730.1, 7731.15];
  let held: number | null = null;
  let samples: (number | null)[] = [];
  for (const p of walk) {
    samples = pushPinSample(samples, p);
    held = nextConfirmedPin(held, samples);
  }
  assert.notEqual(held, 7731.15, "must not have tracked the raw pin to the end of the walk");
  assert.ok(held != null && Math.abs(held - 7721.33) < 12, `held near the first cluster, got ${held}`);
});

test("a GENUINE relocation still comes through — holding a stale pin would be its own lie", () => {
  // Beyond tolerance: the book really moved, so the number must follow.
  assert.equal(nextConfirmedPin(7700, [7740, 7741, 7742]), 7742);
});

test("nextConfirmedPin is pure — it never mutates the sample window", () => {
  const samples = [7700, 7701, 7702];
  const copy = [...samples];
  nextConfirmedPin(7690, samples);
  assert.deepEqual(samples, copy);
});

test("a non-finite held value is replaced rather than held", () => {
  assert.equal(nextConfirmedPin(Number.NaN, [7700, 7701, 7702]), 7702);
});
