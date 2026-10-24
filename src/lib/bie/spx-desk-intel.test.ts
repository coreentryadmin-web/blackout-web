import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { SpxConfluence } from "@/features/spx/lib/spx-signals";
import type { GexPositioning } from "@/lib/providers/gex-positioning";
import {
  dealersBriefLine,
  nighthawkBriefLine,
  signalsBriefLine,
  wallsBriefLine,
  knownIntelNumbers,
  type SpxDeskBriefIntel,
} from "@/lib/bie/spx-desk-intel";

function fakePositioning(): GexPositioning {
  return {
    ticker: "SPX",
    spot: 5900,
    change_pct: 0.4,
    asof: new Date().toISOString(),
    flip: 5890,
    call_wall: 5910,
    put_wall: 5880,
    max_pain: 5900,
    gex_king_strike: 5905,
    net_gex: -1_200_000_000,
    gamma_posture: "short",
    gamma_regime_read: "dealers short gamma below flip",
    net_vex: 400_000_000,
    vanna_posture: "positive",
    vanna_regime_read: "positive vanna cushions dips",
    net_dex: -800_000_000,
    dex_posture: "short",
    dex_regime_read: "destabilizing delta",
    net_charm: 200_000_000,
    charm_posture: "positive",
    charm_regime_read: "pin upward into close",
    nearest_wall: { strike: 5910, kind: "resistance", distance_pts: 10 },
    distance_to_flip_pct: 0.17,
    shift_summary: null,
    source: "polygon",
  };
}

describe("spx-desk-intel formatters", () => {
  test("dealersBriefLine includes GEX VEX DEX CHARM", () => {
    const intel: SpxDeskBriefIntel = {
      positioning: fakePositioning(),
      heatmap: {
        vex: { flip: 5895 },
        dex: { zero_level: 5892 },
        charm: { zero_level: 5902 },
      } as SpxDeskBriefIntel["heatmap"],
    };
    const line = dealersBriefLine(intel);
    assert.ok(line);
    assert.match(line!, /DEALERS/);
    assert.match(line!, /GEX/);
    assert.match(line!, /VEX/);
    assert.match(line!, /DEX/);
    assert.match(line!, /CHARM/);
    assert.match(line!, /vanna flip/);
    assert.match(line!, /δ-zero/);
  });

  test("wallsBriefLine lists call and put walls with distance", () => {
    const line = wallsBriefLine({ positioning: fakePositioning() }, 5900);
    assert.ok(line?.includes("call wall"));
    assert.ok(line?.includes("put wall"));
  });

  // BUG FIX (2026-10-17, Ask Largo standing mandate, live repros AAPL/META/AMZN/MSFT): the prior
  // version of this test only checked substring presence, never the γflip clause's own sign —
  // which is exactly how the fixture's own backwards sign (flip BELOW spot but a POSITIVE
  // distance_to_flip_pct) went uncaught. Flip here (5890) is 10pts BELOW spot (5900), so the
  // correctly-signed distance must be NEGATIVE, matching the same "level minus spot" convention
  // the call/put wall clauses a few words earlier in the identical line already use.
  test("wallsBriefLine's γflip distance sign matches the call/put wall clauses' convention (level minus spot)", () => {
    const line = wallsBriefLine({ positioning: fakePositioning() }, 5900);
    assert.ok(line);
    assert.match(line!, /\{\{-0\.2\}\}% from γflip/, `flip (5890) is below spot (5900), distance must be negative; got: ${line}`);
  });

  test("signalsBriefLine exposes grade score and factors", () => {
    const conf: SpxConfluence = {
      score: 72,
      grade: "A",
      action: "BUY_CALL",
      bias: "bullish",
      direction: "long",
      confidence: 0.8,
      headline: "test",
      thesis: "test",
      factors: [{ label: "VWAP", weight: 0.4, detail: "above session avg" }],
      levels: { entry: 5900, stop: 5888, target: 5920 },
      conflicts: 0,
      weighted_conflicts: 0,
      agreeing: 4,
    };
    const line = signalsBriefLine(conf);
    assert.match(line, /SIGNALS/);
    assert.match(line, /\{\{A\}\}/);
    assert.match(line, /\{\{72\}\}/);
  });

  test("knownIntelNumbers collects matrix strikes", () => {
    const nums = knownIntelNumbers({ positioning: fakePositioning() });
    assert.ok(nums.includes(5910));
    assert.ok(nums.includes(5890));
  });

  test("nighthawkBriefLine surfaces SPX play from edition", () => {
    const line = nighthawkBriefLine({
      positioning: null,
      nighthawk: {
        available: true,
        edition_for: "2026-07-09",
        published_at: "2026-07-10T12:00:00.000Z",
        recap_headline: null,
        recap_summary: null,
        plays: [
          {
            rank: 1,
            ticker: "SPX",
            direction: "long",
            conviction: "high",
            play_type: "index",
            thesis: "test",
            key_signal: "test",
            entry_range: "5900",
            target: "5920",
            stop: "5888",
            options_play: "call",
            score: 88,
          },
        ],
      },
    });
    assert.ok(line?.includes("NIGHT HAWK"));
    assert.ok(line?.includes("SPX"));
    assert.ok(line?.includes("5920"));
  });
});
