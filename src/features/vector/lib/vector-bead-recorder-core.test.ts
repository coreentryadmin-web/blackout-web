import assert from "node:assert/strict";
import test from "node:test";
import { mapInChunks, vectorBeadRecordConcurrency } from "./vector-bead-recorder-logic";

test("mapInChunks: processes all items in order", async () => {
  const seen: number[] = [];
  const results = await mapInChunks([1, 2, 3, 4, 5], 2, async (n) => {
    seen.push(n);
    return n * 2;
  });
  assert.equal(results.length, 5);
  assert.deepEqual(
    results.map((r) => (r.status === "fulfilled" ? r.value : null)),
    [2, 4, 6, 8, 10]
  );
  assert.deepEqual(seen.sort((a, b) => a - b), [1, 2, 3, 4, 5]);
});

// REWRITTEN 2026-08-07. This test previously asserted `defaults to 25 ... clamps to 50`, which was
// the width that CAUSED the live regression: ~122 universe tickers at 25-wide is five sequential
// passes, the sweep overran the leader's 5s tick, and every other tick was dropped so the whole
// universe recorded at 10s. The old numbers were the bug written down as a spec, and they passed
// the entire time members were getting half their beads. Kept as a bounds test, re-pointed at the
// width the deadline actually requires.
test("vectorBeadRecordConcurrency: defaults wide enough for the universe, and clamps env", () => {
  const prev = process.env.VECTOR_BEAD_RECORD_CONCURRENCY;
  delete process.env.VECTOR_BEAD_RECORD_CONCURRENCY;
  assert.equal(vectorBeadRecordConcurrency(), 64);
  process.env.VECTOR_BEAD_RECORD_CONCURRENCY = "999";
  assert.equal(vectorBeadRecordConcurrency(), 128, "ceiling still bounds cold-universe fan-out");
  process.env.VECTOR_BEAD_RECORD_CONCURRENCY = "0";
  assert.equal(vectorBeadRecordConcurrency(), 64);
  if (prev === undefined) delete process.env.VECTOR_BEAD_RECORD_CONCURRENCY;
  else process.env.VECTOR_BEAD_RECORD_CONCURRENCY = prev;
});

// ── ROLLING POOL vs CHUNK BARRIER (2026-08-07) ───────────────────────────────────────────────
// The universe sweep has a HARD 5s deadline: the leader drops any tick landing while a sweep is
// still running, so a sweep that overruns halves the recorded cadence for the WHOLE universe.
// Measured live 09:56 ET: AMD/TSLA/IWM/META/AAPL/QQQ each 190 samples over 1,610s of RTH (~322
// expected at 5s), median gap 10s. These pin the properties that keep the sweep inside its budget.

test("mapInPool: never exceeds the concurrency limit", async () => {
  const { mapInPool } = await import("./vector-bead-recorder-logic");
  let inFlight = 0;
  let peak = 0;
  const items = Array.from({ length: 50 }, (_, i) => i);
  await mapInPool(items, 8, async (i) => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, i % 5));
    inFlight -= 1;
    return i;
  });
  assert.ok(peak <= 8, `peak in-flight ${peak} exceeded the limit of 8`);
  assert.ok(peak > 1, "pool should actually run work concurrently");
});

test("mapInPool: results stay INDEX-ALIGNED despite out-of-order completion", async () => {
  // A pool that returned completion order would mis-attribute a failure to the wrong ticker —
  // the recorder pairs results back to the ticker list to count recorded vs failed.
  const { mapInPool } = await import("./vector-bead-recorder-logic");
  const items = ["a", "b", "c", "d", "e"];
  // Reverse-ordered delays: 'e' finishes first, 'a' last.
  const out = await mapInPool(items, 5, async (t) => {
    await new Promise((r) => setTimeout(r, (items.length - items.indexOf(t)) * 4));
    return t.toUpperCase();
  });
  assert.deepEqual(
    out.map((r) => (r.status === "fulfilled" ? r.value : `ERR`)),
    ["A", "B", "C", "D", "E"]
  );
});

test("mapInPool: one bad ticker never aborts the sweep", async () => {
  // Promise.allSettled semantics. A single failing symbol must not cost the other ~121 their beads.
  const { mapInPool } = await import("./vector-bead-recorder-logic");
  const out = await mapInPool([1, 2, 3, 4], 2, async (n) => {
    if (n === 2) throw new Error("boom");
    return n * 10;
  });
  assert.equal(out.length, 4);
  assert.equal(out[1]!.status, "rejected");
  assert.deepEqual(
    out.filter((r) => r.status === "fulfilled").map((r) => (r as PromiseFulfilledResult<number>).value),
    [10, 30, 40]
  );
});

test("mapInPool beats chunk barriers when one item is slow — the actual regression", async () => {
  // The straggler case, which is what pushed the real sweep past 5s: one slow ticker inside a chunk
  // stalls every item queued behind it. With 12 items at width 4 and item 0 slow, the chunked
  // version pays that stall before ANY of the last 8 start; the pool overlaps it.
  const { mapInPool, mapInChunks } = await import("./vector-bead-recorder-logic");
  const items = Array.from({ length: 12 }, (_, i) => i);
  const work = async (i: number) => {
    await new Promise((r) => setTimeout(r, i === 0 ? 60 : 2));
    return i;
  };
  const t0 = Date.now();
  await mapInChunks(items, 4, work);
  const chunked = Date.now() - t0;
  const t1 = Date.now();
  await mapInPool(items, 4, work);
  const pooled = Date.now() - t1;
  assert.ok(pooled < chunked, `pool ${pooled}ms should beat chunked ${chunked}ms on a straggler`);
});

test("concurrency default clears the universe in ONE pass within the tick budget", async () => {
  // The arithmetic that broke: static allowlist (~22) + DYNAMIC_UNIVERSE_CAP (100) = ~122 tickers.
  // At the old width of 25 that is 5 sequential passes; the sweep must fit inside 5s.
  const { vectorBeadRecordConcurrency, VECTOR_BEAD_RECORD_TICK_MS } = await import(
    "./vector-bead-recorder-logic"
  );
  const width = vectorBeadRecordConcurrency();
  const UNIVERSE = 122;
  assert.ok(width >= 64, `width ${width} — too narrow for a ~${UNIVERSE}-ticker universe`);
  const passes = Math.ceil(UNIVERSE / width);
  assert.ok(passes <= 2, `${passes} sequential passes at width ${width} will overrun the 5s tick`);
  assert.equal(VECTOR_BEAD_RECORD_TICK_MS, 5_000, "the deadline this width is sized against");
});

test("concurrency env override is honoured and bounded", async () => {
  const { vectorBeadRecordConcurrency } = await import("./vector-bead-recorder-logic");
  const prev = process.env.VECTOR_BEAD_RECORD_CONCURRENCY;
  try {
    process.env.VECTOR_BEAD_RECORD_CONCURRENCY = "96";
    assert.equal(vectorBeadRecordConcurrency(), 96);
    // Ceiling is a real bound: cache-first or not, a cold universe at the cap is that many
    // concurrent upstream fetches.
    process.env.VECTOR_BEAD_RECORD_CONCURRENCY = "9999";
    assert.equal(vectorBeadRecordConcurrency(), 128);
    process.env.VECTOR_BEAD_RECORD_CONCURRENCY = "garbage";
    assert.equal(vectorBeadRecordConcurrency(), 64, "unparseable falls back to the default");
  } finally {
    if (prev == null) delete process.env.VECTOR_BEAD_RECORD_CONCURRENCY;
    else process.env.VECTOR_BEAD_RECORD_CONCURRENCY = prev;
  }
});

// ── ACTIVE (VIEWER-DRIVEN, 15s) LANE ─────────────────────────────────────────────────────────
// Everything #2303 fixed on the 5s universe sweep was true of this lane too and was left in place:
// a whole-lane drop guard in the leader, and a bare Promise.allSettled with NO concurrency ceiling
// over a ticker list a member moves simply by opening a chart. These pin the corrected shape.

test("active lane concurrency: small by default, env-overridable, never wider than the global cap", async () => {
  const { vectorActiveBeadRecordConcurrency } = await import("./vector-bead-recorder-logic");
  const prevLane = process.env.VECTOR_BEAD_ACTIVE_RECORD_CONCURRENCY;
  const prevGlobal = process.env.VECTOR_BEAD_RECORD_CONCURRENCY;
  try {
    delete process.env.VECTOR_BEAD_ACTIVE_RECORD_CONCURRENCY;
    delete process.env.VECTOR_BEAD_RECORD_CONCURRENCY;
    assert.equal(vectorActiveBeadRecordConcurrency(), 8);

    process.env.VECTOR_BEAD_ACTIVE_RECORD_CONCURRENCY = "16";
    assert.equal(vectorActiveBeadRecordConcurrency(), 16);

    process.env.VECTOR_BEAD_ACTIVE_RECORD_CONCURRENCY = "9999";
    assert.equal(vectorActiveBeadRecordConcurrency(), 32, "lane has its own hard ceiling");

    // The lane cap is a SUB-budget of the global one, not an escape hatch from it.
    process.env.VECTOR_BEAD_RECORD_CONCURRENCY = "4";
    assert.equal(vectorActiveBeadRecordConcurrency(), 4);

    process.env.VECTOR_BEAD_ACTIVE_RECORD_CONCURRENCY = "garbage";
    delete process.env.VECTOR_BEAD_RECORD_CONCURRENCY;
    assert.equal(vectorActiveBeadRecordConcurrency(), 8, "unparseable falls back to the default");
  } finally {
    if (prevLane == null) delete process.env.VECTOR_BEAD_ACTIVE_RECORD_CONCURRENCY;
    else process.env.VECTOR_BEAD_ACTIVE_RECORD_CONCURRENCY = prevLane;
    if (prevGlobal == null) delete process.env.VECTOR_BEAD_RECORD_CONCURRENCY;
    else process.env.VECTOR_BEAD_RECORD_CONCURRENCY = prevGlobal;
  }
});

test("activeLaneSelectionLimit: the lane gets its own budget, taken out of the global one", async () => {
  const { activeLaneSelectionLimit } = await import("./vector-bead-recorder-logic");
  const { selectTickersToRecord } = await import("./vector-bead-schedule-core");
  const viewers = ["PLTR", "ASTS", "RKLB", "SOFI", "HOOD", "IONQ", "RIVN", "LCID", "PATH", "AI"];

  // Nothing else running: the lane starts exactly its cap and DEFERS the rest — a viewer burst is
  // counted, not silently converted into 10 concurrent upstream reads.
  const idle = selectTickersToRecord({
    tickers: viewers,
    inFlight: new Set(),
    limit: activeLaneSelectionLimit(4, 64, 0),
  });
  assert.equal(idle.start.length, 4);
  assert.equal(idle.deferred.length, 6);

  // A busy universe sweep leaves the lane its full sub-budget — it must not be charged for records
  // it did not start, or a mid-sweep viewer tick would record nobody.
  const busy = selectTickersToRecord({
    tickers: viewers,
    inFlight: new Set(Array.from({ length: 50 }, (_, i) => `U${i}`)),
    limit: activeLaneSelectionLimit(4, 64, 50),
  });
  assert.equal(busy.start.length, 4, "lane keeps its sub-budget under a busy sweep");

  // ...but the GLOBAL ceiling still binds when the sweep has genuinely saturated it.
  const saturated = selectTickersToRecord({
    tickers: viewers,
    inFlight: new Set(Array.from({ length: 64 }, (_, i) => `U${i}`)),
    limit: activeLaneSelectionLimit(4, 64, 64),
  });
  assert.equal(saturated.start.length, 0, "global ceiling is not escapable by the lane cap");
  assert.equal(saturated.deferred.length, viewers.length, "and the skips are counted");
});

test("activeLaneSelectionLimit: nonsense inputs still start at least one ticker", async () => {
  const { activeLaneSelectionLimit } = await import("./vector-bead-recorder-logic");
  for (const args of [[0, 64, 0], [Number.NaN, 64, 0], [-3, 64, 0]] as const) {
    assert.ok(
      activeLaneSelectionLimit(args[0], args[1], args[2]) >= 1,
      `lane must not stall on ${String(args[0])}`
    );
  }
  assert.equal(activeLaneSelectionLimit(8, Number.NaN, 0), 1, "an unusable global cap fails narrow");
});

test("active lane budget is sized against 15s, not the universe lane's 5s", async () => {
  // The lane's whole point is a different cadence; a drop here costs 15s of beads, not 5s, which
  // is why it needed the per-ticker guard at least as much as the universe sweep did.
  const { VECTOR_BEAD_RECORD_ACTIVE_TICK_MS, VECTOR_BEAD_RECORD_TICK_MS } = await import(
    "./vector-bead-recorder-logic"
  );
  assert.equal(VECTOR_BEAD_RECORD_ACTIVE_TICK_MS, 15_000);
  assert.ok(VECTOR_BEAD_RECORD_ACTIVE_TICK_MS > VECTOR_BEAD_RECORD_TICK_MS);
});
