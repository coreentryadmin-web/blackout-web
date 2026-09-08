import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spotAgreementTol, spotsAgree, flipsAgree } from "./cross-tool-tolerance.mjs";

test("spotAgreementTol: 1% of SPX spot with 1pt floor", () => {
  assert.equal(spotAgreementTol(7500), 75);
  assert.equal(spotAgreementTol(50), 1);
});

test("spotsAgree: sub-1% RTH parallel-fetch jitter passes", () => {
  assert.equal(spotsAgree(7530.24, 7526.46, 7528), true);
  assert.equal(spotsAgree(7529.19, 7530.26, 7530), true);
});

test("flipsAgree: matrix vs positioning flip within 1% band", () => {
  assert.equal(flipsAgree(7485.29, 7479.44, 7528), true);
  assert.equal(flipsAgree(7485.29, 7400, 7528), false);
});

test("spx-dashboard cross-tool re-fetches heatmap alongside positioning", () => {
  const src = readFileSync(join(process.cwd(), "scripts/spx-dashboard-e2e-audit.mjs"), "utf8");
  const fn = src.slice(src.indexOf("async function crossToolIntegration"));
  assert.match(fn, /gex-heatmap\?ticker=SPX/, "cross-tool must fetch fresh SPX matrix");
  assert.match(fn, /gex-positioning\?ticker=SPX/, "cross-tool must fetch positioning");
});
