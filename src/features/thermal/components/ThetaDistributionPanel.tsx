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
  ticker: string;
}

export function ThetaDistributionPanel({
  cells,
  spot,
  ticker,
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

  const top5 = analysis.buckets.sort((a, b) => b.absCharm - a.absCharm).slice(0, 5);
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

      {/* Top 5 strikes by theta exposure */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
          Top 5 Strikes
        </h3>
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
                      bucket.charmSign > 0
                        ? "text-green-600 dark:text-green-400"
                        : bucket.charmSign < 0
                          ? "text-red-600 dark:text-red-400"
                          : "text-gray-600 dark:text-gray-400"
                    )}
                  >
                    {bucket.charmSign > 0 ? "+" : ""}{bucket.pctOfTotal.toFixed(1)}%
                  </span>
                  {bucket.rank === 1 && <Badge tone="accent" size="sm">Peak</Badge>}
                </div>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-sm bg-gray-100 dark:bg-gray-800">
                <div
                  className={clsx(
                    "h-full transition-all",
                    bucket.charmSign > 0
                      ? "bg-green-500 dark:bg-green-600"
                      : bucket.charmSign < 0
                        ? "bg-red-500 dark:bg-red-600"
                        : "bg-gray-400 dark:bg-gray-600"
                  )}
                  style={{ width: `${(bucket.absCharm / maxCharm) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Premium decay profile */}
      <div className="space-y-3 border-t border-gray-200 pt-4 dark:border-gray-800">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
          Premium Decay Profile
        </h3>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-md bg-gray-50 p-2 dark:bg-gray-900">
            <div className="text-xs text-gray-500 dark:text-gray-400">Pin Bias</div>
            <div className="mt-1 font-semibold text-gray-900 dark:text-gray-100 capitalize">
              {analysis.pinBias}
            </div>
          </div>
          <div className="rounded-md bg-gray-50 p-2 dark:bg-gray-900">
            <div className="text-xs text-gray-500 dark:text-gray-400">Pin Strength</div>
            <div className="mt-1 font-semibold text-gray-900 dark:text-gray-100">
              {(
                (Math.abs(analysis.netCharm) / analysis.totalAbsCharm) *
                100
              ).toFixed(0)}
              %
            </div>
          </div>
          <div className="rounded-md bg-gray-50 p-2 dark:bg-gray-900">
            <div className="text-xs text-gray-500 dark:text-gray-400">Clusters</div>
            <div className="mt-1 font-semibold text-gray-900 dark:text-gray-100">
              {analysis.clusterCount}
            </div>
          </div>
          <div className="rounded-md bg-gray-50 p-2 dark:bg-gray-900">
            <div className="text-xs text-gray-500 dark:text-gray-400">Max Gap</div>
            <div className="mt-1 font-semibold text-gray-900 dark:text-gray-100">
              {analysis.maxGap.toFixed(1)}
            </div>
          </div>
        </div>
      </div>

      {/* Decay insights */}
      <div className="space-y-2 border-t border-gray-200 pt-4 dark:border-gray-800">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
          Decay Insights
        </h3>
        <ul className="space-y-1 text-xs text-gray-600 dark:text-gray-400">
          {analysis.pinUpStrikes.length > 0 && (
            <li className="flex items-start gap-2">
              <span className="mt-1 inline-block h-1.5 w-1.5 rounded-full bg-green-500" />
              <span>Positive decay pins up at {analysis.pinUpStrikes.slice(0, 2).join(", ")}</span>
            </li>
          )}
          {analysis.pinDownStrikes.length > 0 && (
            <li className="flex items-start gap-2">
              <span className="mt-1 inline-block h-1.5 w-1.5 rounded-full bg-red-500" />
              <span>Negative decay drags down at {analysis.pinDownStrikes.slice(0, 2).join(", ")}</span>
            </li>
          )}
          {analysis.concentrationStrikes.length > 0 && (
            <li className="flex items-start gap-2">
              <span className="mt-1 inline-block h-1.5 w-1.5 rounded-full bg-orange-500" />
              <span>Theta concentration at {analysis.concentrationStrikes.slice(0, 2).join(", ")}</span>
            </li>
          )}
          {analysis.maxGap > 10 && (
            <li className="flex items-start gap-2">
              <span className="mt-1 inline-block h-1.5 w-1.5 rounded-full bg-yellow-500" />
              <span>Large gap in decay ({analysis.maxGap.toFixed(0)} points)</span>
            </li>
          )}
          {analysis.pinBias === "neutral" &&
            analysis.concentrationStrikes.length === 0 &&
            analysis.maxGap <= 10 && (
              <li className="flex items-start gap-2">
                <span className="mt-1 inline-block h-1.5 w-1.5 rounded-full bg-blue-500" />
                <span>Decay balanced across strikes — premium distributed evenly</span>
              </li>
            )}
        </ul>
      </div>
    </Panel>
  );
}
