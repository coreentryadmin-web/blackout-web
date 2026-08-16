import { test } from "node:test";
import assert from "node:assert/strict";
import {
  maxPainForExpiryFromHeatmap,
  summarizeHeatmapGammaByExpiry,
} from "./meridian-gex-reads";

test("maxPainForExpiryFromHeatmap prefers scoped expiry over front max_pain", () => {
  const hm = {
    max_pain: 5500,
    max_pain_by_expiry: { "2026-08-15": 5480, "2026-08-22": 5520 },
  };
  assert.equal(maxPainForExpiryFromHeatmap(hm as never, "2026-08-22"), 5520);
  assert.equal(maxPainForExpiryFromHeatmap(hm as never, "2026-09-01"), 5500);
});

test("summarizeHeatmapGammaByExpiry pins dominant expiry from cells", () => {
  const cells = {
    "5500": { "2026-08-15": 100, "2026-08-22": 10 },
    "5510": { "2026-08-15": 50, "2026-08-22": 5 },
    "5520": { "2026-08-22": 200 },
  };
  const summary = summarizeHeatmapGammaByExpiry(cells, "2026-08-15");
  assert.ok(summary);
  assert.equal(summary!.pinned_expiry, "2026-08-22");
  assert.ok(summary!.pinned_pct! > 50);
  assert.match(summary!.headline, /2026-08-22/);
});

test("summarizeHeatmapGammaByExpiry returns null on empty cells", () => {
  assert.equal(summarizeHeatmapGammaByExpiry({}, "2026-08-15"), null);
});
