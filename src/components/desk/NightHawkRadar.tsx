"use client";

import { motion } from "framer-motion";
import { clsx } from "clsx";
import type { NightHawkPlay } from "@/lib/api";
import { DeskPanel } from "./DeskPanel";

export function NightHawkRadar({ plays, live }: { plays: NightHawkPlay[]; live?: boolean }) {
  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <DeskPanel title="Night Hawk Radar" subtitle="After-hours setups" variant="purple" live={live} glow className="lg:col-span-2">
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
          {plays.length === 0 ? (
            <p className="col-span-full text-grey-500 text-sm font-mono py-10 text-center">
              {live ? "Scanning for plays…" : "Engine offline"}
            </p>
          ) : (
            plays.map((play, i) => (
              <motion.div
                key={`${play.ticker}-${play.posted_at}`}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: i * 0.05 }}
                className="desk-nighthawk-card"
              >
                <div className="flex items-center justify-between mb-3">
                  <span className="font-anton text-2xl text-white">{play.ticker}</span>
                  <span
                    className={clsx(
                      "desk-nh-direction",
                      play.direction?.toLowerCase().includes("bull") ? "desk-nh-bull" : "desk-nh-bear"
                    )}
                  >
                    {play.direction}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center mb-3">
                  <MiniStat label="Score" value={String(play.score)} />
                  <MiniStat label="Streak" value={`${play.streak_days}d`} />
                  <MiniStat label="IV" value={String(play.iv_rank)} />
                </div>
                <p className="text-xs text-grey-300 leading-relaxed line-clamp-3">{play.summary}</p>
                <p className="text-[9px] font-mono text-grey-500 mt-3 uppercase tracking-wider">
                  {play.dte_range} · {play.entry_premium ? `$${play.entry_premium}` : "—"}
                </p>
              </motion.div>
            ))
          )}
        </div>
      </DeskPanel>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="desk-mini-stat">
      <p className="text-[8px] uppercase tracking-widest text-grey-500">{label}</p>
      <p className="font-mono text-sm font-bold text-purple-light">{value}</p>
    </div>
  );
}
