import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { BieFullState } from "@/lib/bie/full-platform-cache";
import { formatCompactBieFullStateBlock } from "@/lib/bie/platform-read-format";

describe("formatCompactBieFullStateBlock", () => {
  test("includes cross-product sections and respects maxChars", () => {
    const state: BieFullState = {
      asOf: "2026-07-17T14:00:00.000Z",
      platform: {
        spx: { price: 5500, change_pct: 0.42, gamma_flip: 5480, gamma_regime: "positive" },
        flows: { count: 120, total_premium: 45_000_000, top_tickers: [{ ticker: "NVDA" }] },
        nighthawk: { available: true, play_count: 3, recap_headline: "Tech-led" },
      },
      intel: {
        composite_regime: "RANGE_BOUND",
        gex_regime: "positive",
        flow_regime: "bullish",
        critical_anomaly_count: 2,
        anomaly_tickers: ["NVDA", "TSLA"],
      },
      thermalSpx: {
        spot: 5500,
        change_pct: 0.42,
        asof: "2026-07-17T14:00:00.000Z",
        flip: 5480,
        call_wall: 5550,
        put_wall: 5450,
        gex_king_strike: 5500,
        net_gex: 1_200_000,
        net_vex: -500_000,
        net_dex: 100_000,
        net_charm: -50_000,
        gamma_regime_read: "positive gamma",
        vanna_regime_read: "neutral vanna",
      },
      thermalMatrix: {
        spot: 5500,
        strike_count: 40,
        expiry_count: 1,
        gex_flip: 5480,
        vex_flip: 5475,
        dex_zero: 5490,
        charm_zero: 5495,
        net_gex: 1_200_000,
        net_vex: -500_000,
        net_dex: 100_000,
        net_charm: -50_000,
        top_gex_strikes: [{ strike: 5500, gex: 800_000 }],
      },
      vectorSpx: {
        spot: 5500,
        gamma_flip: 5480,
        gamma_regime: "positive",
        call_wall: 5550,
        put_wall: 5450,
        play: { bias: "long", conviction: 72, style: "momentum" },
      },
      zerodte: {
        plays: [{ ticker: "NVDA", status: "OPEN", direction: "long", strike: 130 }],
      },
      hotTickers: [{ ticker: "NVDA", total_premium: 12_000_000 }],
      errors: {},
    };

    const block = formatCompactBieFullStateBlock(state, 5000);
    assert.match(block, /Platform vitals/);
    assert.match(block, /SPX Slayer/);
    assert.match(block, /Thermal SPX/);
    assert.match(block, /Vector SPX/);
    assert.match(block, /0DTE Command/);
    assert.match(block, /NVDA/);

    const tiny = formatCompactBieFullStateBlock(state, 120);
    assert.ok(tiny.length <= 130);
    assert.match(tiny, /truncated/);
  });
});
