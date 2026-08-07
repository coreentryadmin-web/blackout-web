import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The repo has a standing defect class: endpoints serving unrounded floats to members
// (e.g. 7499.360000000001). /spx/flow was the last SPX route without the guard — measured live
// 2026-08-07 with 14 dirty field paths on every poll while its ten siblings were clean.
const src = readFileSync("src/app/api/market/spx/flow/route.ts", "utf8");
const sibling = readFileSync("src/app/api/market/spx/pin/route.ts", "utf8");

test("/spx/flow rounds floats at the data layer, like its siblings", () => {
  assert.match(sibling, /roundFloats\(/, "precondition: the sibling route rounds");
  assert.match(src, /roundFloats\(flow\)/);
});

test("/spx/flow stays uncached — it is a live lane", () => {
  assert.match(src, /NO_STORE_HEADERS/);
  assert.match(src, /dynamic = "force-dynamic"/);
});
