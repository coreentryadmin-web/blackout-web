import { test, mock } from "node:test";
import assert from "node:assert/strict";

mock.module("server-only", { namedExports: {} });

const BASE_ROW = {
  ticker: "SPY",
  spot: 500,
  gammaFlip: 501,
  flipReason: null,
  topCallWall: 505,
  topPutWall: 495,
  topCallPct: 0.4,
  topPutPct: 0.3,
};

// Regression for the 2026-09-09 audit finding: Largo's Vector screener/comparison payload
// (`compactVectorScreenerRow`, extracted from an inline closure so this is directly unit-testable)
// hand-picked a fixed field list off `VectorUniverseRow` that never included `flip_reason`, so a
// null gamma_flip reached Largo with no explanation even after the universe row itself started
// carrying it (see vector-universe.test.ts) — the exact absence-without-explanation gap
// `docs/audit/LARGO-PRODUCT-CONTRACT.md` calls out.
test("compactVectorScreenerRow: forwards flip_reason when gamma_flip is null", async () => {
  const { compactVectorScreenerRow } = await import("./vector-analytics");
  const out = compactVectorScreenerRow({
    ...BASE_ROW,
    gammaFlip: null,
    flipReason: "net_short_everywhere",
  });
  assert.equal(out.gamma_flip, null);
  assert.equal(out.flip_reason, "net_short_everywhere");
});

test("compactVectorScreenerRow: omits flip_reason when gamma_flip resolved (nothing to explain)", async () => {
  const { compactVectorScreenerRow } = await import("./vector-analytics");
  const out = compactVectorScreenerRow({
    ...BASE_ROW,
    gammaFlip: 501,
    // A resolved flip should never carry a stale/irrelevant reason even if one is present upstream.
    flipReason: "net_short_everywhere",
  });
  assert.equal(out.gamma_flip, 501);
  assert.equal(out.flip_reason, undefined, "flip_reason must be omitted, not fabricated, once a real flip exists");
});
