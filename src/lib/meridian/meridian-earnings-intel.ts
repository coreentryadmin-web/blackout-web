import "server-only";

import { fetchTickerFundamentalsBundle } from "@/lib/bie/ticker-fundamentals";
import { gexHeatmapForLargo } from "@/lib/largo/gex-heatmap-for-largo";
import { getVectorExpectedMove } from "@/features/vector/lib/vector-expected-move-server";
import { marketPlatform } from "@/lib/platform";
import { roundFloats } from "@/lib/round-floats";
import { buildMeridianFinancialsContext } from "@/lib/meridian/meridian-financials-context";
import {
  beatRateFromPrints,
  buildErPlayRead,
  flowWindowHours,
} from "@/lib/meridian/meridian-earnings-intel-core";
import type { PreEarningsPackCard } from "@/lib/largo/pre-earnings-pack";
import type {
  MeridianEarningsIntel,
  MeridianEarningsPrint,
} from "@/features/meridian/lib/meridian-types";

function fmtPrem(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

/** Full earnings intelligence layer for Meridian event detail. */
export async function loadMeridianEarningsIntel(input: {
  ticker: string;
  pack: PreEarningsPackCard;
  print_history: MeridianEarningsPrint[];
}): Promise<MeridianEarningsIntel> {
  const sym = input.ticker.trim().toUpperCase();
  const windowHours = flowWindowHours(input.pack.days_until);

  const [fundamentals, thermal, vectorEm, flowSummary] = await Promise.all([
    fetchTickerFundamentalsBundle(sym).catch(() => null),
    gexHeatmapForLargo(sym, { lens: "gex", top_strikes: 8 }).catch(() => null),
    input.pack.expected_move_pct == null
      ? getVectorExpectedMove(sym, "weekly").catch(() => null)
      : Promise.resolve(null),
    marketPlatform.flows
      .getFlowTapeSummary({ ticker: sym, limit: 30, since_hours: windowHours })
      .catch(() => null),
  ]);

  const expected_move_pct =
    input.pack.expected_move_pct ??
    (vectorEm?.movePct != null ? Number((vectorEm.movePct * 100).toFixed(1)) : null);

  const expected_move_source =
    input.pack.expected_move_pct != null
      ? "calendar"
      : vectorEm?.movePct != null
        ? "chain_iv"
        : null;

  const top_flows = (flowSummary?.recent ?? [])
    .slice(0, 8)
    .map((row) => ({
      premium: row.premium,
      premium_label: fmtPrem(row.premium),
      option_type: row.option_type ?? null,
      strike: row.strike ?? null,
      expiry: row.expiry ?? null,
      dte: row.dte ?? null,
    }))
    .filter((r) => r.premium > 0);

  const strike_stacks = (flowSummary?.strike_stacks ?? []).slice(0, 6).map((s) => ({
    strike: s.strike,
    premium: s.total_premium,
    premium_label: fmtPrem(s.total_premium),
    hit_count: s.alert_count,
    dominant_type: s.option_type ?? null,
  }));

  const play_read = buildErPlayRead({
    flow_bias: input.pack.flow.bias,
    gamma_regime: input.pack.positioning.gamma_regime,
    expected_move_pct,
    days_until: input.pack.days_until,
    beat_rate: beatRateFromPrints(input.print_history),
    spot: input.pack.positioning.spot ?? thermal?.spot ?? null,
    call_wall: input.pack.positioning.call_wall ?? thermal?.call_wall ?? null,
    put_wall: input.pack.positioning.put_wall ?? thermal?.put_wall ?? null,
    king_strike: thermal?.gex_king_strike ?? null,
  });

  return roundFloats({
    expected_move_pct,
    expected_move_source,
    expected_move_band:
      expected_move_pct != null && input.pack.positioning.spot != null
        ? {
            spot: input.pack.positioning.spot,
            up: Number(
              (input.pack.positioning.spot * (1 + expected_move_pct / 100)).toFixed(2)
            ),
            down: Number(
              (input.pack.positioning.spot * (1 - expected_move_pct / 100)).toFixed(2)
            ),
          }
        : null,
    financials: buildMeridianFinancialsContext(fundamentals),
    flow_into_print: {
      available: top_flows.length > 0,
      window_hours: windowHours,
      bias: input.pack.flow.bias,
      net_premium: input.pack.flow.net_premium,
      net_premium_label:
        input.pack.flow.net_premium != null ? fmtPrem(input.pack.flow.net_premium) : null,
      top_prints: top_flows,
      strike_stacks,
    },
    thermal: thermal?.available
      ? {
          available: true,
          spot: thermal.spot,
          gex_king_strike: thermal.gex_king_strike,
          call_wall: thermal.call_wall,
          put_wall: thermal.put_wall,
          flip: thermal.flip,
          max_pain: thermal.max_pain,
          net_gex_label:
            thermal.net_gex != null ? fmtPrem(thermal.net_gex) : null,
          gamma_regime: thermal.gamma_regime_read,
          top_strikes: thermal.top_strikes.map((s) => ({
            strike: s.strike,
            net_label: fmtPrem(s.net),
            pct_of_total: Number(s.pct_of_total.toFixed(1)),
          })),
          nearest_wall: thermal.nearest_wall,
        }
      : {
          available: false,
          spot: input.pack.positioning.spot,
          gex_king_strike: null,
          call_wall: input.pack.positioning.call_wall,
          put_wall: input.pack.positioning.put_wall,
          flip: input.pack.positioning.flip ?? null,
          max_pain: null,
          net_gex_label: null,
          gamma_regime: input.pack.positioning.gamma_regime,
          top_strikes: [],
          nearest_wall: null,
        },
    play_read,
  });
}
