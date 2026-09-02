import assert from "node:assert/strict";
import { test } from "node:test";
import { computeBoardColumnWidths } from "@/features/nighthawk/lib/vector-board-column-layout";

test("computeBoardColumnWidths: vector default columns sum to percentage widths", () => {
  const keys = ["pick", "status", "premium", "entryMark", "peak", "path", "updated"];
  const widths = computeBoardColumnWidths(keys);
  assert.equal(widths.length, keys.length);
  assert.ok(widths.every((w) => w.endsWith("%")));
  const sum = widths.map((w) => parseFloat(w)).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 100) < 0.02, `expected ~100%, got ${sum}`);
});

test("computeBoardColumnWidths: legacy stock column gets its own share", () => {
  const keys = ["pick", "status", "premium", "stock", "entryMark", "peak", "path", "updated"];
  const widths = computeBoardColumnWidths(keys);
  assert.equal(widths.length, 8);
  const sum = widths.map((w) => parseFloat(w)).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 100) < 0.02);
});

test("computeBoardColumnWidths: compare column uses fixed px + calc for rest", () => {
  const keys = ["compare", "pick", "premium", "updated"];
  const widths = computeBoardColumnWidths(keys);
  assert.equal(widths[0], "36px");
  assert.match(widths[1]!, /calc\(\(100% - 36px\)/);
});
