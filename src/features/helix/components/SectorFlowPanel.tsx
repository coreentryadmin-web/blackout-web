"use client";

import { motion, AnimatePresence } from "framer-motion";
import { clsx } from "clsx";
import { fmtPremium } from "@/lib/api";
import { Panel } from "@/components/ui";
import {
  directionTone,
  readDirectionTitle,
  type DirectionRead,
} from "@/features/helix/lib/helix-direction-read";

export type SectorFlowEntry = {
  sector: string;
  /** Native call/put premium — the panel's own fact, kept. `callPct` still labels itself "% C". */
  callPremium: number;
  putPremium: number;
  total: number;
  /** `null` when the sector carries no premium; never a fabricated even split. */
  callPct: number | null;
  /** The aggression-aware read. This, not `callPct`, decides the colour: a sector whose calls were
   *  SOLD is bearish rotation, and colouring it green said the opposite. */
  direction: DirectionRead;
};

export function SectorFlowPanel({
  entries,
}: {
  entries: SectorFlowEntry[];
}) {
  if (entries.length === 0) {
    return (
      <Panel accent="ember" kicker="▦ 7d rotation" title="Sector Flow">
        <div className="flow-panel-body py-6 text-center">
          <p className="font-mono text-[11px] text-orange-300/70">No sector rotation data this session</p>
        </div>
      </Panel>
    );
  }

  // Ordered by total premium, largest first — which is also what `maxTotal` below is read off, so
  // the widest bar is always the first row.
  //
  // This used to run a SECTOR_ORDER-aware comparator FIRST and then `.sort((a, b) => b.total -
  // a.total)` over the result. The second sort replaced the ordering wholesale, so the curated
  // sector grouping never reached the screen — proven by running both against the same input and
  // getting byte-identical output. The comparator, and this file's only use of `SECTOR_ORDER`,
  // were dead. Removed rather than left, because someone changing the sector ordering would edit
  // those lines and watch nothing happen.
  //
  // Whether the panel SHOULD group by SECTOR_ORDER instead of ranking by premium is a product
  // question, not a cleanup: the behaviour here is exactly what shipped.
  const sorted = [...entries].sort((a, b) => b.total - a.total);

  const maxTotal = sorted[0]?.total ?? 1;

  return (
    <Panel
      accent="ember"
      kicker="▦ 7d rotation"
      title="Sector Flow"
      bodyClassName="space-y-1.5"
    >
      <AnimatePresence initial={false}>
          {sorted.map((e, i) => {
            // Colour is a DIRECTION claim and comes from the aggression-aware read, not from
            // call-vs-put share. Neutral whenever too little of the sector's premium carries a
            // readable side — which, for index-heavy sectors, is most of it.
            const tone = directionTone(e.direction);
            const isBull = tone === "bull";
            const isBear = tone === "bear";
            const widthPct = Math.max(8, (e.total / maxTotal) * 100);

            return (
              <motion.div
                key={e.sector}
                layout="position"
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0 }}
                transition={{ delay: i * 0.03, duration: 0.2 }}
                className="space-y-1"
                title={readDirectionTitle(e.direction)}
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[12px] font-semibold text-sky-100 w-28 truncate">
                    {e.sector}
                  </span>
                  <div className="flex items-center gap-2">
                    <span
                      className="font-mono text-[12px] font-bold tabular-nums"
                      style={{ color: isBull ? "#a3e635" : isBear ? "#ff2d55" : "#7dd3fc" }}
                    >
                      {e.callPct == null ? "—" : `${e.callPct}% C`}
                    </span>
                    <span
                      className={clsx(
                        "font-mono text-[13px] font-bold tabular-nums",
                        isBull ? "num-bull" : isBear ? "num-bear" : "text-white"
                      )}
                    >
                      {fmtPremium(e.total)}
                    </span>
                  </div>
                </div>

                {/* Call / put bar */}
                <div className="relative h-2 rounded-full overflow-hidden bg-white/[0.06]">
                  <motion.div
                    className="absolute inset-y-0 left-0 rounded-full"
                    style={{
                      background: isBull
                        ? "linear-gradient(90deg, #00b35a, #a3e635)"
                        : isBear
                          ? "linear-gradient(90deg, #b3203c, #ff2d55)"
                          : "linear-gradient(90deg, #0c4a6e, #7dd3fc)",
                      width: `${widthPct}%`,
                    }}
                    initial={{ width: 0 }}
                    animate={{ width: `${widthPct}%` }}
                    transition={{ duration: 0.8, ease: [0.34, 1.56, 0.64, 1] as const, delay: i * 0.04 }}
                  />
                </div>
              </motion.div>
            );
          })}
      </AnimatePresence>

      <p className="font-mono text-[10px] text-sky-300/70 text-center pt-1">
        Premium weighted · bar = relative size vs top sector · colour = aggressor-side direction
      </p>
    </Panel>
  );
}
