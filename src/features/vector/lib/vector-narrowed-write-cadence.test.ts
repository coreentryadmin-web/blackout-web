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

test("THE CONTRACT: every rail is written on every sweep, for every ticker", () => {
  // REWRITTEN 2026-08-19. This test used to assert `mean < 2.5` — a WRITE BUDGET, because an append
  // rewrote the whole growing rail and four per ticker per tick overran the 5s sweep (#2273 ->
  // reverted by #2274). Rails are append-only lists now (one RPUSH, O(1), payload independent of
  // session length), so the budget this guarded no longer exists.
  //
  // What replaced it is a REQUIREMENT, not a compromise: a ticker's rail must not depend on whether
  // anyone is watching it. Measured before this change, one live session: SPX weekly 3845 samples
  // (viewed all day), NVDA 100, AAPL 70 — and the chart opens on weekly, so unviewed names drew one
  // level where SPX drew ten.
  const mean = meanRailWritesPerTick();
  assert.equal(mean, 4, `every tick must write blended + all three narrowed rails (got ${mean})`);
  assert.equal(railWritesForTick(0), 4, "seed tick writes everything");
  assert.equal(railWritesForTick(1), 4, "so does every ordinary tick — no rationing");
  assert.equal(railWritesForTick(97), 4, "and it never drifts with the index");
});

test("the cost guard moved to the STORAGE layer, and that is the invariant to protect", () => {
  // The thing that actually broke #2273 was not the write COUNT, it was that each write was
  // O(session length) and grew all day. That property is now owned by vector-wall-persist
  // (redisListKey / sharedListAppend) and covered by its own tests — see "a long rail costs a
  // constant-size append". This assertion exists so a future reader who wants to re-ration the
  // cadence for cost reasons looks THERE first rather than reintroducing the starvation here.
  assert.equal(NARROWED_SLOW_HORIZON_EVERY_N_TICKS, 1, "rationing is off; cost is handled in storage");
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
  assert.deepEqual(
    horizonsForTick(1),
    ["0dte", "weekly", "monthly"],
    "internal constants must be untouched"
  );
});
