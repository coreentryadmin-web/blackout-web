"use client";

import { useMemo } from "react";
import { clsx } from "clsx";
import type { FlowAlert } from "@/lib/api";
import { Panel } from "@/components/ui";
import { computeSessionFlowCorrelations } from "@/features/helix/lib/helix-session-correlation";

/** Time-lagged ticker pairs — leader print → follower within N minutes. */
export function SessionCorrelationMatrix({
  alerts,
  loading,
  onSelectTicker,
}: {
  alerts: FlowAlert[];
  loading?: boolean;
  onSelectTicker?: (ticker: string) => void;
}) {
  const pairs = useMemo(
    () => computeSessionFlowCorrelations(alerts, { maxPairs: 14 }),
    [alerts]
  );

  if (loading) return null;

  return (
    <Panel accent="purple" kicker="◇ patterns" title="Flow correlation" bodyClassName="space-y-1.5">
      {pairs.length === 0 ? (
        <p className="font-mono text-[11px] text-cyan-400 text-center py-4">
          Need 2+ readable-direction prints per ticker to compute pairs.
        </p>
      ) : (
        pairs.map((p) => {
          const pct = Math.round(p.rate * 100);
          const hot = pct >= 60;
          return (
            <button
              key={`${p.leader}-${p.follower}-${p.lagMin}`}
              type="button"
              onClick={() => onSelectTicker?.(p.follower)}
              className={clsx(
                "w-full text-left rounded-lg px-3 py-2 border transition-colors",
                hot
                  ? "border-purple/40 bg-purple/10 hover:bg-purple/15"
                  : "border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.04]"
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[11px] font-bold text-white">
                  {p.leader}
                  <span className="text-cyan-400 font-normal mx-1">→</span>
                  {p.follower}
                </span>
                <span className="font-mono text-[11px] font-bold tabular-nums text-sky-300">
                  {pct}%
                </span>
              </div>
              <p className="font-mono text-[10px] text-cyan-400 mt-0.5">
                {p.followerHits}/{p.leaderPrints} leader prints followed within {p.lagMin}m (same lean)
              </p>
            </button>
          );
        })
      )}
      <p className="font-mono text-[10px] text-sky-300/70 text-center pt-1">
        Same directional lean · 5/10/15 min lags · readable ask-side only
      </p>
    </Panel>
  );
}
