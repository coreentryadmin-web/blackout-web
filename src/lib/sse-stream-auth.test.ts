import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("zerodte marks SSE revalidates tier on each tick", () => {
  const src = readFileSync("src/app/api/market/zerodte/marks/stream/route.ts", "utf8");
  assert.match(src, /revalidateSseStreamAccess\(/, "marks stream must re-check entitlement during SSE ticks");
});

test("vector SSE revalidates tier on each tick", () => {
  const src = readFileSync("src/app/api/market/vector/stream/route.ts", "utf8");
  assert.match(src, /revalidateSseStreamAccess\(/, "vector stream must re-check entitlement during SSE ticks");
});
