import { test } from "node:test";
import assert from "node:assert/strict";
import type { ZeroDteBoardPayload } from "@/lib/platform/zerodte-service";
import {
  isMeridianSpxEarningsTicker,
  shapeMeridianNighthawkBoardRead,
  shapeMeridianSpxDeskRead,
} from "./meridian-cross-product-for-earnings-core";

test("isMeridianSpxEarningsTicker matches SPX and SPXW only", () => {
  assert.equal(isMeridianSpxEarningsTicker("SPX"), true);
  assert.equal(isMeridianSpxEarningsTicker("spxw"), true);
  assert.equal(isMeridianSpxEarningsTicker("NVDA"), false);
});

test("shapeMeridianNighthawkBoardRead: ledger row wins over setup", () => {
  const board = {
    available: true as const,
    as_of: "2026-08-25T15:00:00.000Z",
    upstream_ok: true,
    session: { date: "2026-08-25", trading_day: true, heat: { state: "RTH", label: "Desk hot", heat_pct: 100, note: "" } },
    setups: [
      {
        ticker: "NVDA",
        direction: "long",
        top_strike: 130,
        expiry: "2026-08-25",
        score: 55,
        dossier_score: 60,
        conviction: "medium",
      },
    ],
    discovery_health: {} as ZeroDteBoardPayload["discovery_health"],
    ledger: [
      {
        ticker: "NVDA",
        direction: "long",
        score_max: 72,
        top_strike: 132,
        expiry: "2026-08-25",
        conviction: "high",
        status: "OPEN",
        live_pnl_pct: 12.5,
      },
    ],
    covered_elsewhere: [],
    governor: null,
    allocation: [],
    market_state: null,
    discovery_funnel: null,
    spx_slayer_badge: null,
  } satisfies ZeroDteBoardPayload;

  const read = shapeMeridianNighthawkBoardRead({ ticker: "NVDA", board });
  assert.equal(read.available, true);
  assert.equal(read.lane, "ledger");
  assert.equal(read.strike, 132);
  assert.match(read.headline ?? "", /132C/);
  assert.equal(read.live_pnl_pct, 12.5);
});

test("shapeMeridianNighthawkBoardRead: honest empty when ticker is not on board", () => {
  const read = shapeMeridianNighthawkBoardRead({ ticker: "ZZZZ", board: null });
  assert.equal(read.available, false);
  assert.equal(read.on_board, false);
});

test("shapeMeridianSpxDeskRead: desk + play badge when live", () => {
  const read = shapeMeridianSpxDeskRead({
    summary: {
      as_of: "2026-08-25T15:00:00.000Z",
      market_open: true,
      market_label: "RTH",
      price: 6450,
      change_pct: 0.42,
      vix: 15,
      vwap: 6440,
      above_vwap: true,
      hod: 6460,
      lod: 6420,
      pdh: 6445,
      pdl: 6400,
      ema20: 6430,
      ema50: 6400,
      gamma_flip: 6448,
      gex_net: 1_000_000,
      gex_king: 6450,
      max_pain: 6440,
      gamma_regime: "Long gamma",
      gex_walls: [
        { strike: 6500, net_gex: 1, kind: "resistance", distance_pts: 50 },
        { strike: 6400, net_gex: -1, kind: "support", distance_pts: 50 },
      ],
      flow_0dte_net: 250_000,
      tide_bias: "bullish",
      tide_net: 100,
      nope: null,
      tick: null,
      trin: null,
      add: null,
      uw_iv_rank: null,
      regime: null,
      levels: null,
      dark_pool: null,
      spx_flows: null,
      unified_tape: null,
      net_prem_ticks: null,
      news_headlines: null,
      macro_events: null,
      sector_heat: null,
      leader_stocks: null,
      oi_changes: null,
      iv_term_structure: null,
      vix_term: null,
      greek_exposure: null,
      market_breadth: null,
      mag7_greek_flow: null,
      macro_indicators: null,
      strike_stacks: [{ strike: 6450, total_premium: 900_000, alert_count: 3, option_type: "call" }],
    },
    playBadge: {
      available: true,
      symbol: "SPX",
      phase: "OPEN",
      action: "HOLD",
      direction: "long",
      grade: "B",
      score: 68,
      headline: "Long above gamma flip",
      as_of: "2026-08-25T15:00:00.000Z",
      unavailable_reason: null,
    },
  });

  assert.equal(read.available, true);
  assert.equal(read.price, 6450);
  assert.equal(read.call_wall, 6500);
  assert.equal(read.put_wall, 6400);
  assert.equal(read.play_action, "HOLD");
  assert.equal(read.strike_stacks.length, 1);
});

test("shapeMeridianSpxDeskRead: call/put wall picks the DOMINANT (largest |net_gex|) strike on each side, not merely the first array entry", () => {
  // THE BUG. `gex_walls` ships from `topGexWalls` (gamma-desk.ts) sorted by STRIKE DESCENDING for
  // display — that function's own doc comment says `kind` is purely GEOMETRIC (strike > spot ->
  // "resistance") and explicitly warns consumers to derive the call/put wall from net_gex SIGN
  // ("The component derives the call/put wall label from net_gex SIGN... geometry != sign"), not
  // from `kind` alone. The local `topGexWalls` here instead took the FIRST row of each kind in
  // array order — which, because the array is strike-descending, is the FARTHEST resistance strike
  // (the highest strike overall) and the NEAREST support strike (the highest strike among supports)
  // — an asymmetric mis-pick whenever the ladder's proximity-filled rows extend past the true
  // dominant wall on the call side. 6550 here is a weak, far decoy that sorts before the real
  // $6500 dominant call wall (net_gex 5 vs 0.5) purely because it has a higher strike.
  const read = shapeMeridianSpxDeskRead({
    summary: {
      as_of: "2026-08-25T15:00:00.000Z",
      market_open: true,
      market_label: "RTH",
      price: 6450,
      change_pct: 0.42,
      vix: 15,
      vwap: 6440,
      above_vwap: true,
      hod: 6460,
      lod: 6420,
      pdh: 6445,
      pdl: 6400,
      ema20: 6430,
      ema50: 6400,
      gamma_flip: 6448,
      gex_net: 1_000_000,
      gex_king: 6500,
      max_pain: 6440,
      gamma_regime: "Long gamma",
      // Strike-descending, exactly as `topGexWalls` (gamma-desk.ts) emits it.
      gex_walls: [
        { strike: 6550, net_gex: 0.5, kind: "resistance", distance_pts: 100 },
        { strike: 6500, net_gex: 5, kind: "resistance", distance_pts: 50 },
        { strike: 6400, net_gex: -3, kind: "support", distance_pts: -50 },
        { strike: 6350, net_gex: -0.4, kind: "support", distance_pts: -100 },
      ],
      flow_0dte_net: 250_000,
      tide_bias: "bullish",
      tide_net: 100,
      nope: null,
      tick: null,
      trin: null,
      add: null,
      uw_iv_rank: null,
      regime: null,
      levels: null,
      dark_pool: null,
      spx_flows: null,
      unified_tape: null,
      net_prem_ticks: null,
      news_headlines: null,
      macro_events: null,
      sector_heat: null,
      leader_stocks: null,
      oi_changes: null,
      iv_term_structure: null,
      vix_term: null,
      greek_exposure: null,
      market_breadth: null,
      mag7_greek_flow: null,
      macro_indicators: null,
      strike_stacks: [],
    },
    playBadge: null,
  });

  assert.equal(read.available, true);
  // Dominant call wall is $6500 (net_gex 5), not the farther, weaker $6550 decoy.
  assert.equal(read.call_wall, 6500);
  // Dominant put wall is $6400 (net_gex -3), not the farther, weaker $6350 decoy.
  assert.equal(read.put_wall, 6400);
});
