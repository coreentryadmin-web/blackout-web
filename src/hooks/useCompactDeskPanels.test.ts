import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

test("useCompactDeskPanels treats ios-app as compact on first paint (no Clerk wait)", () => {
  const src = readFileSync(join(process.cwd(), "src/hooks/useCompactDeskPanels.ts"), "utf8");
  assert.match(src, /isIosAppShell/);
  assert.match(src, /document\.documentElement\.classList\.contains\("ios-app"\)/);
  assert.match(src, /nativeShell \|\| iosApp \|\| narrow/);
});

test("ios-native-pages hides segment panels for all ios-app shells", () => {
  const css = readFileSync(join(process.cwd(), "src/app/ios-native-pages.css"), "utf8");
  assert.match(css, /html\.ios-app \.ios-native-panel-hidden/);
  assert.match(css, /vector-toolbar/);
  assert.match(css, /vector-chart-canvas/);
});
