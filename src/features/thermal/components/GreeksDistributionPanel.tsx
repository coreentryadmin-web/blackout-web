"use client";

import { useMemo } from "react";
import { Panel, Badge, EmptyState } from "@/components/ui";
import { PanelLabel } from "@/features/thermal/lib/gex-heatmap/primitives";
import { analyzeGreeksDistribution } from "@/features/thermal/lib/gex-heatmap/greeks-distribution";
import type { GexCells } from "@/features/thermal/lib/gex-heatmap/per-expiry-levels";
import { clsx } from "clsx";

interface GreeksDistributionPanelProps {
  cells: GexCells | null;
  spot: number | null;
  ticker: string;
}

export function GreeksDistributionPanel({
  cells,
  spot,
  ticker: _ticker,
}: GreeksDistributionPanelProps) {
  const analysis = useMemo(() => {
    if (!cells || !spot) return null;
    return analyzeGreeksDistribution(cells, spot, 0.03);
  }, [cells, spot]);

  if (!analysis || analysis.buckets.length === 0) {
    return (
      <Panel>
        <PanelLabel>Greeks Distribution</PanelLabel>
        <EmptyState title="No exposure data available" />
      </Panel>
    );
  }

  const top5 = analysis.buckets.sort((a, b) => b.absGamma - a.absGamma).slice(0, 5);
  const maxGamma = Math.max(...top5.map((b) => b.absGamma));

  return (
    <Panel className="space-y-6">
      <div className="flex items-center justify-between">
        <PanelLabel>Greeks Distribution</PanelLabel>
        <div className="flex gap-2">
          {analysis.concentrationStrikes.length > 0 && (
            <Badge tone="accent" className="text-xs">
              {analysis.concentrationStrikes.length} concentration
            </Badge>
          )}
          {analysis.maxGap > 5 && (
            <Badge tone="neutral" className="text-xs">
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
                    {bucket.pctOfTotal.toFixed(1)}%
                  </span>
                  {bucket.rank === 1 && <Badge className="text-xs">Peak</Badge>}
                </div>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-sm border border-white/10 bg-white/[0.04]">
                <div
                  className={clsx(
                    "h-full transition-all",
                    bucket.isConcentration ? "bg-cyan-400/80" : "bg-sky-400/70"
                  )}
                  style={{ width: `${(bucket.absGamma / maxGamma) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-3 border-t border-white/10 pt-4">
        <h3 className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-sky-300">
          Risk Assessment
        </h3>
        <div className="grid grid-cols-2 gap-3 font-mono text-[11px]">
          <div className="rounded-md border border-white/10 bg-white/[0.03] p-2">
            <div className="text-[9px] uppercase tracking-[0.16em] text-sky-300/70">Clusters</div>
            <div className="mt-1 font-semibold tabular-nums text-white">{analysis.clusterCount}</div>
          </div>
          <div className="rounded-md border border-white/10 bg-white/[0.03] p-2">
            <div className="text-[9px] uppercase tracking-[0.16em] text-sky-300/70">Spread</div>
            <div className="mt-1 font-semibold tabular-nums text-white">
              {analysis.exposureSpread.toFixed(0)}%
            </div>
          </div>
          <div className="rounded-md border border-white/10 bg-white/[0.03] p-2">
            <div className="text-[9px] uppercase tracking-[0.16em] text-sky-300/70">Max Gap</div>
            <div className="mt-1 font-semibold tabular-nums text-white">
              {analysis.maxGap.toFixed(1)}
            </div>
          </div>
          <div className="rounded-md border border-white/10 bg-white/[0.03] p-2">
            <div className="text-[9px] uppercase tracking-[0.16em] text-sky-300/70">Total Strikes</div>
            <div className="mt-1 font-semibold tabular-nums text-white">{analysis.buckets.length}</div>
          </div>
        </div>
      </div>

      <div className="space-y-2 border-t border-white/10 pt-4">
        <h3 className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-sky-300">
          Insights
        </h3>
        <ul className="space-y-1 text-[11px] leading-relaxed text-sky-300/80">
          {analysis.concentrationStrikes.length > 0 && (
            <li className="flex items-start gap-2">
              <span className="mt-1 inline-block h-1.5 w-1.5 rounded-full bg-cyan-400" />
              <span>Concentration risk at {analysis.concentrationStrikes.join(", ")}</span>
            </li>
          )}
          {analysis.maxGap > 10 && (
            <li className="flex items-start gap-2">
              <span className="mt-1 inline-block h-1.5 w-1.5 rounded-full bg-sky-300" />
              <span>Large gap in exposure ({analysis.maxGap.toFixed(0)} points)</span>
            </li>
          )}
          {analysis.clusterCount > 2 && (
            <li className="flex items-start gap-2">
              <span className="mt-1 inline-block h-1.5 w-1.5 rounded-full bg-sky-400" />
              <span>Multiple distinct gamma clusters detected</span>
            </li>
          )}
          {analysis.exposureSpread > 80 && (
            <li className="flex items-start gap-2">
              <span className="mt-1 inline-block h-1.5 w-1.5 rounded-full bg-cyan-300" />
              <span>High exposure variance among top strikes</span>
            </li>
          )}
          {analysis.concentrationStrikes.length === 0 &&
            analysis.maxGap <= 10 &&
            analysis.clusterCount <= 2 &&
            analysis.exposureSpread <= 80 && (
              <li className="flex items-start gap-2">
                <span className="mt-1 inline-block h-1.5 w-1.5 rounded-full bg-cyan-400" />
                <span>Exposure well-distributed with no concentration risk</span>
              </li>
            )}
        </ul>
      </div>
    </Panel>
  );
}
