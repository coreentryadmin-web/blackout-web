import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Set a deterministic threshold BEFORE the target module loads (it reads the env at
// load time). The import is dynamic + inside each async test to avoid top-level await,
// which this project's CJS transform does not support. uw-rate-limiter.ts has no
// @/lib/* imports, so it loads cleanly under `npx tsx --test`.
process.env.UW_CIRCUIT_429_THRESHOLD = "5";
// High enough that the new onAdmitted tests below never wait on local pacing/concurrency —
// they're testing the callback wiring, not the limiter's own throughput (already covered
// elsewhere in this file).
process.env.UW_MAX_RPS = "1000";
process.env.UW_GLOBAL_MAX_RPS = "1000";

// acquireGlobalRedisSlot() is not exported (it depends on getSharedRedis()'s dynamic
// ../make-redis import + REDIS_URL env, not worth mocking here), so the composition itself is
// checked by reading the source rather than calling it — the same convention this repo already
// uses for scripts that can't be safely imported (e.g. largo-truncation-probe.test.ts). This is
// the regression guard for the 2026-09-09 live incident: acquireSlidingWindowRedisSlot's own
// reservation semantics are proven generically in provider-rate-limiter-shared.test.ts, but
// nothing proved this SPECIFIC call site actually passes the reduced ceiling rather than the raw
// GLOBAL_MAX_RPS — which is exactly the gap that let a background sweep starve live traffic's RPS
// budget while the concurrency-side reservation (already wired in below) sat unaffected.
test("acquireGlobalRedisSlot passes the RESERVED ceiling to the RPS sliding window, not the raw GLOBAL_MAX_RPS", () => {
  const src = readFileSync(fileURLToPath(new URL("./uw-rate-limiter.ts", import.meta.url)), "utf8");
  const callLine = src.split("\n").find((line) => line.includes('"blackout:uw:rps"'));
  assert.ok(callLine, "expected to find the blackout:uw:rps acquireSlidingWindowRedisSlot call site");
  assert.ok(
    callLine!.includes("reserveForLiveTraffic(GLOBAL_MAX_RPS)"),
    `the RPS ceiling must be reservation-aware, mirroring acquireGlobalRedisConcurrencySlot's reserveForLiveTraffic(GLOBAL_MAX_CONCURRENCY) below it — got: ${callLine}`
  );
  assert.ok(
    !callLine!.includes(", GLOBAL_MAX_RPS)"),
    "the raw unreserved GLOBAL_MAX_RPS must not be passed directly any more"
  );
});

test("acquireGlobalRedisConcurrencySlot (the pre-existing concurrency reservation) is unchanged by this fix", () => {
  const src = readFileSync(fileURLToPath(new URL("./uw-rate-limiter.ts", import.meta.url)), "utf8");
  assert.match(
    src,
    /acquireRedisConcurrencySlot\(\s*client,\s*UW_CONCURRENCY_REDIS_KEY,\s*reserveForLiveTraffic\(GLOBAL_MAX_CONCURRENCY\)/,
    "the concurrency-side reservation this fix mirrors must still be intact"
  );
});

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

// Regression for the alerting gap MARKET-OPEN-VALIDATION.md's 2026-09-08 13:32-14:08 UTC watch-
// list entry found and left scoped, ready to build: a 37+-minute, platform-wide sustained queue-
// timeout condition (real demand exceeding GLOBAL_MAX_RPS) had NO Discord alert anywhere — only
// `alertRedisDegradedOnce` existed, and that fires on a completely different condition (Redis
// ceiling unreachable). pruneQueueTimeoutWindow is the pure windowing logic the new
// noteQueueTimeoutForAlert/noteQueueAdmissionRecoveryForAlert pair is built on.
test("pruneQueueTimeoutWindow drops timestamps outside the window, keeps the ones inside it", async () => {
  const { pruneQueueTimeoutWindow } = await import("./uw-rate-limiter");
  const now = 100_000;
  const kept = pruneQueueTimeoutWindow([now - 70_000, now - 61_000, now - 59_999, now - 1_000, now], now, 60_000);
  assert.deepEqual(kept, [now - 59_999, now - 1_000, now]);
});

test("pruneQueueTimeoutWindow: an empty or fully-stale window prunes to empty, never throws", async () => {
  const { pruneQueueTimeoutWindow } = await import("./uw-rate-limiter");
  assert.deepEqual(pruneQueueTimeoutWindow([], 100_000, 60_000), []);
  assert.deepEqual(pruneQueueTimeoutWindow([1_000, 2_000], 100_000, 60_000), []);
});

test("queue-timeout surge alert fires only at the sustained threshold, not on a single timeout — and re-arms once the rolling count recovers", async () => {
  const {
    noteQueueTimeoutForAlert,
    noteQueueAdmissionRecoveryForAlert,
    isQueueTimeoutAlertLatched,
    resetQueueTimeoutAlertForTest,
  } = await import("./uw-rate-limiter");
  resetQueueTimeoutAlertForTest();

  let t = 0;
  const now = () => t;

  // A single isolated timeout — and even 4 of the 5-timeout threshold — must never page. This is
  // the exact case queue-budget.ts's own comment calls "normal/expected burst behavior".
  for (let i = 0; i < 4; i++) {
    noteQueueTimeoutForAlert(now);
    t += 1_000;
  }
  assert.equal(isQueueTimeoutAlertLatched(), false, "must not page below the sustained threshold");

  // The 5th timeout within the 60s window crosses the threshold — pages once.
  noteQueueTimeoutForAlert(now);
  assert.equal(isQueueTimeoutAlertLatched(), true, "must page once the sustained threshold is crossed");

  // Further timeouts while still latched must not re-page (no assertion needed beyond staying
  // latched — alertQueueTimeoutSurgeOnce's own guard is what's under test here).
  noteQueueTimeoutForAlert(now);
  assert.equal(isQueueTimeoutAlertLatched(), true);

  // A later successful admission, once the rolling window has aged the old timeouts out, re-arms
  // the latch — mirrors alertRedisDegradedOnce/clearAlertOnRedisRecovery's exact shape.
  t += 120_000; // well past the 60s window — every prior timestamp is now stale
  noteQueueAdmissionRecoveryForAlert(now);
  assert.equal(isQueueTimeoutAlertLatched(), false, "must re-arm once the rolling count drops back under threshold");
});

test("noteQueueAdmissionRecoveryForAlert is a no-op while not latched (the common healthy-admission path)", async () => {
  const { noteQueueAdmissionRecoveryForAlert, isQueueTimeoutAlertLatched, resetQueueTimeoutAlertForTest } =
    await import("./uw-rate-limiter");
  resetQueueTimeoutAlertForTest();
  assert.doesNotThrow(() => noteQueueAdmissionRecoveryForAlert());
  assert.equal(isQueueTimeoutAlertLatched(), false);
});

// throttleUw's wiring itself: acquireSlot() throws RateLimiterQueueTimeoutError deep in the
// admission stack (not worth reproducing the real timing here — see the "acquireGlobalRedisSlot
// passes the RESERVED ceiling" test above for this file's existing precedent of checking wiring
// correctness by source when simulating the real condition isn't practical). Confirms the catch
// path records the timeout via isQueueTimeout before re-throwing (never swallows the error), and
// the success path calls the recovery hook.
test("throttleUw records a queue timeout via isQueueTimeout before re-throwing, and calls the recovery hook on success", () => {
  const src = readFileSync(fileURLToPath(new URL("./uw-rate-limiter.ts", import.meta.url)), "utf8");
  const fn = src.match(/export async function throttleUw[\s\S]*?\n}/)?.[0];
  assert.ok(fn, "throttleUw() not found");
  assert.match(fn!, /catch \(err\) \{\s*if \(isQueueTimeout\(err\)\) noteQueueTimeoutForAlert\(\);\s*throw err;/);
  assert.match(fn!, /noteQueueAdmissionRecoveryForAlert\(\);/);
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

// Phase 1 instrumentation: throttleUw/throttleUwCoalesced gained an optional `onAdmitted`
// callback so a caller (unusual-whales.ts's uwGet) can thread the real queue-wait time into
// its own telemetry. Purely additive — every pre-existing 1-arg/2-arg call site above this
// point in the file (and every real production call site) is unaffected.
//
// Phase 2 (2026-09-17) inserted `signal?: AbortSignal` BETWEEN `fn` and `onAdmitted` on both
// functions (`throttleUw(fn, signal?, onAdmitted?)`, `throttleUwCoalesced(key, fn, signal?,
// onAdmitted?)`) to carry per-caller cancellation. Phase 1 had not yet shipped/merged when
// this happened, so these tests are updated in place to the new position rather than kept
// as a stale snapshot of an intermediate signature.

test("throttleUw: the legacy no-signal/no-onAdmitted call site behaves exactly as before", async () => {
  const { throttleUw } = await import("./uw-rate-limiter");
  const result = await throttleUw(async () => "legacy-ok");
  assert.equal(result, "legacy-ok");
});

test("throttleUw: onAdmitted receives the real admission wait (a number >= 0) BEFORE fn runs", async () => {
  const { throttleUw } = await import("./uw-rate-limiter");
  const order: string[] = [];
  let waitedMsSeen: number | null = null;
  const result = await throttleUw(
    async () => {
      order.push("fn");
      return "ok";
    },
    undefined, // no signal for this test
    (waitedMs) => {
      waitedMsSeen = waitedMs;
      order.push("onAdmitted");
    }
  );
  assert.equal(result, "ok");
  assert.equal(typeof waitedMsSeen, "number");
  assert.ok(waitedMsSeen! >= 0);
  assert.deepEqual(order, ["onAdmitted", "fn"], "onAdmitted must fire before fn, not after");
});

test("throttleUw: fn's own rejection is not swallowed by adding onAdmitted", async () => {
  const { throttleUw } = await import("./uw-rate-limiter");
  await assert.rejects(
    () => throttleUw(async () => { throw new Error("boom"); }, undefined, () => {}),
    /boom/
  );
});

test("throttleUwCoalesced: onAdmitted fires for the caller that triggers the fetch, not for a caller that joins the same in-flight request", async () => {
  const { throttleUwCoalesced } = await import("./uw-rate-limiter");
  let resolveFirst!: (v: string) => void;
  const inFlight = new Promise<string>((r) => { resolveFirst = r; });
  const admittedCallers: number[] = [];

  // Both calls fire synchronously (no await between them) so the second observes the
  // first's promise already registered in coalescedInflight — the real coalescing path.
  const p1 = throttleUwCoalesced("phase1-test-key", () => inFlight, undefined, () => admittedCallers.push(1));
  const p2 = throttleUwCoalesced("phase1-test-key", () => inFlight, undefined, () => admittedCallers.push(2));

  resolveFirst("shared-result");
  const [r1, r2] = await Promise.all([p1, p2]);

  assert.equal(r1, "shared-result");
  assert.equal(r2, "shared-result", "the joining caller gets the SAME result, never a second fetch");
  assert.deepEqual(
    admittedCallers,
    [1],
    "only the triggering caller's onAdmitted fires — the joining caller never itself calls acquireSlot()"
  );
});

test("throttleUwCoalesced: a distinct key after the first resolves triggers a fresh admission (no stale coalescing)", async () => {
  const { throttleUwCoalesced } = await import("./uw-rate-limiter");
  const admittedCallers: number[] = [];
  const r1 = await throttleUwCoalesced("phase1-test-key-2a", async () => "one", undefined, () => admittedCallers.push(1));
  const r2 = await throttleUwCoalesced("phase1-test-key-2b", async () => "two", undefined, () => admittedCallers.push(2));
  assert.equal(r1, "one");
  assert.equal(r2, "two");
  assert.deepEqual(admittedCallers, [1, 2], "distinct keys each get their own admission");
});

// THE ORPHANED-ENTRY REGRESSION THIS GUARDS: `coalescedInflight` (the Map throttleUwCoalesced
// keys its groups by) only cleans itself up via `void group.promise.catch(() => {}).finally(() =>
// { if (coalescedInflight.get(key) === group) coalescedInflight.delete(key) })`. If that cleanup
// never ran — or ran against the wrong group after a key was reused — a caller aborting the ONLY
// in-flight request for a key would leave that key permanently pointing at a dead, already-
// rejected group, and every future caller for that same key would join it and instantly re-reject
// with the FIRST caller's stale abort reason instead of ever running a fresh admission again.
test("throttleUwCoalesced: aborting the only caller cleans up the key's coalescedInflight entry — a later call for the SAME key gets its own fresh admission, not a dead group's stale rejection", async () => {
  const { throttleUwCoalesced } = await import("./uw-rate-limiter");
  const key = `orphan-test-${Date.now()}`;

  const controller = new AbortController();
  const first = throttleUwCoalesced(
    key,
    (signal) =>
      new Promise((_, reject) => {
        signal?.addEventListener("abort", () => reject(signal.reason));
      }),
    controller.signal
  );
  first.catch(() => {});

  controller.abort();
  await assert.rejects(first);

  // Let the group's own settle-triggered cleanup run (a separate microtask chain off the same
  // settled promise — see coalesced-abort-group.ts). A real caller always has at least this much
  // of a gap between one ticker's abort and the next ticker's own call for the same key.
  await new Promise((r) => setImmediate(r));

  // If the key were still occupied by a dead group, this would join it and instantly re-reject
  // with the first call's stale abort reason (never calling onAdmitted, never running its own
  // fetcher) instead of getting its own fresh admission.
  let secondGotOwnAdmission = false;
  const second = await throttleUwCoalesced(
    key,
    async () => "second-value",
    undefined,
    () => {
      secondGotOwnAdmission = true;
    }
  );
  assert.equal(second, "second-value", "REGRESSION: a leaked coalescedInflight entry would instead re-reject with the first call's abort reason");
  assert.equal(secondGotOwnAdmission, true, "the second call must get its OWN fresh admission — the key must not still be occupied by a dead group");
});
