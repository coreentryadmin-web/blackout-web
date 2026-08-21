import "server-only";

import { fetchTickerFundamentalsBundle } from "@/lib/bie/ticker-fundamentals";
import { gexHeatmapForLargo } from "@/lib/largo/gex-heatmap-for-largo";
import { fetchGexHeatmap } from "@/lib/providers/polygon-options-gex";
import {
  scopeStructureToExpiry,
  describeEventExpiry,
} from "@/lib/meridian/meridian-event-expiry-core";
import { getVectorExpectedMove } from "@/features/vector/lib/vector-expected-move-server";
import { loadEarningsExpectedMovePct } from "@/lib/meridian/meridian-earnings-expected-move";
import { marketPlatform } from "@/lib/platform";
import { roundFloats } from "@/lib/round-floats";
import { thermalScopes } from "@/lib/meridian/meridian-thermal-scope";
import { buildMeridianFinancialsContext } from "@/lib/meridian/meridian-financials-context";
import { fetchUwDarkPool } from "@/lib/providers/unusual-whales";
import {
  beatRateFromPrints,
  beatRateWithCohort,
  buildErPlayRead,
  coerceMeridianWallLevels,
  flowWindowHours,
  shapeMeridianDarkPool,
} from "@/lib/meridian/meridian-earnings-intel-core";
import { buildMeridianEarningsReport } from "@/lib/meridian/meridian-earnings-report-core";
import type { PreEarningsPackCard } from "@/lib/largo/pre-earnings-pack";
import type {
  MeridianEarningsEnrichment,
  MeridianEarningsIntel,
  MeridianEarningsPrint,
} from "@/features/meridian/lib/meridian-types";

export type MeridianEarningsIntelPrefetch = {
  fundamentals: Awaited<ReturnType<typeof fetchTickerFundamentalsBundle>> | null;
  vectorEm: Awaited<ReturnType<typeof getVectorExpectedMove>> | null;
  darkPoolRaw: Awaited<ReturnType<typeof fetchUwDarkPool>> | null;
  rawHeatmap: Awaited<ReturnType<typeof fetchGexHeatmap>> | null;
  windowHours?: number;
};

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
  enrichment: MeridianEarningsEnrichment;
  /** When provided, skips redundant upstream fetches (Meridian event parallel loader). */
  prefetch?: MeridianEarningsIntelPrefetch;
}): Promise<MeridianEarningsIntel> {
  const sym = input.ticker.trim().toUpperCase();
  const windowHours =
    input.prefetch?.windowHours ?? flowWindowHours(input.pack.days_until);
  const pf = input.prefetch;

  const rawHeatmapPromise =
    pf != null
      ? Promise.resolve(pf.rawHeatmap)
      : fetchGexHeatmap(sym).catch(() => null);

  const [fundamentals, rawHeatmap, earningsEm, vectorEm, flowSummary, darkPoolRaw] =
    await Promise.all([
      pf != null
        ? Promise.resolve(pf.fundamentals)
        : fetchTickerFundamentalsBundle(sym).catch(() => null),
      rawHeatmapPromise,
      input.pack.expected_move_pct != null
        ? Promise.resolve(input.pack.expected_move_pct)
        : loadEarningsExpectedMovePct(sym, input.pack.earnings_date).catch(() => null),
      pf != null
        ? Promise.resolve(pf.vectorEm)
        : getVectorExpectedMove(sym, "weekly").catch(() => null),
      marketPlatform.flows
        .getFlowTapeSummary({ ticker: sym, limit: 30, since_hours: windowHours })
        .catch(() => null),
      pf != null
        ? Promise.resolve(pf.darkPoolRaw)
        : fetchUwDarkPool(sym, { limit: 20 }).catch(() => null),
    ]);

  const thermal = await gexHeatmapForLargo(sym, {
    lens: "gex",
    top_strikes: 8,
    heatmap: rawHeatmap,
  }).catch(() => null);

  /**
   * Dealer structure scoped to the expiry that COVERS THE PRINT.
   *
   * The aggregate the matrix publishes sums walls and flip over the ~8 nearest expiries and
   * scopes max pain to the FRONT one. For a report ten days out that is wrong twice: the front
   * expiry can die before the company speaks, and the near-term sum is dominated by whichever
   * weekly carries the most open interest rather than the one spanning the event. The matrix's
   * own comment tells panels to re-scope from `cells` instead of "showing an aggregate flip
   * beside a single-expiry max pain" — which is exactly what this desk was doing.
   *
   * Falls back to the aggregate when the scoped column carries no data, and records WHICH it
   * used, because the two look identical on screen and only one answers "what is positioned
   * around this print".
   */
  const scoped = scopeStructureToExpiry({
    cells: rawHeatmap?.gex?.cells ?? null,
    expiries: rawHeatmap?.expiries ?? null,
    maxPainByExpiry: rawHeatmap?.max_pain_by_expiry ?? null,
    eventYmd: input.pack.earnings_date ?? null,
    aggregateExpiries: rawHeatmap?.near_term_expiries ?? rawHeatmap?.expiries ?? null,
  });
  const scopeUsable = scoped.expiryUsed != null && Object.keys(scoped.strikeTotals).length > 0;

  const dark_pool = shapeMeridianDarkPool(darkPoolRaw);

  const expected_move_pct =
    earningsEm ??
    (vectorEm?.movePct != null ? Number((vectorEm.movePct * 100).toFixed(1)) : null) ??
    input.pack.expected_move_pct;

  const expected_move_source =
    earningsEm != null || vectorEm?.movePct != null
      ? "chain_iv"
      : input.pack.expected_move_pct != null
        ? "calendar"
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

  const spot = input.pack.positioning.spot ?? thermal?.spot ?? null;
  const gamma_regime =
    thermal?.gamma_regime_read ?? input.pack.positioning.gamma_regime ?? null;

  const rawCallWall =
    (scopeUsable ? (scoped.callWall ?? thermal?.call_wall) : thermal?.call_wall) ??
    input.pack.positioning.call_wall ??
    null;
  const rawPutWall =
    (scopeUsable ? (scoped.putWall ?? thermal?.put_wall) : thermal?.put_wall) ??
    input.pack.positioning.put_wall ??
    null;
  const walls = coerceMeridianWallLevels({
    call_wall: rawCallWall,
    put_wall: rawPutWall,
    spot,
  });

  // ONE resolution of the rate and its cohort, used by both consumers below. Resolving it twice
  // invited them to disagree, and a rate that reaches two readers with two different denominators
  // is the defect this carries the cohort to prevent.
  const beatFromPrints = beatRateWithCohort(input.print_history);
  const beat_rate = input.enrichment.beat_rates?.combined_beat_rate ?? beatFromPrints.rate;
  const beat_rate_graded =
    input.enrichment.beat_rates?.combined_beat_rate != null
      // prints_graded, NOT combined_graded: the pooled denominator counts READINGS (eps +
      // revenue), so an 8-print name reports 16 — and both consumers render it as "over N
      // prints". Measured live on NVDA: "100% beat rate over 16 prints" against 8 real prints.
      ? (input.enrichment.beat_rates?.prints_graded ?? null)
      : beatFromPrints.graded;

  const play_read = buildErPlayRead({
    flow_bias: input.pack.flow.bias,
    dark_pool_bias: dark_pool.available ? dark_pool.bias : null,
    gamma_regime,
    expected_move_pct,
    days_until: input.pack.days_until,
    beat_rate,
    beat_rate_graded,
    spot,
    call_wall: walls.call_wall,
    put_wall: walls.put_wall,
    king_strike: thermal?.gex_king_strike ?? null,
  });

  const vector_move_pct =
    vectorEm?.movePct != null ? Number((vectorEm.movePct * 100).toFixed(1)) : null;

  const report = buildMeridianEarningsReport({
    ticker: sym,
    days_until: input.pack.days_until,
    flow_bias: input.pack.flow.bias,
    dark_pool_bias: dark_pool.available ? dark_pool.bias : null,
    dark_pool_available: dark_pool.available,
    gamma_regime,
    thermal_available: thermal?.available ?? false,
    spot,
    king_strike: thermal?.gex_king_strike ?? null,
    call_wall: walls.call_wall,
    put_wall: walls.put_wall,
    expected_move_pct,
    beat_rate,
    beat_rate_graded,
    post_print: input.enrichment.post_print,
    earnings_yoy: input.enrichment.earnings_yoy,
    financials: buildMeridianFinancialsContext(fundamentals),
    analyst_revisions: input.enrichment.analyst_revisions,
    earnings_headlines: input.enrichment.earnings_headlines,
    catalysts: input.enrichment.catalysts,
    insider_activity_count: input.enrichment.insider_activity.length,
    vector_move_pct,
    vector_expiry: vectorEm?.expiry ?? null,
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
    dark_pool,
    thermal: thermal?.available
      ? {
          available: true,
          spot: thermal.spot,
          gex_king_strike: thermal.gex_king_strike,
          call_wall: walls.call_wall,
          put_wall: walls.put_wall,
          gamma_call_wall: walls.gamma_call_wall,
          gamma_put_wall: walls.gamma_put_wall,
          walls_inverted: walls.walls_inverted,
          flip: thermal.flip,
          max_pain: scopeUsable ? (scoped.maxPain ?? thermal.max_pain) : thermal.max_pain,
          // Which chain these levels describe. Named so a reader can tell an event-scoped wall
          // from a whole-book one — they render identically otherwise.
          //
          // `expiry_scope` describes the WALLS and MAX PAIN, which are the fields re-summed above.
          // It never described the king node, the flip, net GEX, the top-strike table, the nearest
          // wall or the regime sentence — those are passed through from the whole-book aggregate
          // — but it was rendered as a badge over all of them. `...thermalScopes()` states the
          // scope of each, so the payload and the panel cannot disagree about it.
          expiry_scope: scopeUsable ? "event_expiry" : "aggregate",
          ...thermalScopes(scopeUsable, scoped.aggregateExpiryCount),
          expiry_used: scoped.expiryUsed,
          expiry_days_from_event: scoped.daysFromEvent,
          expiry_label: scopeUsable
            ? describeEventExpiry(scoped)
            : scoped.noCoveringExpiry
              ? "no listed expiry covers this print"
              : `aggregate of ${scoped.aggregateExpiryCount} near-term expiries`,
          aggregate_expiry_count: scoped.aggregateExpiryCount,
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
      : (() => {
          const fallbackWalls = coerceMeridianWallLevels({
            call_wall: input.pack.positioning.call_wall,
            put_wall: input.pack.positioning.put_wall,
            spot: input.pack.positioning.spot,
          });
          return {
          available: false,
          spot: input.pack.positioning.spot,
          gex_king_strike: null,
          call_wall: fallbackWalls.call_wall,
          put_wall: fallbackWalls.put_wall,
          gamma_call_wall: fallbackWalls.gamma_call_wall,
          gamma_put_wall: fallbackWalls.gamma_put_wall,
          walls_inverted: fallbackWalls.walls_inverted,
          flip: input.pack.positioning.flip ?? null,
          max_pain: null,
          // No chain was read at all, so nothing here is event-scoped. Declared rather than
          // omitted: a UI that has to treat a MISSING scope as a scope is back to guessing.
          ...thermalScopes(false, null),
          net_gex_label: null,
          gamma_regime: input.pack.positioning.gamma_regime,
          top_strikes: [],
          nearest_wall: null,
        };
        })(),
    vector: vectorEm
      ? {
          available: true,
          expiry: vectorEm.expiry,
          move_pct: vector_move_pct,
          spot,
          bands: vectorEm.bands?.map((b) => ({
            sigma: b.sigma,
            low: Number(b.low.toFixed(2)),
            high: Number(b.high.toFixed(2)),
          })) ?? null,
        }
      : {
          available: false,
          expiry: null,
          move_pct: vector_move_pct,
          spot,
          bands: null,
        },
    report,
    play_read,
  });
}
