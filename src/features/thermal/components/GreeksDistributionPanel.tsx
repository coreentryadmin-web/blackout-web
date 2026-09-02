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
  ticker,
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

      {/* Top 5 strikes by exposure */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Top 5 Strikes</h3>
        <div className="space-y-2">
          {top5.map((bucket) => (
            <div key={bucket.strike} className="space-y-1">
              <div className="flex items-center justify-between text-sm">
                <span className="font-mono text-gray-600 dark:text-gray-400">
                  {bucket.strike.toFixed(0)}
                </span>
                <div className="flex items-center gap-2">
                  <span
                    className={clsx(
                      "text-xs font-semibold",
                      bucket.isConcentration ? "text-orange-600 dark:text-orange-400" : "text-gray-600 dark:text-gray-400"
                    )}
                  >
                    {bucket.pctOfTotal.toFixed(1)}%
                  </span>
                  {bucket.rank === 1 && <Badge tone="accent" size="sm">Peak</Badge>}
                </div>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-sm bg-gray-100 dark:bg-gray-800">
                <div
                  className={clsx(
                    "h-full transition-all",
                    bucket.isConcentration
                      ? "bg-orange-500 dark:bg-orange-600"
                      : "bg-blue-500 dark:bg-blue-600"
                  )}
                  style={{ width: `${(bucket.absGamma / maxGamma) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Risk assessment */}
      <div className="space-y-3 border-t border-gray-200 pt-4 dark:border-gray-800">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Risk Assessment</h3>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-md bg-gray-50 p-2 dark:bg-gray-900">
            <div className="text-xs text-gray-500 dark:text-gray-400">Clusters</div>
            <div className="mt-1 font-semibold text-gray-900 dark:text-gray-100">
              {analysis.clusterCount}
            </div>
          </div>
          <div className="rounded-md bg-gray-50 p-2 dark:bg-gray-900">
            <div className="text-xs text-gray-500 dark:text-gray-400">Spread</div>
            <div className="mt-1 font-semibold text-gray-900 dark:text-gray-100">
              {analysis.exposureSpread.toFixed(0)}%
            </div>
          </div>
          <div className="rounded-md bg-gray-50 p-2 dark:bg-gray-900">
            <div className="text-xs text-gray-500 dark:text-gray-400">Max Gap</div>
            <div className="mt-1 font-semibold text-gray-900 dark:text-gray-100">
              {analysis.maxGap.toFixed(1)}
            </div>
          </div>
          <div className="rounded-md bg-gray-50 p-2 dark:bg-gray-900">
            <div className="text-xs text-gray-500 dark:text-gray-400">Total Strikes</div>
            <div className="mt-1 font-semibold text-gray-900 dark:text-gray-100">
              {analysis.buckets.length}
            </div>
          </div>
        </div>
      </div>

      {/* Insights */}
      <div className="space-y-2 border-t border-gray-200 pt-4 dark:border-gray-800">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Insights</h3>
        <ul className="space-y-1 text-xs text-gray-600 dark:text-gray-400">
          {analysis.concentrationStrikes.length > 0 && (
            <li className="flex items-start gap-2">
              <span className="mt-1 inline-block h-1.5 w-1.5 rounded-full bg-orange-500" />
              <span>Concentration risk at {analysis.concentrationStrikes.join(", ")}</span>
            </li>
          )}
          {analysis.maxGap > 10 && (
            <li className="flex items-start gap-2">
              <span className="mt-1 inline-block h-1.5 w-1.5 rounded-full bg-yellow-500" />
              <span>Large gap in exposure ({analysis.maxGap.toFixed(0)} points)</span>
            </li>
          )}
          {analysis.clusterCount > 2 && (
            <li className="flex items-start gap-2">
              <span className="mt-1 inline-block h-1.5 w-1.5 rounded-full bg-blue-500" />
              <span>Multiple distinct gamma clusters detected</span>
            </li>
          )}
          {analysis.exposureSpread > 80 && (
            <li className="flex items-start gap-2">
              <span className="mt-1 inline-block h-1.5 w-1.5 rounded-full bg-purple-500" />
              <span>High exposure variance among top strikes</span>
            </li>
          )}
          {analysis.concentrationStrikes.length === 0 &&
            analysis.maxGap <= 10 &&
            analysis.clusterCount <= 2 &&
            analysis.exposureSpread <= 80 && (
              <li className="flex items-start gap-2">
                <span className="mt-1 inline-block h-1.5 w-1.5 rounded-full bg-green-500" />
                <span>Exposure well-distributed with no concentration risk</span>
              </li>
            )}
        </ul>
      </div>
    </Panel>
  );
}
