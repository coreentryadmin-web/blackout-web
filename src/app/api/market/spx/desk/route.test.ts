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
    /if \(instant && instant\.price > 0 && instant\.source !== "none"\)/,
    "must not return peek cache when price is zero (bootstrap shell) or source is \"none\""
  );
  assert.doesNotMatch(
    src,
    /if \(instant\) \{\s*\n\s*return NextResponse\.json/,
    "bare `if (instant)` would serve price:0 shells"
  );
});

/**
 * Regression: deskShellFromPulse() merges a real nonzero price/availability from the pulse
 * lane into the emptyDeskPayload() degraded shell while leaving `source: "none"` untouched
 * (mergePulseIntoDesk() never reassigns `source`). A `price > 0` check alone is therefore not
 * proof of a real desk build — the route must also require `source !== "none"`, matching the
 * precedent at spx-play-engine.ts (`desk.price > 0 && desk.source !== "none"`).
 */
test("spx/desk route: peek fast-path also requires source !== \"none\" (degraded pulse shell guard)", () => {
  const src = readFileSync(join(process.cwd(), "src/app/api/market/spx/desk/route.ts"), "utf8");
  assert.match(
    src,
    /instant\.source !== "none"/,
    "must reject a degraded pulse-only shell (source: \"none\") even when its merged price is nonzero"
  );
});
