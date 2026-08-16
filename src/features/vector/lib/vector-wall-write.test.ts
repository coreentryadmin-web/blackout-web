import { before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { mock } from "node:test";

mock.module("server-only", { namedExports: {} });

let appendCalls = 0;
let appendReturns = true;
let rthOpen = true;

// Relative, NOT the "@/" alias: mock.module() resolves the specifier against THIS file's directory
// and does not consult tsconfig paths, so "@/lib/et-market-hours" looked for
// src/features/vector/lib/@/lib/et-market-hours and died with ERR_MODULE_NOT_FOUND. Same convention
// the route tests use.
mock.module("../../../lib/et-market-hours", {
  namedExports: {
    isEtCashRth: () => rthOpen,
  },
});

mock.module("./vector-wall-persist", {
  namedExports: {
    appendSessionWallSample: async () => {
      appendCalls += 1;
      return appendReturns;
    },
  },
});

let writeWallHistorySample: typeof import("./vector-wall-write").writeWallHistorySample;
let getWallWriteObservabilitySnapshot: typeof import("./vector-wall-write").getWallWriteObservabilitySnapshot;
let _resetWallWriteObservabilityForTest: typeof import("./vector-wall-write")._resetWallWriteObservabilityForTest;

before(async () => {
  const mod = await import("./vector-wall-write");
  writeWallHistorySample = mod.writeWallHistorySample;
  getWallWriteObservabilitySnapshot = mod.getWallWriteObservabilitySnapshot;
  _resetWallWriteObservabilityForTest = mod._resetWallWriteObservabilityForTest;
});

// beforeEach, NOT before: every test here depends on fresh state — test 2 asserts appendCalls === 0
// after test 1 already incremented it, and test 3 needs rthOpen restored to true after test 2 set it
// false. As a one-shot `before` it also raced the async import hook above and called an
// unassigned binding ("_resetWallWriteObservabilityForTest is not a function"); beforeEach is
// ordered after all before hooks, so the binding is guaranteed to exist.
beforeEach(() => {
  appendCalls = 0;
  appendReturns = true;
  rthOpen = true;
  _resetWallWriteObservabilityForTest();
});

const sample = { time: 1000, walls: { callWalls: [{ strike: 6800, pct: 10 }], putWalls: [] } };

test("writeWallHistorySample: writes during RTH and records observability", async () => {
  const res = await writeWallHistorySample({
    source: "sse-hub",
    sessionYmd: "2026-08-07",
    ticker: "SPY",
    sample,
  });
  assert.equal(res.written, true);
  assert.equal(appendCalls, 1);
  const snap = getWallWriteObservabilitySnapshot();
  assert.equal(snap.totals["sse-hub:written"], 1);
  assert.equal(snap.lastSuccessAt["sse-hub:SPY:all"], 1000);
});

test("writeWallHistorySample: skips outside RTH by default", async () => {
  rthOpen = false;
  const res = await writeWallHistorySample({
    source: "dynamic-ticker-warm",
    sessionYmd: "2026-08-07",
    ticker: "HOOD",
    sample,
  });
  assert.equal(res.skipped, "outside_rth");
  assert.equal(appendCalls, 0);
});

test("writeWallHistorySample: append failure increments consecutiveFailures", async () => {
  appendReturns = false;
  for (let i = 0; i < 3; i++) {
    await writeWallHistorySample({
      source: "bead-recorder-universe",
      sessionYmd: "2026-08-07",
      ticker: "ASTS",
      sample: { ...sample, time: 1000 + i },
    });
  }
  const snap = getWallWriteObservabilitySnapshot();
  assert.equal(snap.consecutiveFailures.ASTS, 3);
  assert.deepEqual(snap.darkTickers, ["ASTS"]);
});

test("persistWallSampleDebounced: coalesces rapid writes in the same bucket", async () => {
  const { persistWallSampleDebounced, _resetWallPersistDebounceForTest } = await import("./vector-wall-write");
  _resetWallPersistDebounceForTest();
  appendCalls = 0;
  persistWallSampleDebounced("2026-08-07", sample, "SPY");
  persistWallSampleDebounced("2026-08-07", sample, "SPY");
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(appendCalls, 1);
});
