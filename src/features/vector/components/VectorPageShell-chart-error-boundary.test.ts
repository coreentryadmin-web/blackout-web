import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(process.cwd(), "src/features/vector/components");

// A render-time throw inside VectorChart on the standalone /vector desk (a malformed live
// payload reaching an overlay that assumes a shape) must be caught by a per-pane boundary,
// not the app-level route error boundary — otherwise one bad render takes the whole page
// (toolbar, rails, chrome) down with it instead of just the chart. Compare mode already gets
// this via VectorPaneErrorBoundary around each VectorComparePane; the standalone desk's
// chartBlock previously rendered <VectorChart> completely bare.
test("VectorPageShell: standalone chartBlock wraps VectorChart in VectorPaneErrorBoundary", () => {
  const src = readFileSync(join(root, "VectorPageShell.tsx"), "utf8");

  assert.match(
    src,
    /import \{ VectorPaneErrorBoundary \} from "@\/features\/vector\/components\/VectorPaneErrorBoundary";/,
    "imports the shared per-pane error boundary"
  );

  const chartBlockMatch = src.match(/const chartBlock = \(([\s\S]*?)\n {2}\);/);
  assert.ok(chartBlockMatch, "chartBlock assignment found");
  const chartBlockBody = chartBlockMatch![1];

  assert.match(
    chartBlockBody,
    /<VectorPaneErrorBoundary ticker=\{activeTicker\}>/,
    "chartBlock opens with the boundary, keyed by the active ticker"
  );
  assert.match(
    chartBlockBody,
    /<VectorChart[\s\S]*key=\{activeTicker\}/,
    "VectorChart is still rendered inside the wrapped block"
  );
  assert.match(
    chartBlockBody.trimEnd(),
    /\/>\s*\n\s*<\/VectorPaneErrorBoundary>$/,
    "the boundary closes around VectorChart, after its closing tag"
  );
});
