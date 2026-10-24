import { test } from "node:test";
import assert from "node:assert/strict";

// Deterministic bound on cancellation latency for a caller queued on the OPEN circuit
// breaker (waitForCircuit's `sleepAbortable(..., up to 500ms)` branch — see the
// sleepAbortable doc comment in uw-rate-limiter.ts, which names this file). Before
// sleepAbortable existed, a poll loop only re-checked `signal.aborted` at the TOP of its
// next iteration, so an abort mid-sleep could sit unnoticed for up to that loop's own
// sleep duration. This proves the real bound is microtask-scale instead.
//
// The circuit breaker (not the concurrency cap or token bucket) is used to force a
// genuine wait, because it's the one admission stage reachable via a single caller with
// no dependency on a SECOND caller occupying a slot: forcing concurrency contention
// instead would require leaving >=1 never-resolving `throttleUw` calls alive to hold the
// cap, and every one of those still holds `ensureBreakerSubscription`'s fire-and-forget
// `import("@/lib/redis-pubsub")` promise chain reachable from module state for the rest
// of the process — which measurably (reproduced against this exact file, see PR
// description) adds a real multi-second-to-20s tail to the test file's own exit even
// after every assertion has already passed. The circuit-breaker path exercises the same
// sleepAbortable primitive without ever leaving a dangling occupier behind.
process.env.UW_CIRCUIT_429_THRESHOLD = "3";

test("throttleUw: aborting a caller queued on an OPEN circuit breaker rejects near-instantly, not bounded by the up-to-500ms circuit poll interval", async () => {
  const { throttleUw, noteUw429, resetUwCircuitForTest, isUwCircuitOpen } = await import("./uw-rate-limiter");
  resetUwCircuitForTest();
  for (let i = 0; i < 3; i++) noteUw429("test");
  assert.equal(
    isUwCircuitOpen(),
    true,
    "the breaker must actually be open for this test to exercise waitForCircuit's wait branch"
  );

  const controller = new AbortController();
  const queued = throttleUw(async () => "should-never-run", controller.signal);
  queued.catch(() => {}); // the real assertion is below; this only silences an unhandled-rejection race

  // Give the queued caller time to enter the breaker's sleepAbortable wait (up to 500ms per
  // iteration), well short of it, before aborting mid-sleep — aborting immediately would only
  // prove the `signal?.aborted` pre-check at loop-top, not the mid-sleep interrupt this test
  // exists to demonstrate.
  await new Promise((r) => setTimeout(r, 15));

  const abortedAt = Date.now();
  controller.abort();

  let latencyMs = -1;
  await assert.rejects(queued, (err: unknown) => {
    assert.ok(err instanceof DOMException, "rejection must be the AbortSignal's own DOMException");
    assert.equal((err as DOMException).name, "AbortError");
    latencyMs = Date.now() - abortedAt;
    return true;
  });

  // Generous relative to the up-to-500ms interval it would otherwise be bounded by (leaves
  // headroom for scheduler jitter under a loaded CI runner) while still proving the rejection
  // is event-driven, not "wait for the next poll tick".
  assert.ok(
    latencyMs >= 0 && latencyMs < 25,
    `abort-to-rejection latency must be well under the up-to-500ms circuit poll interval; got ${latencyMs}ms`
  );

  resetUwCircuitForTest(); // leave the module's shared breaker state closed for any later test in this file
});

test("throttleUw: a caller whose signal is ALREADY aborted before it ever reaches the poll loop rejects without waiting at all", async () => {
  const { throttleUw } = await import("./uw-rate-limiter");

  const controller = new AbortController();
  controller.abort();

  const startedAt = Date.now();
  await assert.rejects(
    () => throttleUw(async () => "should-never-run", controller.signal),
    (err: unknown) => err instanceof DOMException && err.name === "AbortError"
  );
  assert.ok(Date.now() - startedAt < 10, "an already-aborted signal must fail fast, before ever queueing");
});
