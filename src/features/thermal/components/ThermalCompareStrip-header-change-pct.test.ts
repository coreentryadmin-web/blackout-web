/**
 * Regression: ThermalCompareStrip must rebase change_pct when live push spot
 * diverges from the matrix snapshot — same discipline as ThermalTripleDesk (2026-09-05).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(
  join(process.cwd(), "src/features/thermal/components/ThermalCompareStrip.tsx"),
  "utf8"
);

test("ThermalCompareStrip: imports rebaseChangePct for live push spot rebasing", () => {
  assert.match(src, /import \{ rebaseChangePct \} from "@\/lib\/providers\/change-pct"/);
});

test("ThermalCompareStrip: CompareCard rebases when push spot diverges from matrix", () => {
  assert.match(
    src,
    /rebaseChangePct\(pushSpot, \{ price: matrixSpot, change_pct: matrixChangePct \}\)/
  );
  assert.doesNotMatch(src, /const chg = data\?\.change_pct/);
});
