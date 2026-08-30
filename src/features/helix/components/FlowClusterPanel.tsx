"use client";

import { useMemo, useState } from "react";
import { clsx } from "clsx";
import type { FlowAlert } from "@/lib/api";
import { fmtPremium } from "@/lib/api";
import { Panel } from "@/components/ui";
import {
  clusterFlowPrints,
  HELIX_FLOW_CLUSTER_MIN_SIZE,
} from "@/features/helix/lib/helix-flow-clusters";
import { fmtExpiryShort } from "@/features/helix/lib/helix-flow-format";
import { aggressorRead } from "@/features/helix/lib/helix-print-detail";

/** Coordinated multi-print campaigns — hides singleton noise by default. */
export function FlowClusterPanel({
  alerts,
  onSelectTicker,
}: {
  alerts: FlowAlert[];
  onSelectTicker?: (ticker: string) => void;
}) {
  const [minSize, setMinSize] = useState(HELIX_FLOW_CLUSTER_MIN_SIZE);
  const clusters = useMemo(
    () => clusterFlowPrints(alerts, { minSize, limit: 10 }),
    [alerts, minSize]
  );

  return (
    <Panel accent="gold" kicker="◇ clusters" title="Flow campaigns" bodyClassName="space-y-2">
      <div className="flex items-center justify-center gap-2 pb-1">
        {[2, 3, 4].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setMinSize(n)}
            className={clsx(
              "font-mono text-[10px] font-semibold px-2 py-1 rounded border",
              minSize === n
                ? "border-gold/60 text-gold bg-gold/10"
                : "border-white/10 text-cyan-400"
            )}
          >
            ≥{n} prints
          </button>
        ))}
      </div>
      {clusters.length === 0 ? (
        <p className="font-mono text-[11px] text-cyan-400 text-center py-3">
          No coordinated campaigns at this size — lower the cluster filter or widen the tape.
        </p>
      ) : (
        clusters.map((c) => {
          const aggr = aggressorRead(c.avgAskPct);
          const isCall = c.side === "call";
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => onSelectTicker?.(c.ticker)}
              className="w-full text-left rounded-lg px-3 py-2 border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.04] transition-colors"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[12px] font-bold text-white">{c.ticker}</span>
                <span
                  className={clsx(
                    "font-mono text-[12px] font-bold tabular-nums",
                    isCall ? "text-bull" : "text-bear-text"
                  )}
                >
                  {fmtPremium(c.totalPremium)}
                </span>
              </div>
              <p className="font-mono text-[10px] text-cyan-400 mt-0.5">
                {c.printCount} prints · {c.strike}
                {isCall ? "C" : "P"} · exp {fmtExpiryShort(c.expiry)}
                {aggr ? ` · ${aggr.label}` : ""}
              </p>
            </button>
          );
        })
      )}
      <p className="font-mono text-[10px] text-sky-300/70 text-center pt-1">
        Same ticker/side · nearby strikes · 5m window
      </p>
    </Panel>
  );
}
