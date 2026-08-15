import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

test("Thermal ticker spot chip is non-interactive so iOS Matrix tabs stay tappable", () => {
  const heatmap = readFileSync(join(root, "src/features/thermal/components/GexHeatmap.tsx"), "utf8");
  assert.match(heatmap, /pointer-events-none flex items-baseline gap-1\.5 font-mono/);

  const css = readFileSync(join(root, "src/app/ios-native-pages.css"), "utf8");
  assert.match(css, /gex-heatmap-control-row \[role="tablist"\][\s\S]*z-index: 2/);
});
