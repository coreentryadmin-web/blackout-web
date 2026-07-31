import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

test("FlowFeed iOS segment must not hide parent helix-desk-terminal-grid", () => {
  const src = readFileSync(join(process.cwd(), "src/features/helix/components/FlowFeed.tsx"), "utf8");
  assert.doesNotMatch(
    src,
    /"helix-desk-terminal-grid"[\s\S]{0,220}ios-native-panel-hidden/
  );
  assert.match(src, /helix-ios-tape-col[\s\S]*iosView !== "tape" && "ios-native-panel-hidden"/);
  assert.match(src, /useState<"tape" \| "analytics">\("tape"\)/);
  assert.doesNotMatch(
    src,
    /helix-native-toolbar[\s\S]{0,120}ios-native-panel-hidden/
  );
});

test("ios-native-nav panel enter keeps opacity at 1 (WKWebView safe)", () => {
  const css = readFileSync(join(process.cwd(), "src/app/ios-native-nav.css"), "utf8");
  assert.match(css, /ios-panel-enter[\s\S]*opacity:\s*1/);
});

test("IosNativePageTransition keeps tool routes opaque on enter (no blank WKWebView flash)", () => {
  const src = readFileSync(join(process.cwd(), "src/components/ios/IosNativePageTransition.tsx"), "utf8");
  assert.match(src, /initial=\{\{[\s\S]*opacity:\s*1/);
});
