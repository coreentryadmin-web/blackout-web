import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

test("SPX iOS market strip component exists", () => {
  const src = readFileSync(join(root, "src/features/spx/components/ios/SpxIosMarketStrip.tsx"), "utf8");
  assert.match(src, /spx-ios-market-strip/);
  assert.match(src, /Positive gamma/);
});

test("SPX iOS metric groups — four grouped cards", () => {
  const src = readFileSync(join(root, "src/features/spx/components/ios/SpxIosMetricGroups.tsx"), "utf8");
  assert.match(src, /"market"/);
  assert.match(src, /"technical"/);
  assert.match(src, /"dealer"/);
  assert.match(src, /"volatility"/);
});

test("SpxSniperHeader uses iOS compact layout when nativeShell", () => {
  const src = readFileSync(join(root, "src/features/spx/components/SpxSniperHeader.tsx"), "utf8");
  assert.match(src, /SpxIosMarketStrip/);
  assert.match(src, /SpxIosMetricGroups/);
  assert.doesNotMatch(src, /SpxLiveSpotPrice.*size="hero"/);
});

test("IosNativeSegment supports compact variant", () => {
  const src = readFileSync(join(root, "src/components/ios/IosNativeSegment.tsx"), "utf8");
  assert.match(src, /ios-native-segment-compact/);
});

test("ios-native-spx-desk.css loaded for iOS shell only", () => {
  const loader = readFileSync(join(root, "src/components/ios/IosNativeStylesLoader.tsx"), "utf8");
  const layout = readFileSync(join(root, "src/app/(site)/layout.tsx"), "utf8");
  assert.match(loader, /ios-native-spx-desk\.css/);
  assert.match(layout, /IosNativeStylesLoader/);
  assert.doesNotMatch(layout, /ios-native-spx-desk\.css/);
});
