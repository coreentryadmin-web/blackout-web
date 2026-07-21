"use client";

import clsx from "clsx";
import type { GexShiftLeader } from "@/lib/gex-shift-leaders";
import { fmtHeatmapStrike } from "@/lib/gex-heatmap-display";

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
 * Inline intraday shift % pill — top-3 call (bead yellow) / put (bead purple) leaders in matrix cells.
 */
export function GexMatrixShiftBadge({ leader, sinceMs }: Props) {
  if (leader.pct == null || !Number.isFinite(leader.pct)) return null;
  const isCall = leader.side === "call";
  const built = leader.delta > 0;

  return (
    <span
      className={clsx(
        "gex-matrix-shift-badge",
        isCall ? "gex-matrix-shift-badge--call" : "gex-matrix-shift-badge--put"
      )}
      title={`${fmtHeatmapStrike(leader.strike)} · ${built ? "built" : "melted"} intraday ${fmtPct(leader.pct)}${
        sinceMs != null ? ` vs ${fmtElapsed(sinceMs)} ago` : ""
      }`}
    >
      {fmtPct(leader.pct)}
    </span>
  );
}
