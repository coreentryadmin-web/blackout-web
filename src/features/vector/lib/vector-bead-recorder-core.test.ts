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

test("vectorBeadRecordConcurrency: defaults to 25 and clamps env", () => {
  const prev = process.env.VECTOR_BEAD_RECORD_CONCURRENCY;
  delete process.env.VECTOR_BEAD_RECORD_CONCURRENCY;
  assert.equal(vectorBeadRecordConcurrency(), 25);
  process.env.VECTOR_BEAD_RECORD_CONCURRENCY = "99";
  assert.equal(vectorBeadRecordConcurrency(), 50);
  process.env.VECTOR_BEAD_RECORD_CONCURRENCY = "0";
  assert.equal(vectorBeadRecordConcurrency(), 25);
  if (prev === undefined) delete process.env.VECTOR_BEAD_RECORD_CONCURRENCY;
  else process.env.VECTOR_BEAD_RECORD_CONCURRENCY = prev;
});
