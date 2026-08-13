import { shiftPercentForStrike } from "@/features/thermal/lib/gex-heatmap/shift-math";
import type { GexHeatmapLens } from "@/lib/gex-heatmap-display";
import { matrixShiftDeltaForStrikeScoped, sumMetricCellsForExpiries } from "@/lib/gex-shift-scope";

export type GexShiftLeader = {
  strike: number;
  side: "call" | "put";
  delta: number;
  pct: number | null;
  currentValue: number;
};

export type GexShiftLike = {
  available?: boolean;
  status?: string;
  delta_by_strike?: Record<string, number>;
  /** Baseline matrix cells at shift window start — enables per-DTE scoped DR%. */
  baseline_cells?: Record<string, Record<string, number>>;
  since_ms?: number;
};

/**
 * Per-strike Δ for matrix DR% labels. Reads `delta_by_strike` even when `available` is false —
 * the route preserves that map off-hours (summary/flip/wall narrative stripped) so the Strike
 * column can show last-session build/melt % without implying live migration.
 */
export function matrixShiftDeltaForStrike(
  shift: GexShiftLike | null | undefined,
  strike: number,
): number | undefined {
  const d = shift?.delta_by_strike?.[String(strike)];
  return d != null && Number.isFinite(d) ? d : undefined;
}

/**
 * Off-hours presentation gate: force `available:false` and strip present-tense narrative fields
 * (summary, flip_migration, wall_changes) while keeping the cached per-strike delta map for
 * matrix DR% display.
 */
export function gateShiftOffHours(shift: GexShiftLike | null | undefined): GexShiftLike {
  if (!shift) return { available: false, status: "collecting" };
  const deltas = shift.delta_by_strike;
  const hasDeltas = deltas != null && Object.keys(deltas).length > 0;
  const baselineCells = shift.baseline_cells;
  const hasBaselineCells = baselineCells != null && Object.keys(baselineCells).length > 0;
  return {
    available: false,
    status: "collecting",
    ...(hasDeltas ? { delta_by_strike: deltas, since_ms: shift.since_ms } : {}),
    ...(hasBaselineCells ? { baseline_cells: baselineCells } : {}),
  };
}

/** Per-lens shift block on the shared gex-heatmap payload. */
export type MatrixShiftPayload = {
  shift?: GexShiftLike | null;
  vex_shift?: GexShiftLike | null;
  dex_shift?: GexShiftLike | null;
  charm_shift?: GexShiftLike | null;
};

/** Resolve intraday migration for the active matrix lens (GEX/VEX/DEX/CHARM). */
export function matrixShiftForLens(
  lens: GexHeatmapLens,
  payload: MatrixShiftPayload | null | undefined
): GexShiftLike | null | undefined {
  if (!payload) return null;
  switch (lens) {
    case "gex":
      return payload.shift;
    case "vex":
      return payload.vex_shift;
    case "dex":
      return payload.dex_shift;
    case "charm":
      return payload.charm_shift;
    default:
      return null;
  }
}

export function matrixShiftSinceMs(
  lens: GexHeatmapLens,
  payload: MatrixShiftPayload | null | undefined
): number | undefined {
  return matrixShiftForLens(lens, payload)?.since_ms;
}

export type PickGexShiftLeadersOpts = {
  perSide?: number;
  /** When set with `cells`, leaders rank scoped Δ (matches matrix DR% / King scope). */
  cells?: Record<string, Record<string, number>>;
  selectedExpiries?: string[] | null;
};

/**
 * Top N call-side (positive Δ) and put-side (negative Δ) intraday drift leaders.
 * Shared by Thermal, SPX matrix rail, and Vector terminal chrome.
 */
export function pickGexShiftLeaders(
  strikeTotals: Record<string, number> | null | undefined,
  shift: GexShiftLike | null | undefined,
  opts?: PickGexShiftLeadersOpts
): GexShiftLeader[] {
  const perSide = opts?.perSide ?? 3;
  const totals = strikeTotals ?? {};
  if (!shift?.delta_by_strike) return [];

  const rows: Array<{ strike: number; delta: number; current: number }> = [];
  const useScoped = opts?.cells != null && opts.selectedExpiries != null && opts.selectedExpiries.length > 0;
  const strikeKeys = useScoped
    ? new Set(
        Object.keys(opts.cells!)
          .map(Number)
          .filter(Number.isFinite),
      )
    : new Set(Object.keys(shift.delta_by_strike).map(Number));

  for (const strike of strikeKeys) {
    const key = String(strike);
    const delta = useScoped
      ? matrixShiftDeltaForStrikeScoped({
          shift,
          cells: opts!.cells!,
          selectedExpiries: opts!.selectedExpiries!,
          strike,
        })
      : matrixShiftDeltaForStrike(shift, strike);
    if (delta == null || !Number.isFinite(delta) || delta === 0) continue;
    const current = useScoped
      ? sumMetricCellsForExpiries(opts!.cells![key], opts!.selectedExpiries!)
      : totals[key] ?? 0;
    rows.push({ strike, delta, current: current ?? 0 });
  }

  const calls = rows
    .filter((r) => r.delta > 0)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, perSide);
  const puts = rows
    .filter((r) => r.delta < 0)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, perSide);

  const toLeader = (r: { strike: number; delta: number; current: number }, side: "call" | "put"): GexShiftLeader => ({
    strike: r.strike,
    side,
    delta: r.delta,
    pct: shiftPercentForStrike(r.current, r.delta),
    currentValue: r.current,
  });

  return [...calls.map((c) => toLeader(c, "call")), ...puts.map((p) => toLeader(p, "put"))];
}

export function gexMatrixShiftCellKey(strike: number, expiry: string): string {
  return `${strike}:${expiry}`;
}

/**
 * Map matrix cell → shift leader for inline % badges (top 3 call + top 3 put).
 * Each leader badge lands on the expiry column where that strike has max |cell GEX|.
 */
export function pickGexShiftLeaderCells(
  strikeTotals: Record<string, number> | null | undefined,
  cells: Record<string, Record<string, number>>,
  expiries: readonly string[],
  shift: GexShiftLike | null | undefined,
  opts?: PickGexShiftLeadersOpts
): Map<string, GexShiftLeader> {
  const totals = strikeTotals ?? {};
  const columnExpiries =
    opts?.selectedExpiries != null && opts.selectedExpiries.length > 0
      ? expiries.filter((e) => opts.selectedExpiries!.includes(e))
      : expiries;
  const leaders = pickGexShiftLeaders(totals, shift, { ...opts, cells, selectedExpiries: opts?.selectedExpiries });
  const out = new Map<string, GexShiftLeader>();
  for (const leader of leaders) {
    const row = cells[String(leader.strike)];
    if (!row) continue;
    let bestExp: string | null = null;
    let bestMag = 0;
    for (const e of columnExpiries) {
      const v = row[e];
      if (typeof v !== "number" || !Number.isFinite(v) || v === 0) continue;
      const mag = Math.abs(v);
      if (mag > bestMag) {
        bestMag = mag;
        bestExp = e;
      }
    }
    if (bestExp == null) {
      bestExp = columnExpiries.find((e) => {
        const v = row[e];
        return typeof v === "number" && Number.isFinite(v);
      }) ?? null;
    }
    if (bestExp != null) {
      out.set(gexMatrixShiftCellKey(leader.strike, bestExp), leader);
    }
  }
  return out;
}
