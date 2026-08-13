/**
 * Member-facing gex-heatmap helpers — cache-reader discipline, compact compare payloads.
 * Keeps polygon-options-gex imports server-side in route handlers only.
 */

import {
  bandStrikesAroundSpot,
  resolveZeroDteExpiry,
} from "@/features/thermal/lib/thermal-compact-matrix";
import { todayEtYmd } from "@/lib/providers/spx-session";
import type { GexShiftLike } from "@/lib/gex-shift-leaders";

export type HeatmapLensBlock = {
  cells: Record<string, Record<string, number>>;
  call_wall?: number | null;
  put_wall?: number | null;
  pos_wall?: number | null;
  neg_wall?: number | null;
  flip?: number | null;
  zero_level?: number | null;
  total?: number;
};

export type HeatmapMemberPayload = {
  available: boolean;
  underlying?: string;
  spot?: number;
  change_pct?: number;
  asof?: string;
  expiries?: string[];
  strikes?: number[];
  near_term_expiries?: string[];
  gex?: HeatmapLensBlock;
  vex?: HeatmapLensBlock;
  dex?: HeatmapLensBlock;
  charm?: HeatmapLensBlock;
  shift?: GexShiftLike | null;
  vex_shift?: GexShiftLike | null;
  dex_shift?: GexShiftLike | null;
  charm_shift?: GexShiftLike | null;
};

const COMPARE_STRIKE_HALF = 36;

function filterLensBlock(
  block: HeatmapLensBlock | undefined,
  strikeSet: Set<string>,
  expiries: string[]
): HeatmapLensBlock | undefined {
  if (!block?.cells) return block;
  const cells: Record<string, Record<string, number>> = {};
  for (const strike of strikeSet) {
    const row = block.cells[strike];
    if (!row) continue;
    const next: Record<string, number> = {};
    for (const exp of expiries) {
      const v = row[exp];
      if (typeof v === "number" && Number.isFinite(v)) next[exp] = v;
    }
    if (Object.keys(next).length) cells[strike] = next;
  }
  return { ...block, cells };
}

/** Compare grid wire format — 0DTE column + strike band around spot; drops shift/overlays. */
export function compactHeatmapMemberPayload<T extends HeatmapMemberPayload>(
  payload: T,
  strikeHalf = COMPARE_STRIKE_HALF
): T {
  if (!payload.available || !payload.strikes?.length || !(payload.spot != null && payload.spot > 0)) {
    return payload;
  }
  const zeroDte = resolveZeroDteExpiry(
    payload.near_term_expiries,
    payload.expiries,
    todayEtYmd()
  );
  const expiries = zeroDte ? [zeroDte] : (payload.expiries?.slice(0, 1) ?? []);
  const strikes = bandStrikesAroundSpot(payload.strikes, payload.spot, strikeHalf);
  const strikeSet = new Set(strikes.map(String));

  return {
    ...payload,
    expiries,
    strikes,
    near_term_expiries: payload.near_term_expiries?.filter((e) => expiries.includes(e)),
    gex: filterLensBlock(payload.gex, strikeSet, expiries),
    vex: filterLensBlock(payload.vex, strikeSet, expiries),
    dex: filterLensBlock(payload.dex, strikeSet, expiries),
    charm: filterLensBlock(payload.charm, strikeSet, expiries),
  };
}

export function heatmapMemberUsable(payload: HeatmapMemberPayload | null | undefined): boolean {
  if (!payload?.available) return false;
  if (!(typeof payload.spot === "number" && payload.spot > 0)) return false;
  return (
    Array.isArray(payload.strikes) &&
    payload.strikes.length > 0 &&
    Array.isArray(payload.expiries) &&
    payload.expiries.length > 0
  );
}
