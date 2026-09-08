"use client";

import { useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { fmtPremium, type FlowAlert } from "@/lib/api";
import {
  readDirection,
  readDirectionTitle,
  directionTone,
  type DirectionRead,
} from "@/features/helix/lib/helix-direction-read";
import { barWidthPct, bucketMaxTotal } from "@/features/helix/components/ExpiryConcentration";
import { Panel } from "@/components/ui";

type StrikeBucket = {
  strike: number;
  callPremium: number;
  putPremium: number;
  total: number;
  count: number;
  direction: DirectionRead;
};

/** How many strikes render before the rest fold into an honest "+N more strikes" line — a
 *  liquid single name can print at 20+ distinct strikes in a session, and a profile that tries
 *  to show all of them stops being scannable. The CENTER of the distribution survives the cut,
 *  not just the top or bottom, since a profile's whole point is its shape across the price axis. */
const MAX_STRIKES_SHOWN = 12;

/**
 * Strike-level volume profile — premium concentration BY STRIKE PRICE, ordered along the price
 * axis (ascending), not by activity rank. That ordering is the entire difference from
 * StrikeStackDetector's "Top Strikes" panel, which already ranks strikes by repeated-hit
 * activity: this shows the SHAPE of where premium sits across the chain (a real profile), that
 * shows WHICH strikes are seeing coordinated repeat flow (a leaderboard). Different questions,
 * same underlying data — kept as two panels rather than merged, since collapsing "where is
 * premium concentrated" into "what's trending" would lose the one this doesn't already have.
 *
 * Ticker-scoped by construction: `alerts` is expected to already be filtered to one name (the
 * same `displayAlerts` HelixContextHeader receives when a ticker filter is active — FlowFeed.tsx
 * applies that filter upstream of every panel). Strike price only means something on a shared
 * axis for ONE underlying; $150 on AAPL and $150 on GME are unrelated levels, so this renders
 * nothing useful without that scoping and is placed beside HelixContextHeader in FlowFeed.tsx
 * for that reason, not rendered in the market-wide rail.
 */
export function StrikeVolumeProfile({ alerts, loading }: { alerts: FlowAlert[]; loading: boolean }) {
  const { buckets, shownCount, totalCount } = useMemo(() => {
    if (!alerts.length) return { buckets: [] as StrikeBucket[], shownCount: 0, totalCount: 0 };
    const map = new Map<
      number,
      { callPremium: number; putPremium: number; count: number; flows: FlowAlert[] }
    >();

    for (const a of alerts) {
      if (a.strike == null || !Number.isFinite(a.strike)) continue;
      const cur = map.get(a.strike) ?? { callPremium: 0, putPremium: 0, count: 0, flows: [] };
      if (a.option_type === "CALL") cur.callPremium += a.premium;
      else if (a.option_type === "PUT") cur.putPremium += a.premium;
      cur.count++;
      cur.flows.push(a);
      map.set(a.strike, cur);
    }

    const all = Array.from(map.entries())
      .map(([strike, { callPremium, putPremium, count, flows }]) => ({
        strike,
        callPremium,
        putPremium,
        total: callPremium + putPremium,
        count,
        direction: readDirection(flows),
      }))
      .sort((x, y) => x.strike - y.strike); // price-axis order, not activity rank

    if (all.length <= MAX_STRIKES_SHOWN) {
      return { buckets: all, shownCount: all.length, totalCount: all.length };
    }
    // Keep the CENTER of the distribution: drop the smallest-premium strikes at the extremes
    // first, not a blind head/tail slice, so a fat tail on one side doesn't silently amputate
    // the interesting shoulder on the other.
    const bySize = [...all].sort((x, y) => y.total - x.total).slice(0, MAX_STRIKES_SHOWN);
    const keep = new Set(bySize.map((b) => b.strike));
    const shown = all.filter((b) => keep.has(b.strike));
    return { buckets: shown, shownCount: shown.length, totalCount: all.length };
  }, [alerts]);

  if (loading || buckets.length === 0) return null;

  const maxTotal = bucketMaxTotal(buckets);
  const hiddenCount = totalCount - shownCount;

  return (
    <Panel accent="purple" kicker="⟐ strike axis" title="Strike Volume Profile" bodyClassName="space-y-1.5">
      <AnimatePresence initial={false}>
        {buckets.map((b, i) => {
          const barW = barWidthPct(b.total, maxTotal);
          const tone = directionTone(b.direction);
          const isBull = tone === "bull";
          const isBear = tone === "bear";
          const dirTitle = readDirectionTitle(b.direction);
          return (
            <motion.div
              key={b.strike}
              layout="position"
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0 }}
              transition={{ delay: i * 0.03, duration: 0.2 }}
              className="space-y-0.5"
              title={dirTitle}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[11px] font-bold tabular-nums text-purple-200 w-14">
                    {b.strike}
                  </span>
                  <span className="font-mono text-[9px] tabular-nums text-sky-300/60">{b.count}×</span>
                </div>
                <span
                  className="font-mono text-[11px] font-bold tabular-nums"
                  style={{ color: isBull ? "#a3e635" : isBear ? "#ff2d55" : "#c4b5fd" }}
                >
                  {fmtPremium(b.total)}
                </span>
              </div>
              <div className="relative h-1.5 rounded-full overflow-hidden bg-white/[0.06]">
                <motion.div
                  className="absolute inset-y-0 left-0 rounded-full"
                  style={{
                    background: isBull
                      ? "linear-gradient(90deg, #00b35a, #a3e635)"
                      : isBear
                        ? "linear-gradient(90deg, #b3203c, #ff2d55)"
                        : "linear-gradient(90deg, #7c3aed, #a78bfa)",
                    width: `${barW}%`,
                  }}
                  initial={{ width: 0 }}
                  animate={{ width: `${barW}%` }}
                  transition={{ duration: 0.6, ease: [0.34, 1.56, 0.64, 1] as const, delay: i * 0.03 }}
                />
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
      <p className="font-mono text-[10px] text-sky-300/70 text-center pt-1">
        {hiddenCount > 0
          ? `Premium by strike · ${shownCount} of ${totalCount} strikes shown (largest kept)`
          : "Premium by strike · call/put colored"}
      </p>
    </Panel>
  );
}
