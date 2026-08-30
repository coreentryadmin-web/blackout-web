import assert from "node:assert/strict";
import { test } from "node:test";
import type { SpxConfluence } from "@/features/spx/lib/spx-signals";
import type { SpxDeskPayload } from "@/features/spx/lib/spx-desk";
import type { PlayTechnicals } from "@/features/spx/lib/spx-play-technicals";
import { evaluatePlayConfirmations } from "@/features/spx/lib/spx-play-confirmations";

function baseDesk(overrides: Partial<SpxDeskPayload> = {}): SpxDeskPayload {
  return {
    available: true,
    market_open: true,
    price: 5600,
    vwap: null,
    above_vwap: false,
    levels: [],
    gex_walls: [],
    gamma_regime: "stabilization",
    above_gamma_flip: true,
    dark_pool: null,
    tide_bias: null,
    tick: null,
    news_headlines: [],
    vix: 18,
    flow_0dte_net: null,
    spx_flows: [],
    ...overrides,
  } as unknown as SpxDeskPayload;
}

function baseConfluence(overrides: Partial<SpxConfluence> = {}): SpxConfluence {
  return {
    score: 60,
    grade: "A",
    bias: "bullish",
    direction: "long",
    confidence: 0.8,
    weighted_conflicts: 0,
    factors: [],
    levels: { stop: 5585, target: 5630 },
    ...overrides,
  } as unknown as SpxConfluence;
}

function baseTechnicals(overrides: Partial<PlayTechnicals> = {}): PlayTechnicals {
  return {
    available: true,
    price: 5600,
    m1_bars: 60,
    m3_close: 5600,
    m5_close: 5600,
    m5_ema20: 5595,
    m5_rsi: 55,
    m5_rsi_warning: null,
    m5_trend: "up",
    m3_above_vwap: null,
    breakout: {
      pdh_break: false,
      pdl_break: false,
      hod_break: false,
      lod_break: false,
      vwap_reclaim: false,
      vwap_lost: false,
    },
    mtf: {
      m3_confirms_long: true,
      m3_confirms_short: false,
      m5_confirms_long: true,
      m5_confirms_short: false,
    },
    ...overrides,
  } as unknown as PlayTechnicals;
}

function dealerGexCheck(result: ReturnType<typeof evaluatePlayConfirmations>) {
  const check = result.checks.find((c) => c.label === "Dealer GEX");
  assert.ok(check, "Dealer GEX check must be present");
  return check!;
}

test("Dealer GEX (long): a support wall FAR ABOVE price must not satisfy the long confirmation", () => {
  // price=5600. A wall tagged "support" at 6200 (600 pts ABOVE price) is stale/irrelevant —
  // by construction (spx-desk-merge.ts / gamma-desk.ts: kind = strike > spot ? "resistance" : "support")
  // a wall only starts as "support" when strike <= the spot it was classified against, but that
  // classification snapshot goes stale as price moves — the confirmation check itself must
  // re-bound it, exactly as the short branch already does (`strike <= price + 12`).
  const desk = baseDesk({
    price: 5600,
    gex_walls: [{ strike: 6200, net_gex: 1, kind: "support", distance_pts: 600 } as never],
  });
  const result = evaluatePlayConfirmations(desk, baseConfluence({ direction: "long" }), baseTechnicals());
  const gex = dealerGexCheck(result);
  assert.equal(gex.passed, false, "a support wall 600pts above price is not a valid long GEX confirmation");
});

test("Dealer GEX (long): a support wall within range below price DOES satisfy the confirmation", () => {
  const desk = baseDesk({
    price: 5600,
    gex_walls: [{ strike: 5595, net_gex: 1, kind: "support", distance_pts: -5 } as never],
  });
  const result = evaluatePlayConfirmations(desk, baseConfluence({ direction: "long" }), baseTechnicals());
  const gex = dealerGexCheck(result);
  assert.equal(gex.passed, true);
});

test("Dealer GEX (short): a resistance wall far below price does not satisfy the short confirmation (existing bound, unchanged)", () => {
  const desk = baseDesk({
    price: 5600,
    above_gamma_flip: false,
    gex_walls: [{ strike: 5000, net_gex: -1, kind: "resistance", distance_pts: -600 } as never],
  });
  const result = evaluatePlayConfirmations(
    desk,
    baseConfluence({ direction: "short", bias: "bearish" }),
    baseTechnicals()
  );
  const gex = dealerGexCheck(result);
  assert.equal(gex.passed, false);
});
