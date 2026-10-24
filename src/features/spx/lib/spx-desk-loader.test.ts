import { test, mock } from "node:test";
import assert from "node:assert/strict";

test("loadSpxDesk, loadSpxDeskPulse, and loadSpxDeskFlow share one cache lane each with loadMergedSpxDesk (regression: bare keys raced date-scoped loader keys); peekMergedSpxDesk() is a true non-blocking peek (2026-10-18 fix)", async () => {
  let deskCount = 0;
  let pulseCount = 0;
  let flowCount = 0;
  mock.module("./spx-desk", {
    namedExports: {
      buildSpxDesk: async () => ({ marker: ++deskCount }),
      buildSpxDeskFlow: async () => ({ marker: ++flowCount }),
      buildSpxDeskPulse: async () => ({ marker: ++pulseCount }),
      buildSpxDeskPulseMinimal: async () => ({ marker: ++pulseCount }),
      deskShellFromPulse: (pulse: { marker?: number }) => ({ marker: ++deskCount, pulse }),
    },
  });
  // A fixed, test-only session date so this test's cache entries can never collide with a
  // real "today" key used elsewhere in the process.
  mock.module("../../../lib/providers/spx-session", {
    namedExports: {
      todayEtYmd: () => "2099-01-01",
    },
  });
  mock.module("./spx-desk-merge", {
    namedExports: {
      mergeDeskLayers: (desk: unknown) => desk,
    },
  });

  const { loadSpxDesk, loadSpxDeskPulse, loadSpxDeskFlow, loadMergedSpxDesk, peekMergedSpxDesk } =
    await import("./spx-desk-loader");

  // REGRESSION (Ask Largo standing mandate, 2026-10-18 — live repro: closed-market SPX Slayer
  // reads reliably timing out off-hours/weekends because evaluateSpxPlayState's own
  // `await loadMergedSpxDesk()` could legitimately take up to deskBootstrapMaxBlockMs() on a cold
  // cache, exceeding the much tighter outer playMemberReadMaxBlockMs() budget before the
  // closed-market fast path was ever reached). peekMergedSpxDesk() must be a TRUE non-blocking
  // peek — never invoking the real builders — before anything has been built under this key yet.
  const beforeBuild = await peekMergedSpxDesk();
  assert.equal(beforeBuild, null, "a peek before any load must return null, not trigger a build");
  assert.equal(deskCount, 0, "peekMergedSpxDesk() must never invoke buildSpxDesk");

  const fromStandaloneDesk = await loadSpxDesk();
  const fromStandalonePulse = await loadSpxDeskPulse();
  const fromStandaloneFlow = await loadSpxDeskFlow();
  const merged = await loadMergedSpxDesk();

  assert.equal(
    deskCount,
    1,
    "buildSpxDesk ran more than once — loadSpxDesk() and loadMergedSpxDesk() are using different cache keys again"
  );
  assert.equal(
    pulseCount,
    1,
    "buildSpxDeskPulse ran more than once — pulse cache key mismatch between standalone route and loader"
  );
  assert.equal(
    flowCount,
    1,
    "buildSpxDeskFlow ran more than once — flow cache key mismatch between standalone route and loader"
  );
  assert.deepEqual(fromStandaloneDesk, merged.desk);
  assert.deepEqual(fromStandalonePulse, merged.pulse);
  assert.deepEqual(fromStandaloneFlow, merged.flow);

  // Now that loadMergedSpxDesk() has cached a bundle under this key, a peek must return the
  // SAME bundle without rebuilding anything — confirming it's a true non-blocking peek, not a
  // second builder invocation.
  const peeked = await peekMergedSpxDesk();
  assert.deepEqual(peeked, merged, "peekMergedSpxDesk() must return the SAME bundle loadMergedSpxDesk() just cached");
  assert.equal(deskCount, 1, "peekMergedSpxDesk() must not rebuild — deskCount must stay at 1");
  assert.equal(pulseCount, 1, "peekMergedSpxDesk() must not rebuild the pulse layer either");
  assert.equal(flowCount, 1, "peekMergedSpxDesk() must not rebuild the flow layer either");

  mock.restoreAll();
});
