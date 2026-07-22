"use client";

import clsx from "clsx";
import type { GexShiftLeader } from "@/lib/gex-shift-leaders";
import { fmtHeatmapStrike } from "@/lib/gex-heatmap-display";
import { wallStrengthShift } from "@/features/thermal/lib/gex-heatmap/shift-math";

type Props = {
  leader: GexShiftLeader;
  /** Shift window length (ms) — for tooltip. */
  sinceMs?: number;
};

function fmtElapsed(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "session";
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function fmtPct(pct: number): string {
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(0)}%`;
}

/**
 * Inline intraday shift % pill — top call (bead yellow) / put (bead purple) shift leaders in matrix
 * cells. Side is the strike's OWN gamma dominance (sign of its net GEX), and built/melted + the %
 * are magnitude-based (wallStrengthShift), so a building put wall reads "built +X%" (purple), never
 * the inverted "melted" the raw-delta convention produced.
 */
export function GexMatrixShiftBadge({ leader, sinceMs }: Props) {
  const strength = wallStrengthShift(leader.currentValue, leader.delta);
  if (!strength) return null;
  // Colour by the strike's own side (net-GEX sign), not the delta direction — a melting put wall
  // (net GEX rising toward zero, delta > 0) is still a PUT strike and must stay purple.
  const isCall = leader.currentValue >= 0;
  const { pct, built } = strength;

  return (
    <span
      className={clsx(
        "gex-matrix-shift-badge",
        isCall ? "gex-matrix-shift-badge--call" : "gex-matrix-shift-badge--put"
      )}
      title={`${fmtHeatmapStrike(leader.strike)} · ${built ? "built" : "melted"} intraday ${fmtPct(pct)}${
        sinceMs != null ? ` vs ${fmtElapsed(sinceMs)} ago` : ""
      }`}
    >
      {fmtPct(pct)}
    </span>
  );
}
