/**
 * Regression: ThermalTripleDesk column header must rebase change_pct when live push
 * spot diverges from the matrix snapshot — same class as GexHeatmap-header-change-pct.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(
  join(process.cwd(), "src/features/thermal/components/ThermalTripleDesk.tsx"),
  "utf8",
);

test("ThermalTripleDesk: matrix change_pct uses null when absent, not fabricated zero", () => {
  assert.match(
    src,
    /const matrixChangePct =\s*\n\s*view\?\.change_pct != null && Number\.isFinite\(view\.change_pct\) \? view\.change_pct : null;/,
    "matrix snapshot change must stay null when the payload omits change_pct",
  );
});

test("ThermalTripleDesk: headerChangePct rebases when push spot is live", () => {
  const start = src.indexOf("const headerChangePct");
  assert.ok(start > 0, "headerChangePct block exists");
  const end = src.indexOf("const changeUp", start);
  const block = src.slice(start, end);
  assert.match(block, /rebaseChangePct\(pushSpot/, "live push spot must rebase against matrix anchor");
  assert.doesNotMatch(block, /pushChangePct \?\? matrixChangePct;/, "must not pair live spot with stale matrix pct");
});
