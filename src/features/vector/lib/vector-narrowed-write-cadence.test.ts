import test from "node:test";
import assert from "node:assert/strict";

import {
  NARROWED_SLOW_HORIZON_EVERY_N_TICKS,
  horizonsForTick,
  meanRailWritesPerTick,
  railWritesForTick,
} from "./vector-narrowed-write-cadence";

test("0DTE writes on EVERY tick — it is the rail the 5s requirement is about", () => {
  for (let i = 0; i < 40; i++) {
    assert.ok(horizonsForTick(i).includes("0dte"), `tick ${i} must write 0dte`);
  }
});

test("weekly and monthly write every Nth tick, and always together", () => {
  const n = NARROWED_SLOW_HORIZON_EVERY_N_TICKS;
  for (let i = 0; i < n * 3; i++) {
    const h = horizonsForTick(i);
    const slow = h.includes("weekly");
    assert.equal(h.includes("monthly"), slow, "weekly and monthly must not diverge");
    assert.equal(slow, i % n === 0, `tick ${i}`);
  }
});

test("tick 0 seeds ALL rails so a fresh replica is never blank on weekly/monthly", () => {
  // An empty rail and a coarse rail look identical to a reader; only one of them is honest.
  assert.deepEqual(horizonsForTick(0).sort(), ["0dte", "monthly", "weekly"]);
});

test("THE BUDGET: mean writes per ticker stay well under the 4 that got #2273 reverted", () => {
  // #2273 wrote 1 blended + 3 narrowed = 4 every tick (~122 -> ~488 per 5s tick), the sweep
  // overran, and the healthy blended rail regressed from 5s to 10-25s.
  const mean = meanRailWritesPerTick();
  assert.ok(mean < 2.5, `mean ${mean} must stay far below 4`);
  assert.ok(mean >= 2, `mean ${mean} must still be writing 0dte every tick`);

  // Spelled out: 11 ticks of 2 writes + 1 tick of 4.
  assert.equal(railWritesForTick(0), 4, "seed tick writes everything");
  assert.equal(railWritesForTick(1), 2, "ordinary tick writes blended + 0dte only");
});

test("cadence is a pure function of the index — deterministic across replicas", () => {
  for (const i of [0, 1, 7, 12, 13, 99]) {
    assert.deepEqual(horizonsForTick(i), horizonsForTick(i), "same input, same output");
  }
  assert.deepEqual(horizonsForTick(12), horizonsForTick(24), "one full cycle apart");
});

test("a nonsense tick index degrades to the seed tick rather than throwing or writing nothing", () => {
  for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY, 1.7]) {
    const h = horizonsForTick(bad as number);
    assert.ok(h.includes("0dte"), `index ${String(bad)} must still write the fast rail`);
  }
});

test("the returned array is a copy — a caller cannot mutate the schedule", () => {
  const h = horizonsForTick(1);
  h.push("all");
  assert.deepEqual(horizonsForTick(1), ["0dte"], "internal constants must be untouched");
});
