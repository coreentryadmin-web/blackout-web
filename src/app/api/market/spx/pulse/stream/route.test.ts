import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// /spx/pulse/stream is the live SSE lane for the same index/tide numbers as /spx/pulse.
// It must round at the boundary so members never see IEEE float tails on the wire.
const src = readFileSync("src/app/api/market/spx/pulse/stream/route.ts", "utf8");
const sibling = readFileSync("src/app/api/market/spx/pulse/route.ts", "utf8");

test("/spx/pulse/stream rounds floats before JSON.stringify, like /spx/pulse", () => {
  assert.match(sibling, /roundFloats\(pulse\)/, "precondition: REST pulse route rounds");
  assert.match(src, /import \{ roundFloats \} from "@\/lib\/round-floats"/);
  assert.match(src, /JSON\.stringify\(\s*roundFloats\(/);
});

test("spx pulse stream: local index freshness uses isWsUpdatedAtFresh (source scan)", () => {
  assert.match(src, /import \{ isWsUpdatedAtFresh \} from "@\/lib\/ws\/timestamp-freshness"/);
  assert.match(
    src,
    /isWsUpdatedAtFresh\(fresh, 10_000\)/,
    "local indexStore freshness must reject clock-skewed future updatedAt stamps"
  );
  assert.doesNotMatch(
    src,
    /Date\.now\(\)\s*-\s*fresh\s*<\s*10_000/,
    "raw Date.now()-fresh must not gate SPX pulse local freshness"
  );
});

test("/spx/pulse/stream sanitizes index change_pct on REST anchor only", () => {
  assert.match(src, /clusterIndexSpotChangePct/, "SSE wire must gate change_pct like /spx/pulse");
  assert.match(src, /sanitizeIndexWire\(snapshot\["I:SPX"\]\)/);
  assert.match(src, /sanitizeIndexWire\(snapshot\["I:VIX"\]\)/);
});
