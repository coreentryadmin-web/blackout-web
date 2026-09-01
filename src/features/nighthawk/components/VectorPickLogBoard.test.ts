import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("VectorPickLogBoard: uses viewport-locked shell with internal table scrollport", () => {
  const src = readFileSync(new URL("./VectorPickLogBoard.tsx", import.meta.url), "utf8");
  assert.match(src, /vector-board-shell/, "board must use dedicated shell for nh-v2 viewport lock");
  assert.match(src, /vector-board-tablewrap/, "table must scroll internally, not the page");
  assert.doesNotMatch(
    src,
    /nh-deck-rows flex min-h-0 flex-1 flex-col/,
    "flex-col on nh-deck-rows collapses Panel rows under 100svh shell"
  );
});

test("VectorPickLogBoard: X Ads underline tabs and detail rail", () => {
  const src = readFileSync(new URL("./VectorPickLogBoard.tsx", import.meta.url), "utf8");
  assert.match(src, /vector-board-tabs/, "tabs must use underline style, not pill buttons");
  assert.match(src, /VectorPlayDetailPanel/, "row click must open right-rail inspector");
  assert.match(src, /vector-board-summary-row/, "summary row must mirror X Ads totals row");
  assert.match(src, /formatPremiumPct/, "premium % must render prominently");
});
