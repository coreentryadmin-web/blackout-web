import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Regression: off-hours pulse must not clobber lastPulseForSignals with price:0 or serve
 * empty shells when the matrix already has a grounded spot (platform-integrity spx-desk-spot).
 */
test("buildSpxDeskPulse: closed market reuses lastPulseForSignals instead of price:0", () => {
  const src = readFileSync(join(process.cwd(), "src/features/spx/lib/spx-desk.ts"), "utf8");
  assert.match(
    src,
    /if \(!rthOpen && !premarketPlan\) \{[\s\S]*lastPulseForSignals\?\.price[\s\S]*market_label: label/,
    "closed-market branch must return last good pulse when available"
  );
  assert.doesNotMatch(
    src,
    /lastPulseForSignals = closedPulse/,
    "must not overwrite lastPulseForSignals with a zero-price closed shell"
  );
});

test("buildSpxDesk: falls back to lastPulseForSignals when index snap is empty", () => {
  const src = readFileSync(join(process.cwd(), "src/features/spx/lib/spx-desk.ts"), "utf8");
  assert.match(
    src,
    /const price =[\s\S]*spxSnap\?\.price \?\? lastPulseForSignals\?\.price \?\? priorFromBars\.pdc \?\? 0;/,
    "full desk build must reuse last RTH print or prior session close off-hours"
  );
});
