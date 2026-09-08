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

test("buildSpxDeskPulse: cold replica off-hours falls back to priorDayForPulseLane pdc", () => {
  const src = readFileSync(join(process.cwd(), "src/features/spx/lib/spx-desk.ts"), "utf8");
  assert.match(
    src,
    /if \(!rthOpen && !premarketPlan\) \{[\s\S]*priorDayForPulseLane\(\)[\s\S]*prior\.pdc/,
    "closed-market branch must anchor to prior session close when lastPulse is empty"
  );
});

test("buildSpxDeskPulse: cold replica awaits the real prior-day fetch when priorDayForPulseLane is still empty", () => {
  // priorDayForPulseLane() is "never block cold" — on a true cold cache it fires
  // fetchPriorDayCached() in the background and returns pdc:null immediately, so the FIRST
  // off-hours request after a rollout must not stop at that null; it needs to await the real
  // fetch (fetchPriorDayCached is idempotent — returns the fresh cache if another caller already
  // populated it) before falling through to the empty/closedPulse shell.
  const src = readFileSync(join(process.cwd(), "src/features/spx/lib/spx-desk.ts"), "utf8");
  assert.match(
    src,
    /if \(!rthOpen && !premarketPlan\) \{[\s\S]*let prior = await priorDayForPulseLane\(\);\s*\n\s*if \(!\(prior\.pdc != null && prior\.pdc > 0\)\) \{\s*\n\s*prior = await fetchPriorDayCached\(\)\.catch\(\(\) => prior\);/,
    "closed-market branch must await fetchPriorDayCached() when the fire-and-forget priorDayForPulseLane() is still empty"
  );
});

test("buildSpxDeskPulseMinimal: price chain includes prior.pdc", () => {
  const src = readFileSync(join(process.cwd(), "src/features/spx/lib/spx-desk.ts"), "utf8");
  const minimalIdx = src.indexOf("export async function buildSpxDeskPulseMinimal");
  const priceLine = src.slice(minimalIdx).match(
    /const price = spxSnap\?\.price \?\? lastPulseForSignals\?\.price \?\? prior\.pdc \?\? 0;/
  );
  assert.ok(priceLine, "minimal pulse must fall back to prior.pdc on cold cache");
});
