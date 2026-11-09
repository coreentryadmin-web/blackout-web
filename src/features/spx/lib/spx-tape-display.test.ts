import assert from "node:assert/strict";
import { test } from "node:test";
import { computeTapeSkew, fmtTapePremium } from "./spx-tape-display";

test("computeTapeSkew: call dominance", () => {
  const r = computeTapeSkew([
    { kind: "flow", side: "call", premium: 200_000, label: "C 5500", time: "1", detail: "" },
    { kind: "flow", side: "call", premium: 150_000, label: "C 5510", time: "2", detail: "" },
    { kind: "flow", side: "put", premium: 50_000, label: "P 5490", time: "3", detail: "" },
  ]);
  assert.equal(r.skew, "call");
});

// FINDINGS 2026-11-09: fmtTapePremium rounded the K-branch BEFORE checking the K->M boundary, so
// any value in [999,500, 999,999] rounded to 1000K and printed "$1000K" instead of "$1.0M".
// `flowCallPrem`/`flowPutPrem` (SpxMatrixTapeStrip) are SPX 0DTE call/put flow AGGREGATES (sums
// across prints) that routinely sit in the high hundred-thousands, so this boundary is hit in
// real production data, not a theoretical edge case.
test("fmtTapePremium: promotes K values that round up to 1000K into $M, not $1000K", () => {
  assert.equal(fmtTapePremium(999_500), "$1.0M");
  assert.equal(fmtTapePremium(999_999), "$1.0M");
});

test("fmtTapePremium: ordinary K and M values are unaffected", () => {
  assert.equal(fmtTapePremium(998_000), "$998K");
  assert.equal(fmtTapePremium(950_000), "$950K");
  assert.equal(fmtTapePremium(1_000), "$1K");
  assert.equal(fmtTapePremium(1_000_000), "$1.0M");
  assert.equal(fmtTapePremium(12_340_000), "$12.3M");
  assert.equal(fmtTapePremium(500), "$500");
});
