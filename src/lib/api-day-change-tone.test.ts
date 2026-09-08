import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dayChangeBorderClass, dayChangeTextClass } from "./api";

test("dayChangeTextClass: null/undefined/NaN are neutral, not bull", () => {
  assert.equal(dayChangeTextClass(null), "text-white");
  assert.equal(dayChangeTextClass(undefined), "text-white");
  assert.equal(dayChangeTextClass(Number.NaN), "text-white");
});

test("dayChangeTextClass: signed finite values pick bull/bear", () => {
  assert.equal(dayChangeTextClass(0.12), "text-bull");
  assert.equal(dayChangeTextClass(-0.05), "text-bear-text");
});

test("dayChangeBorderClass: null is neutral border", () => {
  assert.equal(dayChangeBorderClass(null), "border-white/25");
  assert.equal(dayChangeBorderClass(1.2), "border-emerald-500/40");
  assert.equal(dayChangeBorderClass(-0.1), "border-rose-500/40");
});

test("SPX spot components must not coerce spx_change_pct with ?? 0 for tone", () => {
  const files = [
    "src/features/spx/components/SpxLiveSpotPrice.tsx",
    "src/features/spx/components/SpxSniperHeader.tsx",
    "src/features/spx/components/ios/SpxIosMarketStrip.tsx",
  ];
  for (const file of files) {
    const src = readFileSync(file, "utf8");
    assert.doesNotMatch(src, /spx_change_pct \?\? 0/, `${file} must not default change tone via ?? 0`);
  }
});
