"use client";

import { useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { fmtPremium, type FlowAlert } from "@/lib/api";
import { Panel } from "@/components/ui";
import { summarizeExecutionQuality } from "@/features/helix/lib/helix-execution-quality";

/** Session rollup of ask-side execution quality — aggressive vs passive fills. */
export function ExecutionAnalysisPanel({
  alerts,
  loading,
}: {
  alerts: FlowAlert[];
  loading?: boolean;
}) {
  const entries = useMemo(() => summarizeExecutionQuality(alerts), [alerts]);
  const withAsk = useMemo(
    () => alerts.filter((a) => a.ask_pct != null && Number.isFinite(a.ask_pct)).length,
    [alerts]
  );
  const fillRate = alerts.length > 0 ? Math.round((withAsk / alerts.length) * 100) : 0;

  if (loading) return null;

  if (!entries.length) {
    return (
      <Panel accent="sky" kicker="◇ execution" title="Fill quality">
        <div className="flow-panel-body py-6 text-center">
          <p className="font-mono text-[11px] text-cyan-400">No prints this session</p>
        </div>
      </Panel>
    );
  }

  const maxPremium = entries[0]?.premium ?? 1;

  return (
    <Panel accent="sky" kicker="◇ execution" title="Fill quality" bodyClassName="space-y-2">
      <p className="font-mono text-[10px] text-cyan-400 text-center">
        Ask-side data on {fillRate}% of visible prints ({withAsk}/{alerts.length})
      </p>
      <AnimatePresence initial={false}>
        {entries.map((e, i) => {
          const barW = Math.max(6, (e.premium / maxPremium) * 100);
          return (
            <motion.div
              key={e.bucket}
              layout="position"
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0 }}
              transition={{ delay: i * 0.04, duration: 0.25 }}
              className="space-y-1"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[12px] font-bold tracking-wide" style={{ color: e.color }}>
                  {e.label}
                </span>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="font-mono text-[10px] tabular-nums text-cyan-400">{e.count} pr</span>
                  <span className="font-mono text-[10px] font-semibold tabular-nums text-sky-200/70">{e.pct}%</span>
                  <span className="font-mono text-[12px] font-bold tabular-nums text-white">{fmtPremium(e.premium)}</span>
                </div>
              </div>
              <div className="relative h-1.5 rounded-full overflow-hidden bg-white/[0.06]">
                <motion.div
                  className="absolute inset-y-0 left-0 rounded-full"
                  style={{ background: e.color, width: `${barW}%`, opacity: 0.75 }}
                  initial={{ width: 0 }}
                  animate={{ width: `${barW}%` }}
                  transition={{ duration: 0.6, ease: [0.34, 1.56, 0.64, 1], delay: i * 0.04 }}
                />
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
      <p className="font-mono text-[10px] text-sky-300/70 text-center pt-1">
        At ask = lifting offers · at bid = hitting bids
      </p>
    </Panel>
  );
}
