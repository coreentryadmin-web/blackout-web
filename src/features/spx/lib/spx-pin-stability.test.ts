import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isPinStable,
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
