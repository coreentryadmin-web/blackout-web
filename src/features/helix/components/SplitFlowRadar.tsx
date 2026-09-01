"use client";

import { motion, AnimatePresence } from "framer-motion";
import { usePulse } from "@/lib/usePulse";
import { clsx } from "clsx";
import { fmtPremium } from "@/lib/api";
import { Panel } from "@/components/ui";
import { SignalCoverageNote } from "@/features/helix/components/SignalCoverageNote";
import type { SignalEligibility } from "@/features/helix/lib/helix-signal-detection";

// Re-exported, not re-declared. This component previously kept its OWN copy of the shape, which is
// how it kept rendering a `direction` the detector had stopped meaning — a duplicated type is a
// second reader of one definition, the same failure this lane has now fixed five times.
export type { SplitFlowEntry } from "@/features/helix/lib/helix-signal-detection";
import type { SplitFlowEntry } from "@/features/helix/lib/helix-signal-detection";

export function SplitFlowRadar({
  entries,
  onTickerClick,
  eligibility,
}: {
  entries: SplitFlowEntry[];
  onTickerClick?: (ticker: string) => void;
  /** The denominator these entries were computed over — see SignalCoverageNote. Optional so an
   *  existing caller keeps working. */
  eligibility?: SignalEligibility;
}) {
  // Hoisted above the early return (Rules of Hooks). Static for reduced-motion users.
  const pulse = usePulse({ opacity: [1, 0.3, 1] }, { repeat: Infinity, duration: 2, ease: "easeInOut" });
  if (entries.length === 0) {
    return (
      <Panel
        accent="sky"
        bodyClassName="!px-4 !py-3.5"
        header={
          <div className="flex items-center gap-2 border-b border-white/10 px-5 py-4 md:px-6">
            <h3 className="t-label text-[15px] uppercase leading-tight text-white">Split Flow Radar</h3>
          </div>
        }
      >
        <div className="flow-panel-body py-6 text-center">
          <p className="font-mono text-[11px] text-gold/70">No split-flow tickers this session</p>
          <p className="font-mono text-[10px] text-sky-300/55 mt-1">Needs both call and put flow in the last 30 min</p>
          {/* Naming only the threshold implies the tape was scanned and came up quiet. */}
          {eligibility ? <SignalCoverageNote eligibility={eligibility} /> : null}
        </div>
      </Panel>
    );
  }

  return (
    <Panel
      accent="sky"
      bodyClassName="!px-4 !py-3.5"
      header={
        <div className="flex items-center justify-between gap-4 border-b border-white/10 px-5 py-4 md:px-6">
          <div className="flex items-center gap-2">
            <motion.span {...pulse} className="font-mono text-[10px] text-gold">
              ◈
            </motion.span>
            <h3 className="t-label text-[15px] uppercase leading-tight text-white">Split Flow Radar</h3>
          </div>
          <span className="font-mono text-[10px] text-gold/60 tabular-nums">
            {entries.length} ticker{entries.length !== 1 ? "s" : ""} · 30min
          </span>
        </div>
      }
    >
      {/* Body */}
      <div
        className="flow-panel-body space-y-2"
        role="log"
        aria-live="polite"
        aria-label="Split flow radar"
      >
        <AnimatePresence initial={false}>
          {entries.map((e, i) => {
            const isBull = e.direction === "bullish";
            const isBear = e.direction === "bearish";
            return (
              <motion.div
                key={e.ticker}
                layout="position"
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.97 }}
                transition={{ delay: i * 0.04, type: "spring", damping: 22, stiffness: 300 }}
                onClick={() => onTickerClick?.(e.ticker)}
                role={onTickerClick ? "button" : undefined}
                tabIndex={onTickerClick ? 0 : undefined}
                aria-label={onTickerClick ? `Open ${e.ticker} detail` : undefined}
                onKeyDown={
                  onTickerClick
                    ? (ev) => {
                        if (ev.key === "Enter" || ev.key === " ") {
                          ev.preventDefault();
                          onTickerClick(e.ticker);
                        }
                      }
                    : undefined
                }
                className={clsx(
                  "rounded-xl border px-3 py-2.5 transition-colors",
                  onTickerClick && "cursor-pointer hover:border-gold/50",
                  "border-gold/25 bg-gradient-to-br from-gold/10 to-[rgba(8,9,14,0.4)]"
                )}
                style={{ boxShadow: "inset 0 0 20px rgba(255,210,63,0.04)" }}
              >
                {/* Row 1: ticker + direction badge */}
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span
                      className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded border"
                      style={{
                        color: "#ffd23f",
                        borderColor: "rgba(255,210,63,0.35)",
                        background: "rgba(255,210,63,0.08)",
                        letterSpacing: "0.08em",
                      }}
                    >
                      SPLIT
                    </span>
                    <span className="font-mono text-[15px] font-extrabold text-gold tracking-wider">
                      {e.ticker}
                    </span>
                  </div>
                  <span
                    className={clsx(
                      "font-mono text-[10px] font-bold px-2 py-0.5 rounded-full border",
                      isBull
                        ? "text-bull border-bull/40 bg-bull/12"
                        : isBear
                          ? "text-bear border-bear/40 bg-bear/12"
                          : "text-sky-300 border-sky-300/20 bg-sky-300/[0.06]"
                    )}
                  >
                    {/* The value no longer means "more call premium than put premium" — it means
                        what the flow says about the UNDERLYING, from option type × aggressor side.
                        "CALL BIAS" would now be actively wrong: a bullish read can come entirely
                        from SOLD PUTS, with no call buying at all. */}
                    {isBull
                      ? "▲ BULLISH"
                      : isBear
                        ? "▼ BEARISH"
                        : e.direction === "mixed"
                          ? "⇋ MIXED"
                          : "— UNREAD"}
                  </span>
                </div>

                {/* Row 2: call/put bar */}
                <div className="relative h-2 rounded-full overflow-hidden bg-white/[0.06] flex mb-2">
                  <motion.div
                    className="h-full rounded-l-full"
                    style={{
                      background: "linear-gradient(90deg, #0f9d58, #a3e635)",
                      width: `${e.callPct}%`,
                    }}
                    initial={{ width: 0 }}
                    animate={{ width: `${e.callPct}%` }}
                    transition={{ duration: 0.9, ease: [0.34, 1.56, 0.64, 1] as const }}
                  />
                  <motion.div
                    className="h-full rounded-r-full flex-1"
                    style={{
                      background: "linear-gradient(90deg, #b3203f, #ff2d55)",
                      width: `${100 - e.callPct}%`,
                    }}
                    initial={{ width: 0 }}
                    animate={{ width: `${100 - e.callPct}%` }}
                    transition={{ duration: 0.9, ease: [0.34, 1.56, 0.64, 1] as const, delay: 0.05 }}
                  />
                  {/* Center marker */}
                  <div
                    className="absolute inset-y-0 w-px bg-white/25"
                    style={{ left: "50%" }}
                  />
                </div>

                {/* Row 3: premium breakdown */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-[10px] text-bull">
                      ▲ {fmtPremium(e.callPremium)} · {e.callPct}%
                    </span>
                    <span className="font-mono text-[10px] text-bear-text">
                      ▼ {fmtPremium(e.putPremium)} · {100 - e.callPct}%
                    </span>
                  </div>
                  <span className="font-mono text-[10px] text-cyan-400 tabular-nums">
                    {fmtPremium(e.total)}
                  </span>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>

        {/* Legend */}
        <div className="text-center pt-1">
          <p className="font-mono text-[10px] text-sky-300/70">
            Both call &amp; put ≥ $500K within 30 min window
          </p>
          {eligibility ? <SignalCoverageNote eligibility={eligibility} /> : null}
        </div>
      </div>
    </Panel>
  );
}
