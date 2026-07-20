import "server-only";

import { fetchGexHeatmap } from "@/lib/providers/polygon-options-gex";
import { getGexPositioning } from "@/lib/providers/gex-positioning";
import { strikeTotalsFromLadder } from "@/lib/providers/gex-cross-validation-core";

export type GexHeatmapLargoLens = "gex" | "vex" | "dex" | "charm";

export type GexHeatmapForLargo = {
  ticker: string;
  available: boolean;
  spot: number | null;
  change_pct: number | null;
  asof: string | null;
  strike_count: number;
  expiry_count: number;
  lens: GexHeatmapLargoLens;
  /** Top strikes by |net| for the requested lens (from strike_totals). */
  top_strikes: Array<{ strike: number; net: number; pct_of_total: number }>;
  /** Canonical summary scalars — same contract as get_positioning / Thermal UI. */
  flip: number | null;
  call_wall: number | null;
  put_wall: number | null;
  max_pain: number | null;
  gex_king_strike: number | null;
  net_gex: number | null;
  net_vex: number | null;
  net_dex: number | null;
  net_charm: number | null;
  gamma_regime_read: string | null;
  vanna_regime_read: string | null;
  dex_regime_read: string | null;
  charm_regime_read: string | null;
  nearest_wall: { strike: number; kind: "resistance" | "support"; distance_pts: number } | null;
  distance_to_flip_pct: number | null;
  shift_summary: string | null;
  source: "polygon";
};

function topStrikesFromTotals(
  totals: Record<string, number>,
  limit: number
): Array<{ strike: number; net: number; pct_of_total: number }> {
  let totalAbs = 0;
  for (const v of Object.values(totals)) totalAbs += Math.abs(v);
  if (totalAbs <= 0) return [];

  return Object.entries(totals)
    .map(([strikeStr, net]) => ({
      strike: Number(strikeStr),
      net,
      pct_of_total: (Math.abs(net) / totalAbs) * 100,
    }))
    .filter((r) => Number.isFinite(r.strike) && Number.isFinite(r.net) && r.net !== 0)
    .sort((a, b) => Math.abs(b.net) - Math.abs(a.net))
    .slice(0, limit);
}

/** Compact Thermal matrix read for Largo — canonical cache, not a second upstream. */
export async function gexHeatmapForLargo(
  ticker: string,
  opts?: { lens?: GexHeatmapLargoLens; top_strikes?: number }
): Promise<GexHeatmapForLargo> {
  const sym = String(ticker ?? "").trim().toUpperCase();
  const lens = opts?.lens ?? "gex";
  const topN = Math.min(24, Math.max(4, opts?.top_strikes ?? 12));

  const hm = await fetchGexHeatmap(sym).catch(() => null);
  const pos = hm ? await getGexPositioning(sym).catch(() => null) : null;
  if (!hm || !hm.spot || !hm.strikes?.length) {
    return {
      ticker: sym,
      available: false,
      spot: null,
      change_pct: null,
      asof: null,
      strike_count: 0,
      expiry_count: 0,
      lens,
      top_strikes: [],
      flip: null,
      call_wall: null,
      put_wall: null,
      max_pain: null,
      gex_king_strike: null,
      net_gex: null,
      net_vex: null,
      net_dex: null,
      net_charm: null,
      gamma_regime_read: null,
      vanna_regime_read: null,
      dex_regime_read: null,
      charm_regime_read: null,
      nearest_wall: null,
      distance_to_flip_pct: null,
      shift_summary: null,
      source: "polygon",
    };
  }

  const totals =
    lens === "gex"
      ? hm.gex?.strike_totals ?? {}
      : lens === "vex"
        ? hm.vex?.strike_totals ?? {}
        : lens === "dex"
          ? hm.dex?.strike_totals ?? {}
          : hm.charm?.strike_totals ?? {};

  return {
    ticker: sym,
    available: true,
    spot: hm.spot,
    change_pct: hm.change_pct ?? null,
    asof: hm.asof ?? null,
    strike_count: hm.strikes.length,
    expiry_count: hm.expiries?.length ?? 0,
    lens,
    top_strikes: topStrikesFromTotals(totals, topN),
    flip: pos?.flip ?? hm.gex?.flip ?? null,
    call_wall: pos?.call_wall ?? hm.gex?.call_wall ?? null,
    put_wall: pos?.put_wall ?? hm.gex?.put_wall ?? null,
    max_pain: pos?.max_pain ?? hm.max_pain ?? null,
    gex_king_strike: pos?.gex_king_strike ?? null,
    net_gex: pos?.net_gex ?? hm.gex?.total ?? null,
    net_vex: pos?.net_vex ?? hm.vex?.total ?? null,
    net_dex: pos?.net_dex ?? hm.dex?.total ?? null,
    net_charm: pos?.net_charm ?? hm.charm?.total ?? null,
    gamma_regime_read: pos?.gamma_regime_read ?? hm.gex?.regime?.read ?? null,
    vanna_regime_read: pos?.vanna_regime_read ?? hm.vex?.regime?.read ?? null,
    dex_regime_read: pos?.dex_regime_read ?? hm.dex?.regime?.read ?? null,
    charm_regime_read: pos?.charm_regime_read ?? hm.charm?.regime?.read ?? null,
    nearest_wall: pos?.nearest_wall ?? null,
    distance_to_flip_pct: pos?.distance_to_flip_pct ?? null,
    shift_summary: pos?.shift_summary ?? hm.shift?.summary ?? null,
    source: "polygon",
  };
}

/** Per-strike gamma ladder rows for a ticker (GEX lens totals). */
export function strikeTotalsLadderForLargo(
  totals: Record<string, number>,
  spot: number,
  limit = 20
): Array<{ strike: number; net_gex: number; distance_pts: number }> {
  const ladder = new Map<number, number>();
  for (const [k, v] of Object.entries(totals)) {
    const strike = Number(k);
    if (Number.isFinite(strike) && Number.isFinite(v)) ladder.set(strike, v);
  }
  const ranked = strikeTotalsFromLadder(ladder);
  return Object.entries(ranked)
    .map(([strikeStr, net_gex]) => {
      const strike = Number(strikeStr);
      return { strike, net_gex, distance_pts: +(strike - spot).toFixed(2) };
    })
    .sort((a, b) => Math.abs(b.net_gex) - Math.abs(a.net_gex))
    .slice(0, limit);
}
