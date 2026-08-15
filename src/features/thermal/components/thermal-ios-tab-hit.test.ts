import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

test("Thermal ticker row does not steal taps from iOS Matrix tabs", () => {
  const heatmap = readFileSync(join(root, "src/features/thermal/components/GexHeatmap.tsx"), "utf8");
  assert.match(heatmap, /flex max-w-full items-center gap-2 overflow-hidden pointer-events-none/);
  assert.match(heatmap, /thermal-desk-ticker-trigger pointer-events-auto/);

  const css = readFileSync(join(root, "src/app/ios-native-pages.css"), "utf8");
  assert.match(css, /gex-heatmap-control-row \[role="tablist"\][\s\S]*z-index: 2/);
});
