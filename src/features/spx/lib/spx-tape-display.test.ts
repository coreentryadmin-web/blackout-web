import assert from "node:assert/strict";
import { test } from "node:test";
import { computeTapeSkew, fmtTapePremium } from "./spx-tape-display";

test("computeTapeSkew: call dominance (aggressor-aware — calls bought, put bought too)", () => {
  // ask_pct carries the real aggressor share (see SpxTapeItem's own doc comment) — both calls are
  // BOUGHT (bullish) and the one put is also BOUGHT (bearish per the four-way table: a bought put
  // is bearish, a SOLD put is bullish), so bull still dominates on the same premiums the old
  // type-only test used.
  const r = computeTapeSkew([
    { kind: "flow", side: "call", premium: 200_000, ask_pct: 90, label: "C 5500", time: "1", detail: "" },
    { kind: "flow", side: "call", premium: 150_000, ask_pct: 85, label: "C 5510", time: "2", detail: "" },
    { kind: "flow", side: "put", premium: 50_000, ask_pct: 90, label: "P 5490", time: "3", detail: "" },
  ]);
  assert.equal(r.skew, "call");
});

// FINDINGS 2026-11-09: computeTapeSkew used to bucket prints by raw option TYPE alone (every call
// counted bullish, every put bearish), the exact rule spx-tape-direction.ts's header documents
// measuring a 16.8% sign-flip rate against the aggressor-aware rule the rest of the desk already
// uses. Reproduces that sign-flip directly: two SOLD calls (ask_pct <= 40) are bearish conviction
// — dealers/traders dumping calls, not buying them — so the real verdict is PUT skew. The old
// naive rule read these as pure "call side" premium and reported "CALL skew" (the bullish green
// badge) on a tape that was actually bearish.
test("computeTapeSkew: SOLD calls read as PUT (bearish) skew, not CALL — the naive-type-only bug", () => {
  const r = computeTapeSkew([
    { kind: "flow", side: "call", premium: 150_000, ask_pct: 20, label: "C 5500", time: "1", detail: "" },
    { kind: "flow", side: "call", premium: 150_000, ask_pct: 15, label: "C 5510", time: "2", detail: "" },
  ]);
  assert.equal(r.bull, 0, "sold calls contribute nothing to the bullish bucket");
  assert.equal(r.bear, 300_000, "sold calls are bearish conviction, not bullish");
  assert.equal(r.skew, "put");
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
