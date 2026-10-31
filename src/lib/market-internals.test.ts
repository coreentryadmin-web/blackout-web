import { test } from "node:test";
import assert from "node:assert/strict";
import { estimateTrinFromBreadth, type BreadthSample } from "@/lib/market-internals";

/**
 * TRIN polarity is FIXED across this codebase and documented in multiple places
 * (features/largo/answer/signal-rows.ts: "TRIN below 1.0 means volume is concentrated
 * in advancing issues" i.e. BULLISH; features/spx/lib/spx-signals.ts: trin < 0.85 scores
 * +6 bullish, trin > 1.15 scores -6 bearish). So a breadth-derived TRIN *proxy* must
 * preserve that same direction: strongly-advancing breadth -> LOW trin, strongly-declining
 * breadth -> HIGH trin. estimateTrinFromBreadth's own zero-decliners/zero-advancers edge
 * cases already encode this (0.65 for all-advancing, 1.45 for all-declining) — the general
 * ratio branch must agree with those anchors, not contradict them.
 */

// Advancers get a POSITIVE change_pct (above FLAT_THRESHOLD), decliners a NEGATIVE one
// (below -FLAT_THRESHOLD) — matching countAdvDec's own classification in market-internals.ts.
function samples(advCount: number, decCount: number): BreadthSample[] {
  return [
    ...Array.from({ length: advCount }, () => ({ change_pct: 1.0 })),
    ...Array.from({ length: decCount }, () => ({ change_pct: -1.0 })),
  ];
}

test("estimateTrinFromBreadth: strongly advancing breadth reads BULLISH (low trin), not bearish", () => {
  // 9 strongly-advancing sectors vs 1 strongly-declining sector — overwhelmingly bullish breadth,
  // just one step away from the all-advancing (dec===0) edge case that correctly returns 0.65.
  const trin = estimateTrinFromBreadth(samples(9, 1));
  assert.ok(trin != null, "expected a numeric trin reading");
  // Bullish breadth must read BELOW 1 (same side as the 0.65 all-advancing anchor), never at
  // the bearish ceiling.
  assert.ok(trin! < 1, `expected bullish breadth (9 adv / 1 dec) to read trin < 1, got ${trin}`);
});

test("estimateTrinFromBreadth: strongly declining breadth reads BEARISH (high trin), not bullish", () => {
  // Mirror case: 9 strongly-declining sectors vs 1 strongly-advancing sector.
  const trin = estimateTrinFromBreadth(samples(1, 9));
  assert.ok(trin != null, "expected a numeric trin reading");
  assert.ok(trin! > 1, `expected bearish breadth (1 adv / 9 dec) to read trin > 1, got ${trin}`);
});

test("estimateTrinFromBreadth: direction is monotonic with the all-advancing/all-declining anchors", () => {
  const allAdvancing = estimateTrinFromBreadth(samples(5, 0));
  const mostlyAdvancing = estimateTrinFromBreadth(samples(9, 1));
  const mostlyDeclining = estimateTrinFromBreadth(samples(1, 9));
  const allDeclining = estimateTrinFromBreadth(samples(0, 5));

  assert.ok(allAdvancing! < mostlyDeclining!, "all-advancing must read more bullish than mostly-declining");
  assert.ok(mostlyAdvancing! < allDeclining!, "mostly-advancing must read more bullish than all-declining");
  assert.ok(mostlyAdvancing! < mostlyDeclining!, "mostly-advancing must read more bullish than mostly-declining");
});
