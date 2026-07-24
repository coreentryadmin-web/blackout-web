import { before, test, mock } from "node:test";
import assert from "node:assert/strict";

// Data-honesty regression: when the shared GEX cache is cold (getGexPositioning → null)
// AND the direct Polygon bundle returns zero rows, fetchPositioningSummary used to return
// buildSummary([], 0, null, "polygon") → net_gex:0 / negative_gamma:false / source:"polygon".
// That made "no positioning data" indistinguishable from a genuine flat, positive-gamma book
// sourced from Polygon. A null is honest; a fabricated zero is a lie. The empty branch now
// returns null. (Separate mock module from positioning.test.ts because that suite globally
// mocks getGexPositioning to a non-null fixture — the empty path needs it null.)

mock.module("server-only", { namedExports: {} });

// Cold shared cache.
mock.module("../../../lib/providers/gex-positioning", {
  namedExports: {
    getGexPositioning: async () => null,
  },
});

// Polygon IS configured, but the direct bundle comes back with zero rows.
mock.module("../../../lib/providers/config", {
  namedExports: {
    polygonConfigured: () => true,
  },
});

mock.module("../../../lib/providers/polygon-options-gex", {
  namedExports: {
    fetchPolygonPositioningBundle: async () => ({ rows: [], spot: 0, maxPain: null }),
  },
});

let fetchPositioningSummary: typeof import("./positioning").fetchPositioningSummary;

before(async () => {
  ({ fetchPositioningSummary } = await import("./positioning"));
});

test("fetchPositioningSummary returns null (not a fabricated flat book) when cache is cold and the bundle is empty", async () => {
  const summary = await fetchPositioningSummary("ZZZZ");
  assert.equal(summary, null);
});
