import { test } from "node:test";
import assert from "node:assert/strict";

// Deterministic bound on cancellation latency for a caller queued on the OPEN circuit
// breaker (waitForCircuit's `sleepAbortable(..., up to 500ms)` branch — see the
// sleepAbortable doc comment in polygon-rate-limiter.ts). Mirrors
// uw-rate-limiter-abort-latency.test.ts exactly, adapted for this file's own exported
// admission primitive (acquirePolygonSlot) and circuit-breaker test hooks.
process.env.POLYGON_CIRCUIT_429_THRESHOLD = "3";

test("acquirePolygonSlot: aborting a caller queued on an OPEN circuit breaker rejects near-instantly, not bounded by the up-to-500ms circuit poll interval", async () => {
  const { acquirePolygonSlot, notePolygon429, resetPolygonCircuitForTest, isPolygonCircuitOpen } =
    await import("./polygon-rate-limiter");
  resetPolygonCircuitForTest();
  for (let i = 0; i < 3; i++) notePolygon429("test");
  assert.equal(
    isPolygonCircuitOpen(),
    true,
    "the breaker must actually be open for this test to exercise waitForCircuit's wait branch"
  );

  const controller = new AbortController();
  const queued = acquirePolygonSlot(undefined, controller.signal);
  queued.catch(() => {}); // the real assertion is below; this only silences an unhandled-rejection race

  // Give the queued caller time to enter the breaker's sleepAbortable wait (up to 500ms per
  // iteration), well short of it, before aborting mid-sleep.
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

  assert.ok(
    latencyMs >= 0 && latencyMs < 25,
    `abort-to-rejection latency must be well under the up-to-500ms circuit poll interval; got ${latencyMs}ms`
  );

  resetPolygonCircuitForTest(); // leave the module's shared breaker state closed for any later test in this file
});

test("acquirePolygonSlot: a caller whose signal is ALREADY aborted before it ever reaches the poll loop rejects without waiting at all", async () => {
  const { acquirePolygonSlot } = await import("./polygon-rate-limiter");

  const controller = new AbortController();
  controller.abort();

  const startedAt = Date.now();
  await assert.rejects(
    () => acquirePolygonSlot(undefined, controller.signal),
    (err: unknown) => err instanceof DOMException && err.name === "AbortError"
  );
  assert.ok(Date.now() - startedAt < 10, "an already-aborted signal must fail fast, before ever queueing");
});
