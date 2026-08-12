import assert from "node:assert/strict";
import test from "node:test";
import { truncateCapturedResultsForPersist } from "./persist-tool-results.ts";

test("truncateCapturedResultsForPersist keeps small payloads intact", () => {
  const rows = [{ a: 1 }, { b: 2 }];
  assert.deepEqual(truncateCapturedResultsForPersist(rows), rows);
});

test("truncateCapturedResultsForPersist truncates oversized arrays", () => {
  const big = Array.from({ length: 200 }, (_, i) => ({ payload: "x".repeat(5000), i }));
  const out = truncateCapturedResultsForPersist(big);
  assert.ok(out.length < big.length);
  assert.ok(out.some((r) => r && typeof r === "object" && "_persist_truncated" in (r as object)));
});
