import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("Largo system prompt requires neutral-edge honesty when signals are flat (CQ-085)", () => {
  const src = readFileSync("src/lib/largo/system-prompt.ts", "utf8");
  assert.match(src, /Neutral \/ empty signals/i);
  assert.match(src, /no clear edge exists/i);
});

test("Largo system prompt documents zerodte vs confluence disagreement (CQ-079)", () => {
  const src = readFileSync("src/lib/largo/system-prompt.ts", "utf8");
  assert.match(src, /get_zerodte_record/);
  assert.match(src, /get_confluence_outcomes/);
});
