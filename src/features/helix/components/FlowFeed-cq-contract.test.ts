import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("Helix FlowFeed defaults directionFilter to all — neutral prints not hidden (CQ-027)", () => {
  const src = readFileSync("src/features/helix/components/FlowFeed.tsx", "utf8");
  assert.match(
    src,
    /directionFilter[\s\S]{0,80}useState<HelixDirectionFilter>\("all"\)/,
    "default tape view must not pre-filter bullish/bearish only"
  );
});
