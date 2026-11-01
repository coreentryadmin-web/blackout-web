import { before, mock, test } from "node:test";
import assert from "node:assert/strict";

/**
 * REGRESSION (round 305 audit): the active (non-universe, viewer-driven) lane in
 * `recordActiveNonUniverseWallSamples` never passed a `cursor` to `selectTickersToRecord`, unlike
 * its sibling universe-lane sweep a few lines above it in the same file (which threads
 * `sharedSweepCursor` through on every call specifically to avoid this). `selectTickersToRecord`
 * itself documents that omitting `cursor` is "the old index-0 behaviour... for a one-shot caller
 * [that] has no next tick to be fair across" — but this lane IS a repeating caller, ticking every
 * 15s from the leader forever.
 *
 * `getActiveVectorTickers()` returns viewer-subscribed tickers in stable Map-insertion order, so
 * whenever MORE off-universe tickers are being actively viewed than the lane's own cap
 * (`vectorActiveBeadRecordConcurrency()`, 8 by default), the lane's ceiling binds and — with no
 * cursor to rotate the scan — the SAME first ~8 tickers win every single tick, forever, while
 * every ticker past that point gets ZERO samples for the whole session. This is byte-for-byte the
 * "roster 122 / limit 64 -> the tail recorded 0 samples" defect `vector-bead-schedule-core.ts`'s
 * own "ROSTER FAIRNESS" tests already prove for the general scheduler — just reintroduced here via
 * a second concrete caller that forgot to wire the cursor through.
 */

mock.module("server-only", { namedExports: {} });

let activeTickers: string[] = [];
mock.module("./vector-stream-hub", {
  namedExports: {
    getActiveVectorTickers: () => activeTickers,
  },
});

mock.module("./vector-dynamic-universe", {
  namedExports: {
    // No ticker is in the shared universe for this test — every subscribed ticker is "active
    // non-universe" so the whole roster goes through the lane under test.
    listSharedUniverseTickers: async () => [] as string[],
  },
});

const recordedTickers: string[] = [];
mock.module("./vector-universe", {
  namedExports: {
    recordVectorUniverseWallSample: async (ticker: string) => {
      recordedTickers.push(ticker);
      return true;
    },
  },
});

let recordActiveNonUniverseWallSamples: typeof import("./vector-bead-recorder-core").recordActiveNonUniverseWallSamples;
let _resetVectorBeadRecorderStateForTest: typeof import("./vector-bead-recorder-core")._resetVectorBeadRecorderStateForTest;

before(async () => {
  const mod = await import("./vector-bead-recorder-core");
  recordActiveNonUniverseWallSamples = mod.recordActiveNonUniverseWallSamples;
  _resetVectorBeadRecorderStateForTest = mod._resetVectorBeadRecorderStateForTest;
});

test("THE DEFECT (RED without the fix): more active tickers than the lane cap starves the tail forever", async () => {
  _resetVectorBeadRecorderStateForTest();
  recordedTickers.length = 0;
  // 20 subscribed off-universe tickers, well above the lane's default cap of 8.
  activeTickers = Array.from({ length: 20 }, (_, i) => `T${String(i).padStart(2, "0")}`);

  // Run many ticks — in-flight settles between calls (no overlapping records held open here),
  // so each tick's own ceiling (8) is the only thing deciding who gets served.
  for (let tick = 0; tick < 10; tick++) {
    await recordActiveNonUniverseWallSamples({ sessionYmd: "2026-11-01" });
  }

  const everServed = new Set(recordedTickers);
  // Every one of the 20 subscribed tickers must eventually be served across 10 ticks — a ceiling
  // of 8/tick needs only 3 ticks (ceil(20/8)) to cover the whole roster once rotation works.
  assert.equal(
    everServed.size,
    activeTickers.length,
    `only ${everServed.size}/${activeTickers.length} distinct tickers were ever recorded across 10 ticks — ` +
      `the tail is starved exactly like the pre-#2320 universe-lane defect`
  );
  // The tail (indices 8..19) must have recorded at least once — this is the half that silently
  // got zero samples forever before the cursor fix.
  const tail = activeTickers.slice(8);
  for (const t of tail) {
    assert.ok(everServed.has(t), `tail ticker ${t} never recorded a single sample across 10 ticks`);
  }
});

test("rotation reaches full coverage within ceil(roster / laneCap) ticks, same bound the universe lane guarantees", async () => {
  _resetVectorBeadRecorderStateForTest();
  recordedTickers.length = 0;
  activeTickers = Array.from({ length: 17 }, (_, i) => `A${String(i).padStart(2, "0")}`);

  const laneCap = 8; // vectorActiveBeadRecordConcurrency() default
  const bound = Math.ceil(activeTickers.length / laneCap);
  for (let tick = 0; tick < bound; tick++) {
    await recordActiveNonUniverseWallSamples({ sessionYmd: "2026-11-01" });
  }

  const everServed = new Set(recordedTickers);
  assert.equal(
    everServed.size,
    activeTickers.length,
    `only ${everServed.size}/${activeTickers.length} tickers served in ${bound} ticks — rotation is not reaching the front`
  );
});
