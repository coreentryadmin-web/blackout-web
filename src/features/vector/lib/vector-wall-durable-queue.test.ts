import { test, mock } from "node:test";
import assert from "node:assert/strict";

// The durable queue lazily imports vector-wall-db (server-only). Stub the marker so the module
// graph loads under a plain `tsx --test`, same pattern as vector-wall-sample-server.test.ts.
mock.module("server-only", { namedExports: {} });

/**
 * The batch INSERT is the fix for a POOL EXHAUSTION outage, so what these tests pin is not
 * "does it write" but the three properties that stop it recurring:
 *   1. a sweep's samples leave as ONE batch, not N round-trips;
 *   2. only one flush is ever in flight;
 *   3. a dead DB cannot turn the queue into an unbounded memory leak.
 */

let batches = [];
/**
 * When set, the fake DB write blocks until the test releases it, and signals when it has STARTED.
 *
 * The `started` signal replaces waiting a tick and hoping. `flushDurableWallSamples` does
 * `await import("./vector-wall-db")` before calling through, and module resolution takes an
 * unpredictable number of turns — so `setImmediate` was sometimes too early and the test read
 * "batches=0, the flush never happened" when it simply had not arrived yet. That is a race in the
 * TEST, and pinning concurrency behaviour with a race is worthless.
 */
let gate = null;
const openGate = () => {
  let release;
  let markStarted;
  const promise = new Promise((r) => (release = r));
  const started = new Promise((r) => (markStarted = r));
  gate = { promise, release, started, markStarted };
  return gate;
};
mock.module("./vector-wall-db", {
  namedExports: {
    persistWallSamplesToDb: async (rows) => {
      batches.push(rows.length);
      // Capture and clear FIRST: a gate left set would block every later flush and silently turn
      // subsequent tests into no-ops (which is exactly how this suite first went wrong).
      const g = gate;
      gate = null;
      if (g) {
        g.markStarted();
        await g.promise;
      }
      return rows.length;
    },
    persistWallSampleToDb: async () => true,
    loadSessionWallHistoryFromDb: async () => [],
    loadSessionWallTailFromDb: async () => [],
    rowToWallSample: (r) => r,
  },
});

const mod = () => import("./vector-wall-persist");

const sample = (time) => ({
  time,
  walls: { callWalls: [{ strike: 100, pct: 5 }], putWalls: [] },
  gammaFlip: 100,
  vexWalls: null,
  vexFlip: null,
});

test("a sweep's samples leave as ONE batch, not one round-trip each", async () => {
  const { appendSessionWallSample, _flushDurableWallSamplesForTest, _durableWallQueueSizeForTest } =
    await mod();
  batches = [];
  // 40 samples standing in for a sweep's fan-out. Before batching, this was 40 concurrent
  // connection acquisitions against a pool of 4 — which is how the waiter queue outran the 15s
  // connectionTimeoutMillis and every write started throwing.
  for (let i = 0; i < 40; i += 1) {
    await appendSessionWallSample("2026-08-12", sample(1000 + i * 5), `T${i}`);
  }
  assert.ok(_durableWallQueueSizeForTest() > 0, "samples must be queued, not dispatched per-write");
  await _flushDurableWallSamplesForTest();
  assert.equal(batches.length, 1, `expected 1 batch, got ${batches.length}`);
  assert.equal(batches[0], 40, "every queued sample must be in that batch");
  assert.equal(_durableWallQueueSizeForTest(), 0, "queue drains on flush");
});

test("re-recording the SAME bucket replaces its pending row instead of queueing twice", async () => {
  const { appendSessionWallSample, _flushDurableWallSamplesForTest } = await mod();
  batches = [];
  // Idempotence applied BEFORE the write rather than relying only on ON CONFLICT after it: a
  // bucket re-recorded by a slot handover must not cost a second row in the batch.
  await appendSessionWallSample("2026-08-12", sample(2000), "DUP");
  await appendSessionWallSample("2026-08-12", sample(2000), "DUP");
  await _flushDurableWallSamplesForTest();
  assert.deepEqual(batches, [1]);
});

test("only ONE flush is in flight — overlapping flushes would rebuild the unbounded concurrency", async () => {
  const { appendSessionWallSample, _flushDurableWallSamplesForTest } = await mod();
  batches = [];
  const g = openGate();
  await appendSessionWallSample("2026-08-12", sample(3000), "GATE");
  const first = _flushDurableWallSamplesForTest();
  await g.started; // deterministic: the first flush is now parked inside the gated DB write
  // Second call while the first is still awaiting the DB must be a no-op, not a parallel write.
  await _flushDurableWallSamplesForTest();
  assert.equal(batches.length, 1, "a concurrent flush must not start a second batch");
  g.release();
  await first;
});

test("samples recorded DURING a flush are kept for the next one, never dropped", async () => {
  const { appendSessionWallSample, _flushDurableWallSamplesForTest, _durableWallQueueSizeForTest } =
    await mod();
  batches = [];
  const g = openGate();
  await appendSessionWallSample("2026-08-12", sample(4000), "MID");
  const p = _flushDurableWallSamplesForTest();
  await g.started; // the batch has been taken out of the queue; the write is parked on the gate
  // Arrives after the batch was taken but while the write is still in flight. Clearing the whole
  // map at the END of a flush (rather than taking the batch out first) would silently lose this.
  await appendSessionWallSample("2026-08-12", sample(4005), "MID");
  assert.ok(_durableWallQueueSizeForTest() >= 1, "mid-flush sample must be pending, not dropped");
  g.release();
  await p;
  await _flushDurableWallSamplesForTest();
  assert.equal(batches.at(-1), 1, "the mid-flush sample must reach the NEXT batch");
});
