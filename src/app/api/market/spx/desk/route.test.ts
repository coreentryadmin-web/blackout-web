import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Regression: peekSpxDesk can return a bootstrap shell with price:0 before buildSpxDesk
 * finishes. The route must not short-circuit on that — members would see SPX 0 while
 * sibling surfaces (gex-heatmap) already serve a grounded spot.
 */
test("spx/desk route: peek fast-path requires price > 0", () => {
  const src = readFileSync(join(process.cwd(), "src/app/api/market/spx/desk/route.ts"), "utf8");
  assert.match(
    src,
    /if \(instant && instant\.price > 0\)/,
    "must not return peek cache when price is zero (bootstrap shell)"
  );
  assert.doesNotMatch(
    src,
    /if \(instant\) \{\s*\n\s*return NextResponse\.json/,
    "bare `if (instant)` would serve price:0 shells"
  );
});
