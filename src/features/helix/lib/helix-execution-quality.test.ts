import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  executionQualityBucket,
  executionFillDetail,
  summarizeExecutionQuality,
} from "./helix-execution-quality";

describe("helix-execution-quality", () => {
  test("executionQualityBucket thresholds", () => {
    assert.equal(executionQualityBucket(85), "aggressive");
    assert.equal(executionQualityBucket(60), "aggressive");
    assert.equal(executionQualityBucket(15), "passive");
    assert.equal(executionQualityBucket(40), "passive");
    assert.equal(executionQualityBucket(50), "mid");
    assert.equal(executionQualityBucket(null), "unknown");
  });

  test("summarizeExecutionQuality rolls premium", () => {
    const rows = summarizeExecutionQuality([
      { premium: 1_000_000, ask_pct: 90 },
      { premium: 500_000, ask_pct: 10 },
      { premium: 200_000, ask_pct: 50 },
    ]);
    assert.equal(rows.length, 3);
    const agg = rows.find((r) => r.bucket === "aggressive");
    assert.ok(agg && agg.premium === 1_000_000);
  });

  test("executionFillDetail describes aggressive fill", () => {
    const s = executionFillDetail({ ask_pct: 82, fill_price: 2.45 });
    assert.ok(s?.includes("ask"));
    assert.ok(s?.includes("2.45"));
  });
});
