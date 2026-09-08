import { test } from "node:test";
import assert from "node:assert/strict";

// Set a deterministic threshold BEFORE the target module loads (it reads the env at
// load time). The import is dynamic + inside each async test to avoid top-level await,
// which this project's CJS transform does not support. uw-rate-limiter.ts has no
// @/lib/* imports, so it loads cleanly under `npx tsx --test`.
process.env.UW_CIRCUIT_429_THRESHOLD = "5";

test("breaker trips at exactly THRESHOLD distinct 429s, not half (the double-count regression guard)", async () => {
  const { noteUw429, isUwCircuitOpen, resetUwCircuitForTest } = await import("./uw-rate-limiter");
  resetUwCircuitForTest();
  for (let i = 0; i < 4; i++) noteUw429("test");
  // 4 < 5 -> still closed. If a 429 were double-counted, 4 calls would register 8 and
  // the breaker would (wrongly) already be open here.
  assert.equal(isUwCircuitOpen(), false, "breaker opened too early — 429 likely double-counted");
  noteUw429("test"); // 5th -> reaches threshold
  assert.equal(isUwCircuitOpen(), true, "breaker should open at the configured threshold");
});

test("reset clears breaker state between cases", async () => {
  const { isUwCircuitOpen, resetUwCircuitForTest } = await import("./uw-rate-limiter");
  resetUwCircuitForTest();
  assert.equal(isUwCircuitOpen(), false);
});

test("computeDegradedLocalRps divides the global budget across replicas — exact cluster cap (gap #1)", async () => {
  const { computeDegradedLocalRps } = await import("./uw-rate-limiter");
  // 1 replica → full budget: no regression for the common single-replica case (it IS the cluster).
  assert.equal(computeDegradedLocalRps(2, 1), 2);
  // N replicas → GLOBAL/N, so the cluster sum (N * per-replica) equals GLOBAL exactly, never N*MAX.
  assert.equal(computeDegradedLocalRps(2, 2), 1);
  assert.equal(computeDegradedLocalRps(2, 4), 0.5);
  // Fractional is intentional: a floor-to-1 would yield 1 at N=3 and breach (cluster 3 > 2 ceiling).
  assert.ok(Math.abs(computeDegradedLocalRps(2, 3) - 2 / 3) < 1e-9);
  assert.ok(Math.abs(3 * computeDegradedLocalRps(2, 3) - 2) < 1e-9, "3 replicas must sum to the 2-rps ceiling");
  // Polygon-scale budget divides the same way (40 rps / 3 replicas).
  assert.ok(Math.abs(computeDegradedLocalRps(40, 3) - 40 / 3) < 1e-9);
  // Guards: a misconfigured replica count never produces 0 / negative / NaN pacing.
  assert.equal(computeDegradedLocalRps(2, 0), 2, "floor(0) must clamp the divisor to 1");
  assert.equal(computeDegradedLocalRps(2, 1000), 0.1, "absurd replica count clamps to the starvation floor");
});

test("computeDegradedLocalConcurrency divides in-flight budget across replicas", async () => {
  const { computeDegradedLocalConcurrency } = await import("./uw-rate-limiter");
  assert.equal(computeDegradedLocalConcurrency(2, 1), 2);
  assert.equal(computeDegradedLocalConcurrency(2, 2), 1);
  assert.equal(computeDegradedLocalConcurrency(2, 3), 1);
  assert.equal(computeDegradedLocalConcurrency(3, 3), 1);
});

// Regression for vector-dark-pool-warm's unbounded fan-out (measured live 2026-09-02: firing
// all ~55 universe tickers' UW fetches via Promise.allSettled at once overwhelmed the rate
// limiter's 20s admission-queue budget, 83-95% per-run ticker failures). runUwPool is the fix
// callers reach for; this proves the primitive itself actually bounds concurrency rather than
// just documenting an intent in its docstring.
test("runUwPool never runs more than `concurrency` tasks at once", async () => {
  const { runUwPool } = await import("./uw-rate-limiter");
  let inFlight = 0;
  let maxInFlight = 0;
  const tasks = Array.from({ length: 20 }, (_, i) => async () => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 1));
    inFlight -= 1;
    return i;
  });

  const results = await runUwPool(tasks, 3);

  assert.deepEqual(results, tasks.map((_, i) => i), "results preserve input order despite pooled execution");
  assert.ok(maxInFlight <= 3, `expected at most 3 concurrent tasks, saw ${maxInFlight}`);
  assert.ok(maxInFlight > 1, "sanity: the pool should actually overlap work, not degrade to fully sequential");
});

test("runUwPool tolerates an unbounded task count without ever exceeding its concurrency cap", async () => {
  const { runUwPool } = await import("./uw-rate-limiter");
  let inFlight = 0;
  let maxInFlight = 0;
  const tasks = Array.from({ length: 55 }, () => async () => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await Promise.resolve();
    inFlight -= 1;
    return null;
  });

  await runUwPool(tasks, 3);

  assert.ok(maxInFlight <= 3, `55-task fan-out must still respect the concurrency cap, saw ${maxInFlight}`);
});

// Regression for the RTH ALB tail-latency finding (measured live 2026-09-03): vector-full-state-
// snapshot / vector-dark-pool-warm / bie-full-state-snapshot / vector-pick-sweep each already
// carry an overlap guard against a SECOND instance of the SAME cron, but a single non-overlapping
// run still occupied the whole cluster-wide UW concurrency ceiling (as few as 2 slots) for
// 90-286s, racing live member requests for the same slots (ALB Max ~119s, p99 up to 39s in the
// same windows). runWithBackgroundUwSweep/reserveForLiveTraffic is the fix: a tagged background
// sweep must never see the FULL ceiling, so it can never claim the last slot away from live
// traffic — these tests prove the reservation math and, critically, that it does NOT leak into a
// concurrent call outside the tagged context (the whole point is to leave live traffic untouched).
test("reserveForLiveTraffic leaves the ceiling untouched outside a background sweep", async () => {
  const { reserveForLiveTraffic } = await import("./uw-rate-limiter");
  assert.equal(reserveForLiveTraffic(2), 2);
  assert.equal(reserveForLiveTraffic(1), 1);
  assert.equal(reserveForLiveTraffic(3), 3);
});

test("reserveForLiveTraffic reserves exactly one slot for live traffic inside runWithBackgroundUwSweep", async () => {
  const { reserveForLiveTraffic, runWithBackgroundUwSweep } = await import("./uw-rate-limiter");
  const observed = await runWithBackgroundUwSweep(async () => reserveForLiveTraffic(2));
  assert.equal(observed, 1, "a 2-slot ceiling must reserve down to 1 for a tagged background sweep");
  const observedWide = await runWithBackgroundUwSweep(async () => reserveForLiveTraffic(3));
  assert.equal(observedWide, 2, "a 3-slot ceiling reserves down to 2");
});

test("reserveForLiveTraffic never floors below 1 even at a 1-slot ceiling (never fully blocks the sweep itself)", async () => {
  const { reserveForLiveTraffic, runWithBackgroundUwSweep } = await import("./uw-rate-limiter");
  const observed = await runWithBackgroundUwSweep(async () => reserveForLiveTraffic(1));
  assert.equal(observed, 1);
});

// Regression for the observability gap found investigating the live /vector contract-picks
// timeout (RUN-LOG.md, 2026-09-04): a request that queued for the limiter and then SUCCEEDED
// left no trace anywhere — RateLimiterQueueTimeoutError only throws once the budget is fully
// EXHAUSTED, so the whole admitted-but-slow middle of the distribution was invisible. This is
// the pure formatter throttleUw now calls; testing it directly avoids simulating real contention.
test("formatQueueWaitLog: below threshold is silent (the common, uncontended path)", async () => {
  const { formatQueueWaitLog } = await import("./uw-rate-limiter");
  assert.equal(formatQueueWaitLog(0, false), null);
  assert.equal(formatQueueWaitLog(499, false), null);
});

test("formatQueueWaitLog: at/above threshold logs the wait, tagged by caller type", async () => {
  const { formatQueueWaitLog } = await import("./uw-rate-limiter");
  assert.equal(formatQueueWaitLog(500, false), "[uw] queue wait 500ms");
  assert.equal(
    formatQueueWaitLog(15000, true),
    "[uw] queue wait 15000ms (background sweep)",
    "a background-sweep wait must be tagged so it is never conflated with a live-traffic wait when reading logs back"
  );
});

test("runWithBackgroundUwSweep does not leak into a concurrent call outside its context (AsyncLocalStorage isolation)", async () => {
  const { reserveForLiveTraffic, runWithBackgroundUwSweep } = await import("./uw-rate-limiter");
  const [inSweep, outsideSweep] = await Promise.all([
    runWithBackgroundUwSweep(async () => {
      await new Promise((r) => setTimeout(r, 10));
      return reserveForLiveTraffic(2);
    }),
    (async () => {
      await new Promise((r) => setTimeout(r, 5));
      return reserveForLiveTraffic(2);
    })(),
  ]);
  assert.equal(inSweep, 1, "the tagged call sees the reserved ceiling");
  assert.equal(
    outsideSweep,
    2,
    "a concurrent UNTAGGED call must see the FULL ceiling — live traffic is unaffected by a sweep running alongside it"
  );
});
