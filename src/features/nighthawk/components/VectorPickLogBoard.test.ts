import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("VectorPickLogBoard: scrollport must not flex-shrink closure rows (nh-v2 desktop lock)", () => {
  const src = readFileSync(new URL("./VectorPickLogBoard.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(
    src,
    /nh-deck-rows flex min-h-0 flex-1 flex-col/,
    "flex-col on nh-deck-rows collapses Panel rows to ~26px under 100svh shell"
  );
  assert.match(src, /vector-closure-row shrink-0/, "closure panels opt out of flex shrink");
  assert.match(src, /formatPremiumPct/, "premium % must render prominently");
  assert.match(src, /filterVectorClosureRows/, "board must support filter controls");
});
