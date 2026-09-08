/**
 * Regression: GexHeatmap header must not fabricate a flat +0.00% when change_pct is absent.
 * ThermalCompareStrip already uses `?? null` and hides the chip; the main matrix header was
 * still coercing unknown change into literal 0 via `?? 0` fallbacks (2026-09-04).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(join(process.cwd(), "src/features/thermal/components/GexHeatmap.tsx"), "utf8");

test("GexHeatmap: matrix change_pct uses null when absent, not fabricated zero", () => {
  assert.match(
    src,
    /const matrixChangePct =\s*\n\s*data\?\.change_pct != null && Number\.isFinite\(data\.change_pct\) \? data\.change_pct : null;/,
    "matrix snapshot change must stay null when the payload omits change_pct"
  );
});

test("GexHeatmap: headerChangePct chain does not coerce missing change to 0", () => {
  const start = src.indexOf("const headerChangePct");
  assert.ok(start > 0, "headerChangePct block exists");
  const end = src.indexOf("// NOTE: the old `headerChangeBull`", start);
  const block = src.slice(start, end);
  assert.doesNotMatch(block, /change_pct \?\? 0/, "header tape must not fabricate flat 0%");
  assert.doesNotMatch(block, /: changePct\)/, "removed dead changePct alias");
});

test("GexHeatmap: pulse SSE overlay does not trust raw transported change_pct", () => {
  assert.match(src, /pulseChangePctFromPriorClose/, "SPX pulse overlay derives from prior close");
  assert.match(src, /restAnchoredIndexChangePct/, "VIX pulse overlay gates on REST anchor");
  assert.doesNotMatch(src, /pushedChangePct/, "must not fall back to raw pulse change_pct");
});

test("TickerSwitcher: sr-only label omits change wording when changePct is null", () => {
  const start = src.indexOf("function TickerSwitcher(");
  assert.ok(start > 0);
  const end = src.indexOf("function fmtAsofSeconds", start);
  const body = src.slice(start, end);
  assert.match(body, /changePct != null/, "visible and screen-reader change share the null guard");
  assert.doesNotMatch(body, /fmtPct\(changePct \?\? 0\)/, "sr-only must not read fabricated zero");
});
