import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Standing defect class: endpoints serving unrounded floats to members. /spx/pulse was the last
// SPX desk loader route without roundFloats while desk/bootstrap/pin/flow/merged all round.
const src = readFileSync("src/app/api/market/spx/pulse/route.ts", "utf8");
const sibling = readFileSync("src/app/api/market/spx/pin/route.ts", "utf8");

test("/spx/pulse rounds floats at the data layer, like its siblings", () => {
  assert.match(sibling, /roundFloats\(/, "precondition: the sibling route rounds");
  assert.match(src, /roundFloats\(pulse\)/);
});

test("/spx/pulse stays uncached — it is a live lane", () => {
  assert.match(src, /NO_STORE_HEADERS/);
  assert.match(src, /dynamic = "force-dynamic"/);
});
