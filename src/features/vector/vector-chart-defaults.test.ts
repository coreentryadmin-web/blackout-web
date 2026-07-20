import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

test("VectorChart: defaults to 3-minute candles and dealer gamma positioning on", () => {
  const src = readFileSync(
    join(process.cwd(), "src/features/vector/components/VectorChart.tsx"),
    "utf8"
  );
  assert.match(src, /VECTOR_DEFAULT_TIMEFRAME/);
  assert.match(src, /defaultVectorIndicators/);
  assert.match(src, /initialTimeframe = defaultTimeframe \?\? VECTOR_DEFAULT_TIMEFRAME/);
});
