"use client";

import { useMemo } from "react";
import { Panel, Badge, EmptyState } from "@/components/ui";
import { PanelLabel } from "@/features/thermal/lib/gex-heatmap/primitives";
import { analyzeThetaDistribution } from "@/features/thermal/lib/gex-heatmap/theta-distribution";
import type { GexCells } from "@/features/thermal/lib/gex-heatmap/per-expiry-levels";
import { clsx } from "clsx";

interface ThetaDistributionPanelProps {
  cells: GexCells | null;
  spot: number | null;
}

export function ThetaDistributionPanel({
  cells,
  spot,
}: ThetaDistributionPanelProps) {
  const analysis = useMemo(() => {
    if (!cells || !spot) return null;
    return analyzeThetaDistribution(cells, spot, 0.03);
  }, [cells, spot]);

  if (!analysis || analysis.buckets.length === 0) {
    return (
      <Panel>
        <PanelLabel>Theta Distribution</PanelLabel>
        <EmptyState title="No time-decay data available" />
      </Panel>
    );
  }

  const top5 = [...analysis.buckets].sort((a, b) => b.absCharm - a.absCharm).slice(0, 5);
  const maxCharm = Math.max(...top5.map((b) => b.absCharm));

  return (
    <Panel className="space-y-6">
      <div className="flex items-center justify-between">
        <PanelLabel>Theta Distribution</PanelLabel>
        <div className="flex gap-2">
          {analysis.pinBias !== "neutral" && (
            <Badge
              tone={analysis.pinBias === "up" ? "bull" : "bear"}
              size="sm"
            >
              Pin {analysis.pinBias === "up" ? "↑" : "↓"}
            </Badge>
          )}
          {analysis.concentrationStrikes.length > 0 && (
            <Badge tone="bear" size="sm">
              {analysis.concentrationStrikes.length} concentration
            </Badge>
          )}
          {analysis.maxGap > 5 && (
            <Badge tone="neutral" size="sm">
              Gap: {analysis.maxGap.toFixed(0)}
            </Badge>
          )}
        </div>
      </div>

      <div className="space-y-3">
        <h3 className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-sky-300">
          Top 5 Strikes
        </h3>
        <div className="space-y-2">
          {top5.map((bucket) => (
            <div key={bucket.strike} className="space-y-1">
              <div className="flex items-center justify-between font-mono text-[11px]">
                <span className="tabular-nums text-sky-300">{bucket.strike.toFixed(0)}</span>
                <div className="flex items-center gap-2">
                  <span
                    className={clsx(
                      "text-xs font-semibold tabular-nums",
                      bucket.isConcentration ? "text-cyan-400" : "text-sky-300"
                    )}
                  >
                    {bucket.charmSign > 0 ? "+" : ""}{bucket.pctOfTotal.toFixed(1)}%
                  </span>
                  {bucket.rank === 1 && <Badge className="text-xs">Peak</Badge>}
                </div>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-sm border border-white/10 bg-white/[0.04]">
                <div
                  className={clsx(
                    "h-full transition-all",
                    bucket.charmSign > 0
                      ? "bg-cyan-400/80"
                      : bucket.charmSign < 0
                        ? "bg-red-500/70"
                        : "bg-sky-400/70"
                  )}
                  style={{ width: `${(bucket.absCharm / maxCharm) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-3 border-t border-white/10 pt-4">
        <h3 className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-sky-300">
          Premium Decay Profile
        </h3>
        <div className="grid grid-cols-2 gap-3 font-mono text-[11px]">
          <div className="rounded-md border border-white/10 bg-white/[0.03] p-2">
            <div className="text-[9px] uppercase tracking-[0.16em] text-sky-300/70">Pin Bias</div>
            <div className="mt-1 font-semibold tabular-nums text-white capitalize">
              {analysis.pinBias}
            </div>
          </div>
          <div className="rounded-md border border-white/10 bg-white/[0.03] p-2">
            <div className="text-[9px] uppercase tracking-[0.16em] text-sky-300/70">Pin Strength</div>
            <div className="mt-1 font-semibold tabular-nums text-white">
              {(
                (Math.abs(analysis.netCharm) / analysis.totalAbsCharm) *
                100
              ).toFixed(0)}
              %
            </div>
          </div>
          <div className="rounded-md border border-white/10 bg-white/[0.03] p-2">
            <div className="text-[9px] uppercase tracking-[0.16em] text-sky-300/70">Clusters</div>
            <div className="mt-1 font-semibold tabular-nums text-white">
              {analysis.clusterCount}
            </div>
          </div>
          <div className="rounded-md border border-white/10 bg-white/[0.03] p-2">
            <div className="text-[9px] uppercase tracking-[0.16em] text-sky-300/70">Max Gap</div>
            <div className="mt-1 font-semibold tabular-nums text-white">
              {analysis.maxGap.toFixed(1)}
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-2 border-t border-white/10 pt-4">
        <h3 className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-sky-300">
          Decay Insights
        </h3>
        <ul className="space-y-1 text-[11px] leading-relaxed text-sky-300/80">
          {analysis.pinUpStrikes.length > 0 && (
            <li className="flex items-start gap-2">
              <span className="mt-1 inline-block h-1.5 w-1.5 rounded-full bg-cyan-400" />
              <span>Positive decay pins up at {analysis.pinUpStrikes.slice(0, 2).join(", ")}</span>
            </li>
          )}
          {analysis.pinDownStrikes.length > 0 && (
            <li className="flex items-start gap-2">
              <span className="mt-1 inline-block h-1.5 w-1.5 rounded-full bg-red-500/70" />
              <span>Negative decay drags down at {analysis.pinDownStrikes.slice(0, 2).join(", ")}</span>
            </li>
          )}
          {analysis.concentrationStrikes.length > 0 && (
            <li className="flex items-start gap-2">
              <span className="mt-1 inline-block h-1.5 w-1.5 rounded-full bg-sky-300" />
              <span>Theta concentration at {analysis.concentrationStrikes.slice(0, 2).join(", ")}</span>
            </li>
          )}
          {analysis.maxGap > 10 && (
            <li className="flex items-start gap-2">
              <span className="mt-1 inline-block h-1.5 w-1.5 rounded-full bg-sky-400" />
              <span>Large gap in decay ({analysis.maxGap.toFixed(0)} points)</span>
            </li>
          )}
          {analysis.pinBias === "neutral" &&
            analysis.concentrationStrikes.length === 0 &&
            analysis.maxGap <= 10 && (
              <li className="flex items-start gap-2">
                <span className="mt-1 inline-block h-1.5 w-1.5 rounded-full bg-cyan-300" />
                <span>Decay balanced across strikes — premium distributed evenly</span>
              </li>
            )}
        </ul>
      </div>
    </Panel>
  );
}
