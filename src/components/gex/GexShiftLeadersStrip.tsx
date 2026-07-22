"use client";

import clsx from "clsx";
import type { GexShiftLeader } from "@/lib/gex-shift-leaders";
import { fmtHeatmapStrike } from "@/lib/gex-heatmap-display";
import { wallStrengthShift } from "@/features/thermal/lib/gex-heatmap/shift-math";

type Props = {
  leaders: readonly GexShiftLeader[];
  scopeLabel?: string;
  className?: string;
  compact?: boolean;
};

function fmtPct(pct: number | null): string {
  if (pct == null || !Number.isFinite(pct)) return "—";
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(0)}%`;
}

/** Magnitude-based shift % for a leader — built (+) / melted (−) of the wall's own strength. */
function strengthPct(l: GexShiftLeader): number | null {
  return wallStrengthShift(l.currentValue, l.delta)?.pct ?? null;
}

/**
 * Top call + put wall-shift leaders — one strip across desk surfaces. Side is the strike's OWN
 * gamma dominance (net-GEX sign) and the % is magnitude-based (built +, melted −), so a building
 * put wall reads "+X%" under P (not the inverted "−X%" the raw signed-delta convention produced).
 */
export function GexShiftLeadersStrip({ leaders, scopeLabel, className, compact }: Props) {
  if (!leaders.length) return null;

  const calls = leaders.filter((l) => l.currentValue >= 0);
  const puts = leaders.filter((l) => l.currentValue < 0);

  return (
    <div
      className={clsx(
        "flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-white/10 bg-black/30 px-2 py-1 text-[11px]",
        className
      )}
      aria-label="GEX shift leaders"
    >
      {scopeLabel ? (
        <span className="shrink-0 rounded bg-white/5 px-1.5 py-0.5 font-medium uppercase tracking-wide text-sky-300/70">
          {scopeLabel}
        </span>
      ) : null}
      <span className="text-sky-300/50">{compact ? "Shift" : "Intraday shift"}</span>
      {calls.length > 0 ? (
        <span className="inline-flex flex-wrap items-center gap-1">
          <span className="text-emerald-400/90">C</span>
          {calls.map((l) => (
            <span key={`c-${l.strike}`} className="text-emerald-300/95">
              {fmtHeatmapStrike(l.strike)} {fmtPct(strengthPct(l))}
            </span>
          ))}
        </span>
      ) : null}
      {puts.length > 0 ? (
        <span className="inline-flex flex-wrap items-center gap-1">
          <span className="text-fuchsia-400/90">P</span>
          {puts.map((l) => (
            <span key={`p-${l.strike}`} className="text-fuchsia-300/95">
              {fmtHeatmapStrike(l.strike)} {fmtPct(strengthPct(l))}
            </span>
          ))}
        </span>
      ) : null}
    </div>
  );
}
