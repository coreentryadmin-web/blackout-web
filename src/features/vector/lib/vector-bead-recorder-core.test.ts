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
