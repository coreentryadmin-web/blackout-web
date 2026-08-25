import type { EnrichedZeroDteSetup } from "../../board";
import type { FlowQuality } from "../../flow-quality";
import type { IntradayRead } from "../../intraday";
import { scoreBreakoutRail } from "./breakout";
import { scoreFlowRail } from "./flow";
import { scoreMomentumRail } from "./momentum";
import { scorePositioningRail } from "./positioning";
import { scoreReversalRail } from "./reversal";
import { scoreRsRail } from "./rs";
import { scoreCatalystRail } from "./catalyst";
import { scoreVolRail } from "./vol";
import type { RailHit } from "../types";

export type LegacyBridgeExtras = {
  intraday?: IntradayRead | null;
  flow_quality?: FlowQuality | null;
  stock_session_pct?: number | null;
  qqq_session_pct?: number | null;
  sector_session_pct?: number | null;
  resistance?: number | null;
  support?: number | null;
  gamma_posture?: "long" | "short" | null;
  call_wall?: number | null;
  put_wall?: number | null;
  /** Vector bead / confluence level near spot (cache reader). */
  bead_wall_near_spot?: number | null;
  /** Options-implied 1σ move % when available. */
  expected_move_pct?: number | null;
  dark_pool_bias?: "bullish" | "bearish" | "mixed" | null;
};

/** Bridge existing EnrichedZeroDteSetup → thesis rail hits for shadow merge. */
export function railHitsFromLegacySetup(
  setup: EnrichedZeroDteSetup,
  extras: LegacyBridgeExtras = {}
): RailHit[] {
  const hits: RailHit[] = [];
  const ticker = setup.ticker;
  const direction = setup.direction;

  if (setup.discovery_origin.includes("FLOW") || (setup.gross_premium ?? 0) >= 200_000) {
    const h = scoreFlowRail({
      ticker,
      direction,
      gross_premium: setup.gross_premium ?? 0,
      flow_quality: extras.flow_quality ?? setup.flow_quality ?? null,
    });
    if (h) hits.push(h);
  }

  if (setup.discovery_origin.includes("BREAKOUT")) {
    const resistance =
      extras.resistance ??
      setup.key_resistances?.[0] ??
      extras.bead_wall_near_spot ??
      null;
    const h = scoreBreakoutRail({
      ticker,
      direction,
      spot: setup.underlying_price ?? 0,
      resistance,
      support: extras.support ?? setup.key_supports?.[0] ?? null,
      rel_vol: setup.rel_volume ?? null,
      intraday: extras.intraday ?? setup.intraday ?? null,
      legacy_score: setup.score,
    });
    if (h) hits.push(h);
  }

  if (setup.discovery_origin.includes("PIN")) {
    const h = scorePositioningRail({
      ticker,
      direction,
      gamma_posture:
        extras.gamma_posture ??
        (setup.gamma_regime?.includes("short") ? "short" : setup.gamma_regime?.includes("long") ? "long" : null),
      call_wall: extras.call_wall ?? setup.key_resistances?.[0] ?? setup.gex_king_strike ?? null,
      put_wall: extras.put_wall ?? setup.key_supports?.[0] ?? null,
      spot: setup.underlying_price ?? null,
      pin_score: setup.score,
    });
    if (h) hits.push(h);
  }

  const mom = scoreMomentumRail({
    ticker,
    direction,
    rel_vol: setup.rel_volume ?? null,
    intraday: extras.intraday ?? setup.intraday ?? null,
  });
  if (mom) hits.push(mom);

  const rs = scoreRsRail({
    ticker,
    direction,
    stock_session_pct: extras.stock_session_pct ?? null,
    qqq_session_pct: extras.qqq_session_pct ?? null,
    sector_session_pct: extras.sector_session_pct ?? null,
  });
  if (rs) hits.push(rs);

  const rev = scoreReversalRail({
    ticker,
    direction,
    rsi14: setup.rsi14 ?? null,
    intraday: extras.intraday ?? setup.intraday ?? null,
  });
  if (rev && rev.score >= 65) hits.push(rev);

  const cat = scoreCatalystRail({
    ticker,
    direction,
    catalyst_flags: setup.catalyst_flags,
    news_hot: setup.news_hot ?? null,
    earnings: setup.earnings ?? null,
    expected_move_pct: extras.expected_move_pct ?? setup.earnings?.expected_move_pct ?? null,
  });
  if (cat) hits.push(cat);

  const vol = scoreVolRail({
    ticker,
    direction,
    rel_volume: setup.rel_volume ?? null,
    gamma_regime: setup.gamma_regime ?? null,
    rsi14: setup.rsi14 ?? null,
  });
  if (vol) hits.push(vol);

  return hits;
}
