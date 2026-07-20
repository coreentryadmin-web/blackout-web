import { shiftPercentForStrike } from "@/features/thermal/lib/gex-heatmap/shift-math";

export type GexShiftLeader = {
  strike: number;
  side: "call" | "put";
  delta: number;
  pct: number | null;
  currentValue: number;
};

export type GexShiftLike = {
  available?: boolean;
  delta_by_strike?: Record<string, number>;
};

/**
 * Top N call-side (positive Δ) and put-side (negative Δ) intraday drift leaders.
 * Shared by Thermal, SPX matrix rail, and Vector terminal chrome.
 */
export function pickGexShiftLeaders(
  strikeTotals: Record<string, number> | null | undefined,
  shift: GexShiftLike | null | undefined,
  opts?: { perSide?: number }
): GexShiftLeader[] {
  const perSide = opts?.perSide ?? 3;
  const totals = strikeTotals ?? {};
  if (!shift?.available || !shift.delta_by_strike) return [];

  const rows: Array<{ strike: number; delta: number; current: number }> = [];
  for (const [key, delta] of Object.entries(shift.delta_by_strike)) {
    if (delta == null || !Number.isFinite(delta) || delta === 0) continue;
    const strike = Number(key);
    if (!Number.isFinite(strike)) continue;
    rows.push({ strike, delta, current: totals[key] ?? 0 });
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
