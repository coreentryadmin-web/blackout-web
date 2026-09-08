"use client";

import { motion, AnimatePresence } from "framer-motion";
import { usePulse } from "@/lib/usePulse";
import { fmtPremium } from "@/lib/api";
import { SignalCoverageNote } from "@/features/helix/components/SignalCoverageNote";
import type { SignalEligibility } from "@/features/helix/lib/helix-signal-detection";

export type VelocityEntry = {
  ticker: string;
  recent: number;       // prints in last 15 min
  prior: number;        // prints in prior 15 min (15–30 min ago)
  ratio: number;        // acceleration multiplier
  recentPremium: number;
};

/**
 * How many spikes the radar RENDERS. Named, and exported, because the cap and the disclosure of
 * the cap have to move together — the defect was a bare `slice(0, 8)` at the call site with a
 * header that reported `entries.length` as the population.
 */
export const VELOCITY_RADAR_DISPLAY_LIMIT = 8;

export function VelocityRadar({
  entries,
  onTickerClick,
  eligibility,
  totalSpikes,
}: {
  entries: VelocityEntry[];
  onTickerClick?: (ticker: string) => void;
  /** The denominator these entries were computed over. Optional so an existing caller keeps
   *  working; when supplied and part of the tape was unscannable, the panel says so. */
  eligibility?: SignalEligibility;
  /**
   * How many spikes the detector actually found, BEFORE the caller's display cap.
   *
   * The header renders a COUNT — `{entries.length} spikes` — so a capped list does not read as a
   * truncated view, it reads as a MEASUREMENT: "there were 8". MEASURED against the live tape
   * (2026-08-21 RTH, replayed at 5-minute steps): the caller's `slice(0, 8)` binds in **11.3% of
   * non-empty windows, with up to 14 spikes rendered as "8"**. And it is internally inconsistent —
   * `velocitySpikeTickers` is built from the FULL list, so the tape badges more tickers than the
   * radar says exist.
   *
   * Optional so existing callers keep working, and only shown when it exceeds what was rendered:
   * "8 of 14" on an uncapped window would be noise.
   */
  totalSpikes?: number;
}) {
  // Hoisted above the early return (Rules of Hooks). Static for reduced-motion users.
  const pulse = usePulse({ opacity: [1, 0.2, 1] }, { repeat: Infinity, duration: 1.4, ease: "easeInOut" });
  if (entries.length === 0) {
    return (
      <div className="flow-panel">
        <div className="flow-panel-header">
          <span className="flow-panel-title">Velocity Radar</span>
        </div>
        <div className="flow-panel-body py-6 text-center">
          <p className="font-mono text-[11px] text-orange-300/70">No velocity spikes this session</p>
          <p className="font-mono text-[10px] text-sky-300/55 mt-1">≥3× acceleration vs prior 15 min window</p>
          {/* The threshold above reads as "we scanned and nothing cleared it". Say what was
              actually scanned, or a never-scanned name looks like a quiet one. */}
          {eligibility ? <SignalCoverageNote eligibility={eligibility} /> : null}
        </div>
      </div>
    );
  }

  // "8 of 14", never a bare "8", whenever the caller's display cap dropped spikes. A count that
  // silently omits its remainder reads as the whole population — the "no silent caps" rule.
  const capped = totalSpikes != null && totalSpikes > entries.length;

  const maxRatio = Math.max(...entries.map((e) => e.ratio), 1);

  return (
    <div className="flow-panel">
      <div className="flow-panel-header">
        <div className="flex items-center gap-2">
          <motion.span
            {...pulse}
            className="font-mono text-[10px] text-orange-400"
          >
            ◉
          </motion.span>
          <span className="flow-panel-title">Velocity Radar</span>
        </div>
        <span
          className="font-mono text-[10px] text-orange-600/60 tabular-nums"
          title={
            capped
              ? `${totalSpikes} tickers cleared the velocity threshold; the ${entries.length} strongest are shown.`
              : undefined
          }
        >
          {capped ? `${entries.length} of ${totalSpikes}` : entries.length} spike
          {(capped ? totalSpikes : entries.length) !== 1 ? "s" : ""} · 15min
        </span>
      </div>

      <div
        className="flow-panel-body space-y-2"
        role="log"
        aria-live="polite"
        aria-label="Velocity spike radar"
      >
        <AnimatePresence initial={false}>
          {entries.map((e, i) => {
            const barPct = Math.min(100, (e.ratio / maxRatio) * 100);
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
                className="rounded-xl border border-orange-900/30 bg-gradient-to-br from-orange-950/15 to-[#08080e]/50 px-3 py-2.5 cursor-pointer hover:border-orange-700/40 transition-colors"
                style={{ boxShadow: "inset 0 0 18px rgba(251,146,60,0.04)" }}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span
                      className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded border animate-pulse"
                      style={{
                        color: "#fb923c",
                        borderColor: "rgba(251,146,60,0.4)",
                        background: "rgba(251,146,60,0.1)",
                        letterSpacing: "0.06em",
                      }}
                    >
                      SPIKE
                    </span>
                    <span className="font-mono text-[15px] font-extrabold text-orange-300 tracking-wider">
                      {e.ticker}
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="font-mono text-base font-black tabular-nums text-orange-300">
                      {e.ratio.toFixed(1)}×
                    </span>
                  </div>
                </div>

                {/* Velocity bar */}
                <div className="relative h-1.5 rounded-full overflow-hidden bg-[#0b0e16] mb-2">
                  <motion.div
                    className="h-full rounded-full"
                    style={{ background: "linear-gradient(90deg, #92400e, #fb923c)" }}
                    initial={{ width: 0 }}
                    animate={{ width: `${barPct}%` }}
                    transition={{ duration: 0.7, ease: [0.34, 1.56, 0.64, 1] as const }}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <span className="font-mono text-[11px] text-sky-300">
                    {e.recent} prints last 15m · {e.prior} prior
                  </span>
                  <span className="font-mono text-xs font-bold tabular-nums text-orange-300">
                    {fmtPremium(e.recentPremium)}
                  </span>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>

        <div className="text-center pt-1">
          <p className="font-mono text-[10px] text-sky-300/70">
            ≥3× acceleration vs prior 15 min window · min 2 prints
          </p>
          {/* Also shown when spikes DID fire: a member seeing two names still cannot tell that the
              largest names on the tape were never eligible to be among them. */}
          {eligibility ? <SignalCoverageNote eligibility={eligibility} /> : null}
        </div>
      </div>
    </div>
  );
}
