import { stripEmbeddedLevel } from "@/lib/largo/strip-embedded-level";
import "server-only";

import { fetchGexHeatmap } from "@/lib/providers/polygon-options-gex";
import { getGexPositioning } from "@/lib/providers/gex-positioning";
import { strikeTotalsFromLadder } from "@/lib/providers/gex-cross-validation-core";
import { etSessionFacts, ageSecondsFromIso, type MarketPhase } from "@/lib/et-session-facts";

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
  /** Why flip is null: 'insufficient_data' | 'net_short_everywhere' | 'net_long_everywhere' | 'crossings_far' (omitted when flip is available). */
  flip_reason?: string | null;
  /**
   * MULTI-EXPIRY AGGREGATE — summed over `near_term_expiries`, which on SPX is currently FIFTEEN
   * expiries running three weeks out. Real, but NOT the near-dated wall, and the model had no way
   * to know that: measured 2026-08-20 at spot 7641.16 the aggregate read 7800 (+158.8) while the
   * front expiry alone read 7700 (+58.8). `walls_by_horizon` is what answers a DTE-specific
   * question.
   */
  call_wall: number | null;
  put_wall: number | null;
  /**
   * Walls cut by DTE horizon, cumulative (0DTE subset of 3DTE subset of 7DTE), gamma lens.
   *
   * Carried so an answer can NAME the scope it is quoting instead of implying a single wall
   * exists. A bucket with `expiries: 0` means no expiry in range — the live post-close state of
   * 0DTE — and must be reported as that, never as a missing wall.
   */
  walls_by_horizon: Array<{
    label: string;
    expiries: number;
    call_wall: number | null;
    put_wall: number | null;
    call_wall_pts: number | null;
    put_wall_pts: number | null;
  }> | null;
  max_pain: number | null;
  gex_king_strike: number | null;
  net_gex: number | null;
  net_vex: number | null;
  /**
   * VANNA WALLS — the vex analogue of call_wall/put_wall.
   *
   * These were the one summary scalar family the projection dropped, and the omission was not
   * harmless. Asked "Where are SPX vanna walls?" on prod (2026-08-20) Largo answered that vanna
   * walls "don't appear as discrete strikes in the live feed the way gamma walls do; vanna is a
   * distributed effect across the matrix rather than a concentrated barrier at one level" — a
   * confident structural claim, stated as market fact, about data the heatmap was publishing at
   * that exact moment (pos_wall 7900, neg_wall 7625).
   *
   * That is worse than an "I don't have that": a member reads it as "the platform does not compute
   * this", when it does and it is on their heatmap. Missing input became a fabricated NEGATIVE.
   */
  vex_pos_wall: number | null;
  vex_neg_wall: number | null;
  vex_flip: number | null;
  net_dex: number | null;
  net_charm: number | null;
  gamma_regime_read: string | null;
  vanna_regime_read: string | null;
  dex_regime_read: string | null;
  charm_regime_read: string | null;
  nearest_wall: { strike: number; kind: "resistance" | "support"; distance_pts: number } | null;
  distance_to_flip_pct: number | null;
  shift_summary: string | null;
  /**
   * WHEN — the three facts a bare `asof` cannot carry.
   *
   * `asof` is a UTC ISO of the MATRIX COMPUTE, and it was the only time signal on this payload.
   * Two things go wrong with that alone. A UTC instant rolls its calendar date at 20:00 ET, so a
   * session derived from it is a full session ahead for the last four hours of every trading day
   * (#2418 / #2420). And the compute age is not the PRICE age: measured 2026-08-22, this tool would
   * have served MSFT from a matrix 6,040 seconds old, `spot: 483.49` — a 16:00 ET close — with
   * nothing in the payload saying the market was shut.
   *
   * `get_thermal_compare` and `get_helix_thermal_compare` already carry all of this and say so in
   * their descriptions; these two reads were the outliers. Same derivation, shared helper.
   */
  as_of_et: string | null;
  session_date: string | null;
  market_session: MarketPhase | null;
  /** Age of the matrix COMPUTATION in seconds — not of the price it models. Null when unusable. */
  matrix_age_sec: number | null;
  /** Always 'cached': this is a cache read, never a fresh upstream fetch. */
  freshness: "cached";
  /** Polygon vs UW divergence on primary levels — same chip Thermal UI shows. */
  cross_validation?: {
    divergence?: number | null;
    callWallMatch?: boolean;
    putWallMatch?: boolean;
    flipMatch?: boolean;
  } | null;
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

type GexHeatmapFetch = Awaited<ReturnType<typeof fetchGexHeatmap>>;

/** Compact Thermal matrix read for Largo — canonical cache, not a second upstream. */
export async function gexHeatmapForLargo(
  ticker: string,
  opts?: { lens?: GexHeatmapLargoLens; top_strikes?: number; heatmap?: GexHeatmapFetch | null }
): Promise<GexHeatmapForLargo> {
  const sym = String(ticker ?? "").trim().toUpperCase();
  const lens = opts?.lens ?? "gex";
  const topN = Math.min(24, Math.max(4, opts?.top_strikes ?? 12));

  // ONE instant for the whole payload — phase, session date and the age must describe the same
  // moment, or a read assembled across 15:59:59 -> 16:00:01 reports OPEN beside post-close levels.
  const nowMs = Date.now();
  const unavailableFacts = etSessionFacts(new Date(nowMs));

  const hm =
    opts && "heatmap" in opts
      ? (opts.heatmap ?? null)
      : await fetchGexHeatmap(sym).catch(() => null);
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
      flip_reason: undefined,
      call_wall: null,
      walls_by_horizon: null,
      put_wall: null,
      max_pain: null,
      gex_king_strike: null,
      net_gex: null,
      net_vex: null,
      vex_pos_wall: null,
      vex_neg_wall: null,
      vex_flip: null,
      net_dex: null,
      net_charm: null,
      gamma_regime_read: null,
      vanna_regime_read: null,
      dex_regime_read: null,
      charm_regime_read: null,
      nearest_wall: null,
      distance_to_flip_pct: null,
      shift_summary: null,
      // Session facts are stamped even when the matrix is cold: "no data for this ticker" and
      // "the market is shut" are different statements, and nulls for both cannot tell them apart.
      as_of_et: unavailableFacts.as_of_et,
      session_date: unavailableFacts.session_date,
      market_session: unavailableFacts.market_session,
      matrix_age_sec: null,
      freshness: "cached",
      cross_validation: null,
      source: "polygon",
    };
  }

  const crossValidation = pos?.gex_cross_validation
    ? {
        divergence: pos.gex_cross_validation.divergence ?? null,
        callWallMatch: pos.gex_cross_validation.callWallMatch,
        putWallMatch: pos.gex_cross_validation.putWallMatch,
        flipMatch: pos.gex_cross_validation.flipMatch,
      }
    : null;

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
    flip_reason: hm.gex?.flip === null ? hm.gex?.flip_reason : undefined,
    call_wall: pos?.call_wall ?? hm.gex?.call_wall ?? null,
    put_wall: pos?.put_wall ?? hm.gex?.put_wall ?? null,
    walls_by_horizon:
      hm.gex?.walls_by_horizon?.map((h) => ({
        label: h.label,
        expiries: h.expiries.length,
        call_wall: h.callWall,
        put_wall: h.putWall,
        call_wall_pts: h.callWallPts,
        put_wall_pts: h.putWallPts,
      })) ?? null,
    max_pain: pos?.max_pain ?? hm.max_pain ?? null,
    gex_king_strike: pos?.gex_king_strike ?? null,
    net_gex: pos?.net_gex ?? hm.gex?.total ?? null,
    net_vex: pos?.net_vex ?? hm.vex?.total ?? null,
    vex_pos_wall: hm.vex?.pos_wall ?? null,
    vex_neg_wall: hm.vex?.neg_wall ?? null,
    vex_flip: hm.vex?.flip ?? null,
    net_dex: pos?.net_dex ?? hm.dex?.total ?? null,
    net_charm: pos?.net_charm ?? hm.charm?.total ?? null,
    gamma_regime_read: stripEmbeddedLevel(pos?.gamma_regime_read ?? hm.gex?.regime?.read),
    vanna_regime_read: pos?.vanna_regime_read ?? hm.vex?.regime?.read ?? null,
    dex_regime_read: pos?.dex_regime_read ?? hm.dex?.regime?.read ?? null,
    charm_regime_read: pos?.charm_regime_read ?? hm.charm?.regime?.read ?? null,
    nearest_wall: pos?.nearest_wall ?? null,
    distance_to_flip_pct: pos?.distance_to_flip_pct ?? null,
    shift_summary: pos?.shift_summary ?? hm.shift?.summary ?? null,
    as_of_et: unavailableFacts.as_of_et,
    session_date: unavailableFacts.session_date,
    market_session: unavailableFacts.market_session,
    matrix_age_sec: ageSecondsFromIso(hm.asof ?? null, nowMs),
    freshness: "cached",
    cross_validation: crossValidation,
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
