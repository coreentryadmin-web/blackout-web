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

/** Corroboration bump when cross-product evidence aligns with setup direction. */
export function crossProductCorroborationBoost(
  direction: "long" | "short",
  extras: LegacyBridgeExtras
): number {
  let boost = 0;
  const dp = extras.dark_pool_bias;
  if (dp === "bullish" && direction === "long") boost += 4;
  if (dp === "bearish" && direction === "short") boost += 4;
  const helix = extras.helix_direction_bias;
  if (helix === direction) boost += 5;
  if (
    (extras.helix_gross_premium ?? 0) >= 1_000_000 &&
    helix === direction
  ) {
    boost += 3;
  }
  return boost;
}

function applyCorroborationBoost(hit: RailHit, boost: number): RailHit {
  if (boost <= 0) return hit;
  return {
    ...hit,
    score: Math.min(100, hit.score + boost),
    summary: `${hit.summary} · +${boost} cross-product`,
  };
}

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
  /** HELIX Postgres tape aggregates (scan batch, not per-request provider). */
  helix_print_count?: number | null;
  helix_gross_premium?: number | null;
  helix_direction_bias?: "long" | "short" | "mixed" | null;
};

/** Setup-native fields the scan already carries — floor for desk evidence when cache extras miss a ticker. */
export function legacyBridgeExtrasFromSetup(setup: EnrichedZeroDteSetup): LegacyBridgeExtras {
  const gamma = setup.gamma_regime;
  let gamma_posture: "long" | "short" | null = null;
  if (gamma?.includes("long")) gamma_posture = "long";
  else if (gamma?.includes("short")) gamma_posture = "short";

  const callWall = setup.key_resistances?.[0] ?? setup.gex_king_strike ?? null;
  const putWall = setup.key_supports?.[0] ?? null;

  return {
    intraday: setup.intraday ?? null,
    flow_quality: setup.flow_quality ?? null,
    gamma_posture,
    call_wall: callWall,
    put_wall: putWall,
    resistance: callWall,
    support: putWall,
    helix_gross_premium: (setup.gross_premium ?? 0) > 0 ? setup.gross_premium : null,
    helix_print_count: (setup.prints ?? 0) > 0 ? setup.prints : null,
  };
}

/** Bridge existing EnrichedZeroDteSetup → thesis rail hits for shadow merge. */
export function railHitsFromLegacySetup(
  setup: EnrichedZeroDteSetup,
  extras: LegacyBridgeExtras = {}
): RailHit[] {
  const hits: RailHit[] = [];
  const ticker = setup.ticker;
  const direction = setup.direction;
  const corroBoost = crossProductCorroborationBoost(direction, extras);
  // Each discovery origin's OWN voted direction (recordOriginContributionsOnMerge, board.ts) —
  // a same-ticker merge can carry a real cross-origin disagreement (e.g. FLOW long, PIN short)
  // that the board's merge precedence resolves to a single kept `setup.direction` for COMMIT
  // purposes, but the losing origin's real vote is preserved here. Falling back to `direction`
  // covers the common single-origin case (no conflict recorded) and any legacy row from before
  // origin_contributions existed. Without this, every rail hit echoed `setup.direction` and
  // `disagreeing_rails` (pipeline.ts) could never fire on a genuine cross-rail conflict — see
  // the 2026-08-26 finding.
  const flowDirection = setup.origin_contributions?.FLOW?.direction ?? direction;
  const breakoutDirection = setup.origin_contributions?.BREAKOUT?.direction ?? direction;
  const pinDirection = setup.origin_contributions?.PIN?.direction ?? direction;

  if (setup.discovery_origin.includes("FLOW") || (setup.gross_premium ?? 0) >= 200_000) {
    const h = scoreFlowRail({
      ticker,
      direction: flowDirection,
      gross_premium: setup.gross_premium ?? extras.helix_gross_premium ?? 0,
      flow_quality: extras.flow_quality ?? setup.flow_quality ?? null,
      print_count: extras.helix_print_count ?? undefined,
    });
    if (h) hits.push(applyCorroborationBoost(h, corroBoost));
  }

  if (setup.discovery_origin.includes("BREAKOUT")) {
    const resistance =
      extras.resistance ??
      setup.key_resistances?.[0] ??
      extras.bead_wall_near_spot ??
      null;
    const h = scoreBreakoutRail({
      ticker,
      direction: breakoutDirection,
      spot: setup.underlying_price ?? 0,
      resistance,
      support: extras.support ?? setup.key_supports?.[0] ?? null,
      rel_vol: setup.rel_volume ?? null,
      intraday: extras.intraday ?? setup.intraday ?? null,
      legacy_score: setup.score,
    });
    if (h) hits.push(applyCorroborationBoost(h, corroBoost));
  }

  if (setup.discovery_origin.includes("PIN")) {
    const h = scorePositioningRail({
      ticker,
      direction: pinDirection,
      gamma_posture:
        extras.gamma_posture ??
        (setup.gamma_regime?.includes("short") ? "short" : setup.gamma_regime?.includes("long") ? "long" : null),
      call_wall: extras.call_wall ?? setup.key_resistances?.[0] ?? setup.gex_king_strike ?? null,
      put_wall: extras.put_wall ?? setup.key_supports?.[0] ?? null,
      spot: setup.underlying_price ?? null,
      pin_score: setup.score,
    });
    if (h) hits.push(applyCorroborationBoost(h, Math.min(corroBoost, 6)));
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
