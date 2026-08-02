import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { computeGexProximity, enrichFlowWithGex } from "@/lib/flow-gex-proximity";

// Root cause (2026-08-01 Helix audit): enrichFlowsWithGex used to default maxTickers to 8,
// so any page spanning more than 8 distinct tickers (routine — a 500-row page commonly spans
// 30-80+ names) silently left most rows with no gex_proximity at all. This test pins the fix:
// default maxTickers must cover well beyond 8 unique tickers.
test("enrichFlowsWithGex enriches beyond the old 8-ticker cap by default", async () => {
  // Relative specifier (not the "@/..." alias) — mock.module()'s runtime resolution doesn't
  // consistently apply tsx's alias rewrite across node/tsx versions (confirmed: passed locally,
  // failed in CI with "Cannot find module .../src/lib/@/lib/providers/gex-positioning"). Matches
  // the existing convention elsewhere in the repo (e.g. run-tool.test.ts).
  mock.module("./providers/gex-positioning", {
    namedExports: {
      getGexPositioning: async (ticker: string) => ({
        flip: 100,
        call_wall: 110,
        put_wall: 90,
        // Only fields getGexLevelsForTicker actually reads matter for this test.
      }),
    },
  });
  const { enrichFlowsWithGex } = await import("@/lib/flow-gex-enrichment");

  const TICKER_COUNT = 15; // > the old hardcoded cap of 8
  const flows = Array.from({ length: TICKER_COUNT }, (_, i) => ({
    ticker: `T${i}`,
    strike: 100,
  }));

  const enriched = await enrichFlowsWithGex(flows);
  const withProximity = enriched.filter((f) => f.gex_proximity != null);
  assert.equal(
    withProximity.length,
    TICKER_COUNT,
    "every unique ticker should be enriched, not just the first 8"
  );
});

test("computeGexProximity at gamma flip", () => {
  assert.equal(computeGexProximity(6000, 6000, 6100, 5900), "at_gamma_flip");
});

test("computeGexProximity near call wall", () => {
  assert.equal(computeGexProximity(6030, 5900, 6050, 5900), "near_call_wall");
});

test("enrichFlowWithGex adds proximity field", () => {
  const row = { ticker: "SPX", strike: 6000, premium: 1_000_000 };
  const enriched = enrichFlowWithGex(row, { flip: 6000, call_wall: 6100, put_wall: 5900 });
  assert.equal(enriched.gex_proximity, "at_gamma_flip");
});
