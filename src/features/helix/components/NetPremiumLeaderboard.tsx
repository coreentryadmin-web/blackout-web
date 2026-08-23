"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import { clsx } from "clsx";
import type { FlowAlert } from "@/lib/api";
import { fmtPremium } from "@/lib/api";
import { Panel, Skeleton } from "@/components/ui";
import { HELIX_NET_PREMIUM_LEADERS_LIMIT } from "@/features/helix/lib/helix-strike-leaders";
import {
  directionTone,
  readDirection,
  readDirectionTitle,
  type DirectionRead,
} from "@/features/helix/lib/helix-direction-read";

type Row = {
  ticker: string;
  calls: number;
  puts: number;
  /** calls − puts. The panel's NAMED quantity; its definition is unchanged. */
  net: number;
  total: number;
  callPct: number | null;
  /** The aggression-aware read. `net`'s SIGN is arithmetic about call-vs-put premium; DIRECTION is
   *  a separate claim and now comes from here. Measured live 2026-08-23: 7 of the top 10 tickers
   *  disagree with the arrow the sign produced, SPX worst at 0.1% readable. */
  direction: DirectionRead;
};

export function NetPremiumLeaderboard({ alerts, loading = false }: { alerts: FlowAlert[]; loading?: boolean }) {
  const rows = useMemo<Row[]>(() => {
    const map = new Map<string, { calls: number; puts: number; flows: FlowAlert[] }>();
    for (const a of alerts) {
      const cur = map.get(a.ticker) ?? { calls: 0, puts: 0, flows: [] };
      if (a.option_type === "CALL") cur.calls += a.premium;
      else if (a.option_type === "PUT") cur.puts += a.premium;
      // gap-#6: UNKNOWN/typeless prints count toward neither side
      cur.flows.push(a);
      map.set(a.ticker, cur);
    }
    return Array.from(map.entries())
      .map(([ticker, { calls, puts, flows }]) => ({
        ticker,
        calls,
        puts,
        net: calls - puts,
        total: calls + puts,
        // `50` here would be a fabricated even split; a ticker with no premium has no share.
        callPct: calls + puts > 0 ? Math.round((calls / (calls + puts)) * 100) : null,
        direction: readDirection(flows),
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, HELIX_NET_PREMIUM_LEADERS_LIMIT);
  }, [alerts]);

  const maxTotal = rows[0]?.total ?? 1;

  return (
    <Panel
      accent="bull"
      title="Net Premium"
      strip={false}
      className="helix-pro-rail-panel"
      bodyClassName="!px-3 !py-2.5"
      actions={
        rows.length > 0 ? (
          <span className="font-mono text-[10px] text-sky-300 font-semibold">
            {fmtPremium(rows.reduce((s, r) => s + r.total, 0))} total
          </span>
        ) : undefined
      }
    >
      <div className="flow-panel-body space-y-3">
        {rows.length === 0 && loading ? (
          <div className="space-y-2 py-1">
            {[1, 2, 3].map((n) => (
              <Skeleton key={n} height={32} rounded="md" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="py-4 text-center">
            <p className="font-mono text-[10px] text-cyan-400">No net-premium leaders yet — quiet tape.</p>
          </div>
        ) : (
          rows.map((row, i) => {
            // The ARROW is a direction claim and now comes from the aggression-aware read; the
            // SIGN on `net` stays arithmetic about calls-minus-puts, which is what "Net Premium"
            // means and is not being redefined here. They can legitimately differ, and when they
            // do, that difference is the information — a big positive net built out of SOLD calls
            // is exactly the case the old green triangle hid.
            const tone = directionTone(row.direction);
            const netPositive = row.net >= 0;
            const barW = Math.round((row.total / maxTotal) * 100);
            const callBarW = Math.round((row.calls / row.total) * barW);
            const putBarW  = barW - callBarW;

            return (
              <motion.div
                key={row.ticker}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.04, type: "spring", damping: 24, stiffness: 300 }}
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className="helix-pro-rail-leader-ticker">{row.ticker}</span>
                    <span
                      className={clsx(
                        "font-mono text-[10px] font-bold tracking-wider",
                        tone === "bull" ? "text-bull" : tone === "bear" ? "text-bear-text" : "text-sky-300/70"
                      )}
                      title={readDirectionTitle(row.direction)}
                    >
                      {tone === "bull" ? "▲" : tone === "bear" ? "▼" : "◆"}{" "}
                      {row.callPct == null ? "—" : `${row.callPct}% calls`}
                    </span>
                  </div>
                  <span
                    className={clsx(
                      "font-mono text-[13px] font-bold tabular-nums",
                      netPositive ? "num-bull" : "num-bear"
                    )}
                    title={`Net premium = call premium minus put premium (${fmtPremium(
                      row.calls
                    )} − ${fmtPremium(row.puts)}). This is a call-vs-put figure, not a direction.`}
                  >
                    {netPositive ? "+" : ""}{fmtPremium(row.net)}
                  </span>
                </div>

                {/* Dual bar */}
                <div className="flow-leader-bar-track">
                  <div className="flex h-full">
                    {callBarW > 0 && (
                      <motion.div
                        className="flow-leader-bar-fill"
                        style={{ background: "linear-gradient(90deg, #0f9d58, #a3e635)", width: `${callBarW}%` }}
                        initial={{ width: 0 }}
                        animate={{ width: `${callBarW}%` }}
                        transition={{ duration: 0.6, delay: i * 0.06, ease: [0.34, 1.56, 0.64, 1] }}
                      />
                    )}
                    {putBarW > 0 && (
                      <motion.div
                        className="flow-leader-bar-fill"
                        style={{ background: "linear-gradient(90deg, #b3203f, #ff2d55)", width: `${putBarW}%` }}
                        initial={{ width: 0 }}
                        animate={{ width: `${putBarW}%` }}
                        transition={{ duration: 0.6, delay: i * 0.06 + 0.05, ease: [0.34, 1.56, 0.64, 1] }}
                      />
                    )}
                  </div>
                </div>
              </motion.div>
            );
          })
        )}
      </div>
    </Panel>
  );
}
