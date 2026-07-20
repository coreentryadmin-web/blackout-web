"use client";

import { useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { clsx } from "clsx";
import type { FlowAlert } from "@/lib/api";
import {
  computeFlowStrikeStacks,
  flowStackSideLabel,
  fmtFlowPremShort,
} from "@/lib/largo/flow-strike-stacks";
import { Panel, Badge } from "@/components/ui";
import {
  formatHitsInWindow,
  HELIX_STRIKE_HITS_WINDOW_MIN,
  HELIX_TOP_STRIKES_LIMIT,
} from "@/features/helix/lib/helix-strike-leaders";
import { fmtExpiryShort } from "@/features/helix/lib/helix-flow-format";

const KIND_META = {
  repeated_and_stacked: { label: "REPEAT + STACK", cls: "flow-badge flow-badge-stack" },
  repeated_hits: { label: "REPEAT", cls: "flow-badge flow-badge-repeat" },
  same_strike_stack: { label: "STACKED", cls: "flow-badge flow-badge-block" },
} as const;

export function StrikeStackDetector({
  alerts,
  onSelectTicker,
}: {
  alerts: FlowAlert[];
  onSelectTicker?: (ticker: string) => void;
}) {
  const stacks = useMemo(
    () =>
      computeFlowStrikeStacks(alerts, {
        minAlerts: 2,
        limit: HELIX_TOP_STRIKES_LIMIT,
      }),
    [alerts]
  );

  return (
    <Panel
      accent="sky"
      kicker="Same contract · rolling window"
      title="Top Strikes"
      strip={false}
      className="helix-pro-rail-panel helix-top-strikes-panel"
      bodyClassName="!px-3 !py-2.5"
      actions={
        stacks.length > 0 ? (
          <Badge tone="neutral" size="sm">
            {stacks.length} active · {HELIX_STRIKE_HITS_WINDOW_MIN}m
          </Badge>
        ) : undefined
      }
    >
      <p className="mb-2 font-mono text-[10px] leading-snug text-sky-300/80">
        Which ticker, strike, and expiry is seeing repeated flow — and whether it&apos;s mostly bought or sold.
      </p>
      <div className="flow-panel-body">
        <AnimatePresence mode="sync">
          {stacks.length === 0 ? (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="py-4 text-center"
            >
              <p className="font-mono text-[10px] text-cyan-400">Tracking strike accumulation…</p>
            </motion.div>
          ) : (
            <div className="space-y-2">
              {stacks.map((stack, i) => {
                const isCall = stack.option_type === "CALL";
                const meta = KIND_META[stack.kind];
                const intensity = Math.min(stack.recent_hit_count / 5, 1);
                const side = flowStackSideLabel(stack.option_type, stack.avg_ask_pct);
                const magnitudePrem =
                  stack.recent_premium > 0 ? stack.recent_premium : stack.total_premium;
                const hitLine = formatHitsInWindow(
                  stack.recent_hit_count,
                  stack.hits_window_min
                );

                return (
                  <motion.button
                    key={`${stack.ticker}-${stack.strike}-${stack.option_type}-${stack.expiry}`}
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 6, transition: { duration: 0.15 } }}
                    transition={{ delay: i * 0.04, type: "spring", damping: 22, stiffness: 300 }}
                    type="button"
                    onClick={() => onSelectTicker?.(stack.ticker)}
                    className={clsx(
                      "helix-top-strike-row w-full text-left rounded-lg border px-3 py-2.5 transition-all duration-200",
                      "hover:scale-[1.01] active:scale-[0.99] motion-reduce:hover:scale-100 motion-reduce:active:scale-100",
                      isCall
                        ? "border-bull/40 bg-bull/[0.08] hover:bg-bull/[0.14] hover:border-bull/60"
                        : "border-bear/40 bg-bear/[0.08] hover:bg-bear/[0.14] hover:border-bear/60"
                    )}
                    style={{
                      boxShadow: `inset 0 0 ${20 * intensity}px ${isCall ? "rgba(0,230,118,0.07)" : "rgba(255,45,85,0.06)"}`,
                    }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-anton text-[22px] text-gold leading-none">{stack.ticker}</span>
                          <span className={clsx("flow-badge", isCall ? "flow-badge-call" : "flow-badge-put")}>
                            {stack.option_type}
                          </span>
                          <span className={meta.cls}>{meta.label}</span>
                        </div>
                        <p
                          className={clsx(
                            "mt-1 font-mono text-[10px] font-semibold uppercase tracking-wide",
                            side.side === "bought"
                              ? "text-bull"
                              : side.side === "sold"
                                ? "text-bear-text"
                                : "text-sky-300"
                          )}
                        >
                          {side.lean}
                        </p>
                      </div>
                      <span
                        className={clsx(
                          "font-mono text-[12px] font-bold tabular-nums flex-shrink-0",
                          isCall ? "text-bull" : "text-bear"
                        )}
                      >
                        {fmtFlowPremShort(magnitudePrem)}
                      </span>
                    </div>

                    <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[10px] uppercase tracking-wide text-sky-300/90">
                      <div>
                        <span className="text-sky-300/60">Strike </span>
                        <span className="font-bold tabular-nums text-[12px] text-gold">
                          {stack.strike}
                          {isCall ? "C" : "P"}
                        </span>
                      </div>
                      <div className="text-right sm:text-left">
                        <span className="text-sky-300/60">Expiry </span>
                        <span className="font-semibold text-[11px] text-white tabular-nums">
                          {fmtExpiryShort(stack.expiry)}
                        </span>
                      </div>
                    </div>

                    <p className="mt-1.5 font-mono text-[11px] text-cyan-300">
                      <span className="font-bold text-white">{hitLine}</span>
                      <span className="text-sky-300/70">
                        {" "}
                        · {fmtFlowPremShort(magnitudePrem)} in window
                        {stack.alert_count > stack.recent_hit_count
                          ? ` · ${stack.alert_count} total on tape`
                          : ""}
                      </span>
                    </p>
                  </motion.button>
                );
              })}
            </div>
          )}
        </AnimatePresence>
      </div>
    </Panel>
  );
}
