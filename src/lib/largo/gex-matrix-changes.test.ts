import test, { mock } from "node:test";
import assert from "node:assert/strict";

// gex-matrix-changes.ts pulls in a real `import "server-only"`, which throws under plain Node
// outside a Next.js server bundle — same stub every sibling test in this repo uses.
mock.module("server-only", { namedExports: {} });

// Specifiers below are RELATIVE, mirroring gex-matrix-changes.ts's own directory
// (src/lib/largo/) — tsx's alias rewrite only applies to statically-parsed top-level
// `import ... from` statements in the PRODUCTION file, not to mock.module()'s specifier string
// here (same convention every sibling largo test in this repo already follows).

let currentHeatmap: unknown = null;
let previousSnapshot: unknown = null;

mock.module("../providers/polygon-options-gex", {
  namedExports: {
    fetchGexHeatmap: async () => currentHeatmap,
  },
});

mock.module("../shared-cache", {
  namedExports: {
    sharedCacheGet: async () => previousSnapshot,
  },
});

const mod = () => import("./gex-matrix-changes");

/**
 * BUG FIX (round 435): `rowSum`'s array-cell-format branch used to index `cells` with the
 * CALLER's loop index — derived from iterating `current.strikes` — regardless of which
 * matrix (`previous.gex` or `current.gex`) it was reading. That is only correct when
 * `previous.strikes[i] === current.strikes[i]` for every `i`. `polygon-options-gex.ts` builds
 * the strikes axis as a band AROUND SPOT, so the window can shift by one strike between two
 * warm cron ticks (one strike rolls off the low end, a new one appears at the high end) while
 * the strike COUNT stays the same — exactly the shape this test reproduces.
 *
 * `src/lib/gex-matrix-delta.ts`'s `getGexRow` had and fixed this identical bug (PR #7095,
 * "array-cell-format branch matched strikes by index, not value"); this Largo sibling
 * duplicated the same row-sum logic independently and never got the fix.
 */
test("gexMatrixChangesForLargo (array cell format): a strike window shift must not misattribute an unchanged strike as a GEX move", async () => {
  // Window shifted by one strike between ticks: 490 rolled off, 500 is newly in view.
  // 495's own GEX did NOT change (2000 -> 2000) — only the WINDOW shifted.
  previousSnapshot = {
    underlying: "SPY",
    spot: 500,
    strikes: [490, 495],
    expiries: ["2026-09-05"],
    gex: [[1000], [2000]], // row 0 = strike 490, row 1 = strike 495
    asof: "2026-09-03T15:00:00.000Z",
  };
  currentHeatmap = {
    underlying: "SPY",
    spot: 501,
    strikes: [495, 500],
    expiries: ["2026-09-05"],
    gex: { cells: [[2000], [3000]] }, // row 0 = strike 495 (unchanged), row 1 = strike 500 (new)
    asof: "2026-09-03T15:05:00.000Z",
  };

  const { gexMatrixChangesForLargo } = await mod();
  const result = await gexMatrixChangesForLargo("SPY");

  assert.equal(result.available, true);
  const s495 = result.updated_strikes.find((s) => s.strike === 495);
  assert.equal(
    s495,
    undefined,
    "strike 495's own GEX did not change across the shift — it must not be reported as updated"
  );

  const s500 = result.updated_strikes.find((s) => s.strike === 500);
  assert.ok(s500, "the newly-in-view strike 500 must be reported");
  assert.equal(s500!.gex_change, 3000, "500 had no prior row (0), so the full new sum is the change");
  assert.equal(s500!.direction, "flipped");
});

test("gexMatrixChangesForLargo (record cell format, unaffected): an unchanged strike across a shifted window is still correctly ignored", async () => {
  previousSnapshot = {
    underlying: "SPY",
    spot: 500,
    strikes: [490, 495],
    expiries: ["2026-09-05"],
    gex: { "490": { "2026-09-05": 1000 }, "495": { "2026-09-05": 2000 } },
    asof: "2026-09-03T15:00:00.000Z",
  };
  currentHeatmap = {
    underlying: "SPY",
    spot: 501,
    strikes: [495, 500],
    expiries: ["2026-09-05"],
    gex: { cells: { "495": { "2026-09-05": 2000 }, "500": { "2026-09-05": 3000 } } },
    asof: "2026-09-03T15:05:00.000Z",
  };

  const { gexMatrixChangesForLargo } = await mod();
  const result = await gexMatrixChangesForLargo("SPY");
  const s495 = result.updated_strikes.find((s) => s.strike === 495);
  assert.equal(s495, undefined, "record-format branch already matched by key — stays correct");
});
