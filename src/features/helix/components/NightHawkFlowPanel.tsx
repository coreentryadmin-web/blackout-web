"use client";

import { motion, AnimatePresence } from "framer-motion";
import { usePulse } from "@/lib/usePulse";
import { clsx } from "clsx";
import { fmtPremium } from "@/lib/api";
import {
  thesisAgreementCopy,
  type DirectionRead,
  type ThesisAgreement,
} from "@/features/helix/lib/helix-direction-read";
import type { PlaybookPlay } from "@/features/nighthawk/lib/types";

export type FlowConviction = "strong" | "moderate" | "weak" | "none";

export type NightHawkPlayWithFlow = PlaybookPlay & {
  flowData: {
    callPremium: number;
    putPremium: number;
    totalPremium: number;
    topPrint: number;
    printCount: number;
    /** True ONLY for evidenced agreement. Kept for callers that want the yes/no. */
    flowAgreement: boolean;
    /** The four-way verdict. `false` used to mean two different things — "the tape points the
     *  other way" and "the tape cannot be read" — and rendered as one line. Those are opposite
     *  messages to someone deciding whether to take this trade. */
    flowThesis: ThesisAgreement;
    /** The read the verdict came from, so the copy can say how much premium backed it. */
    flowRead: DirectionRead;
    conviction: FlowConviction;
  };
};

const CONVICTION_STYLE: Record<FlowConviction, { label: string; cls: string }> = {
  strong:   { label: "STRONG",   cls: "text-emerald-400 border-emerald-700/50 bg-emerald-950/30" },
  moderate: { label: "MODERATE", cls: "text-gold       border-gold/50         bg-gold/15" },
  weak:     { label: "WEAK",     cls: "text-sky-300    border-white/15        bg-white/[0.06]" },
  none:     { label: "NO DATA",  cls: "text-cyan-400    border-white/10        bg-[#08080e]/40" },
};

export function NightHawkFlowPanel({
  plays,
  editionFor,
  scopedTicker,
  onTickerClick,
}: {
  plays: NightHawkPlayWithFlow[];
  editionFor?: string | null;
  /** When set, panel stays visible even with zero matching plays (ticker-scoped desk). */
  scopedTicker?: string;
  onTickerClick?: (ticker: string) => void;
}) {
  // Hoisted above the early return (Rules of Hooks). Static for reduced-motion users.
  const pulse = usePulse({ opacity: [1, 0.4, 1] }, { repeat: Infinity, duration: 3, ease: "easeInOut" });
  if (plays.length === 0) {
    return (
      <div className="flow-panel helix-pro-rail-panel">
        <div className="flow-panel-header">
          <span className="flow-panel-title">Hawk Conviction</span>
          {editionFor && (
            <span className="font-mono text-[10px] text-indigo-400">{editionFor}</span>
          )}
        </div>
        <div className="flow-panel-body py-6 text-center">
          <p className="font-mono text-[11px] text-indigo-300/80">
            {scopedTicker ? `No Night Hawk play for ${scopedTicker}` : "No Night Hawk plays this session"}
          </p>
          <p className="font-mono text-[10px] text-sky-300/55 mt-1">
            {scopedTicker ? "Clear the ticker filter to see the full playbook." : "Plays appear once the evening playbook is generated."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flow-panel">
      <div className="flow-panel-header">
        <div className="flex items-center gap-2">
          <motion.span
            {...pulse}
            className="font-mono text-[10px] text-indigo-400"
          >
            ◈
          </motion.span>
          <span className="flow-panel-title">Hawk Conviction</span>
        </div>
        {editionFor && (
          <span className="font-mono text-[10px] text-indigo-400">
            {editionFor}
          </span>
        )}
      </div>

      <div className="flow-panel-body space-y-2">
        <AnimatePresence initial={false}>
          {plays.map((play, i) => {
            const { flowData } = play;
            const { label: cvLabel, cls: cvCls } = CONVICTION_STYLE[flowData.conviction];
            const isLong = play.direction?.toLowerCase().includes("long") ||
                           play.direction?.toLowerCase().includes("bull");
            const callPct = flowData.totalPremium > 0
              ? Math.round((flowData.callPremium / flowData.totalPremium) * 100)
              : 0;

            return (
              <motion.div
                key={play.ticker}
                layout="position"
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.97 }}
                transition={{ delay: i * 0.05, type: "spring", damping: 22, stiffness: 300 }}
                onClick={() => onTickerClick?.(play.ticker)}
                role={onTickerClick ? "button" : undefined}
                tabIndex={onTickerClick ? 0 : undefined}
                aria-label={onTickerClick ? `Open ${play.ticker} detail` : undefined}
                onKeyDown={
                  onTickerClick
                    ? (e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onTickerClick(play.ticker);
                        }
                      }
                    : undefined
                }
                className="rounded-xl border border-indigo-900/25 bg-gradient-to-br from-indigo-950/10 to-[#08080e]/40 px-3 py-2.5 cursor-pointer hover:border-indigo-700/35 transition-colors"
                style={{ boxShadow: "inset 0 0 16px rgba(99,102,241,0.04)" }}
              >
                {/* Row 1 */}
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded border text-indigo-400 border-indigo-700/40 bg-indigo-950/30"
                      style={{ letterSpacing: "0.06em" }}>
                      #{play.rank} HAWK
                    </span>
                    <span className="font-mono text-[15px] font-extrabold text-indigo-200 tracking-wider">
                      {play.ticker}
                    </span>
                    <span className={clsx(
                      "font-mono text-[10px] font-bold px-1.5 py-0.5 rounded-full border",
                      isLong ? "text-emerald-400 border-emerald-800/50 bg-emerald-950/30"
                             : "text-rose-400 border-rose-800/50 bg-rose-950/30"
                    )}>
                      {isLong ? "▲ LONG" : "▼ SHORT"}
                    </span>
                  </div>
                  <span className={clsx(
                    "font-mono text-[10px] font-bold px-2 py-0.5 rounded-full border",
                    cvCls
                  )}>
                    {cvLabel}
                  </span>
                </div>

                {/* Row 2: flow stats */}
                {flowData.totalPremium > 0 ? (
                  <>
                    {/* Call/put bar */}
                    <div className="relative h-1.5 rounded-full overflow-hidden bg-[#0b0e16] mb-1.5">
                      <motion.div
                        className="h-full rounded-l-full"
                        style={{ background: "linear-gradient(90deg, #0f9d58, #a3e635)", width: `${callPct}%` }}
                        initial={{ width: 0 }}
                        animate={{ width: `${callPct}%` }}
                        transition={{ duration: 0.8, ease: [0.34, 1.56, 0.64, 1] }}
                      />
                      <div className="absolute inset-y-0 right-0 rounded-r-full"
                        style={{ background: "linear-gradient(90deg, #9f1239, #f43f5e)", width: `${100 - callPct}%` }} />
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[11px] text-sky-300">
                        {flowData.printCount} prints · top {fmtPremium(flowData.topPrint)}
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[12px] font-bold text-bull">
                          {callPct}% C
                        </span>
                        <span className="font-mono text-[12px] font-bold text-bear-text">
                          {100 - callPct}% P
                        </span>
                        <span className="font-mono text-[13px] font-bold tabular-nums text-sky-300">
                          {fmtPremium(flowData.totalPremium)}
                        </span>
                      </div>
                    </div>
                    {/* Four states, one line each. The old code had two branches for four facts,
                        so "could not read the tape" printed as "the tape diverges" — a fabricated
                        disagreement, and the exact mirror of the fabricated agreement above it. */}
                    {(() => {
                      const c = thesisAgreementCopy(flowData.flowThesis, Boolean(isLong), flowData.flowRead);
                      return (
                        <p
                          className={clsx(
                            "font-mono text-[10px] mt-1",
                            c.tone === "bull"
                              ? "text-bull"
                              : c.tone === "bear"
                                ? "text-gold"
                                : c.tone === "warn"
                                  ? "text-sky-300"
                                  : "text-sky-300/60"
                          )}
                        >
                          {c.text}
                        </p>
                      );
                    })()}
                  </>
                ) : (
                  <p className="font-mono text-[11px] text-cyan-400 mt-1">
                    No flow prints found in 7d window
                  </p>
                )}
              </motion.div>
            );
          })}
        </AnimatePresence>

        <p className="font-mono text-[10px] text-sky-300/70 text-center pt-1">
          Flow conviction from 7d tape · strong = $2M+ with the tape measurably aligned
        </p>
      </div>
    </div>
  );
}
