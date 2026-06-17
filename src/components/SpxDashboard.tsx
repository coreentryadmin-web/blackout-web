"use client";

import useSWR from "swr";
import { motion, AnimatePresence } from "framer-motion";
import { clsx } from "clsx";
import { fetchSpxDesk, fmtPct, fmtPrice, fmtPremium } from "@/lib/api";
import { SpxSniperHeader } from "@/components/desk/SpxSniperHeader";
import { SpxStructureBlocks } from "@/components/desk/SpxStructureBlocks";
import { SpxCommentaryRail } from "@/components/desk/SpxCommentaryRail";
import { SpxChart } from "@/components/desk/SpxChart";

const DESK_REFRESH_MS = 5_000;

export function SpxDashboard() {
  const { data: desk, error } = useSWR("spx-desk", fetchSpxDesk, {
    refreshInterval: DESK_REFRESH_MS,
    revalidateOnFocus: true,
  });

  const live = !error && desk?.available === true && (desk?.price ?? 0) > 0;
  const bull = (desk?.spx_change_pct ?? 0) >= 0;

  return (
    <div className="spx-sniper-desk">
      <SpxSniperHeader live={live} />

      <div className="spx-sniper-hero">
        <div className="spx-sniper-hero-grid" aria-hidden />
        <div className="relative z-10 flex flex-col xl:flex-row xl:items-end xl:justify-between gap-6">
          <div>
            <p className="font-mono text-[10px] tracking-[0.45em] text-bull uppercase mb-2">
              ◆ I:SPX · Polygon + UW · live {DESK_REFRESH_MS / 1000}s
            </p>
            <AnimatePresence mode="popLayout">
              <motion.p
                key={desk?.price}
                initial={{ opacity: 0.5, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25 }}
                className="font-anton text-6xl md:text-8xl text-white leading-none tabular-nums text-glow-green"
              >
                {live ? fmtPrice(desk?.price ?? null, 2) : "— — —"}
              </motion.p>
            </AnimatePresence>
            <div className="flex flex-wrap items-center gap-3 mt-4">
              <span
                className={clsx(
                  "font-mono text-xl font-bold tabular-nums",
                  bull ? "num-bull" : "num-bear"
                )}
              >
                {live ? fmtPct(desk?.spx_change_pct ?? null) : "—"}
              </span>
              <StatPill label="VIX" value={live && desk?.vix != null ? fmtPrice(desk.vix, 2) : "—"} tone="orange" />
              <StatPill label="VWAP" value={live ? fmtPrice(desk?.vwap ?? null) : "—"} tone={desk?.above_vwap ? "bull" : "bear"} />
              <StatPill label="HOD" value={live ? fmtPrice(desk?.hod ?? null) : "—"} tone="resistance" />
              <StatPill label="LOD" value={live ? fmtPrice(desk?.lod ?? null) : "—"} tone="support" />
              <StatPill
                label="GEX"
                value={live && desk?.gex_net != null ? fmtPremium(desk.gex_net) : "—"}
                tone={(desk?.gex_net ?? 0) >= 0 ? "bull" : "bear"}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 min-w-[240px]">
            <StatPill label="Regime" value={live ? (desk?.regime ?? "—") : "—"} tone="violet" hot />
            <StatPill label="γ Flip" value={live && desk?.gamma_flip ? fmtPrice(desk.gamma_flip) : "—"} tone="magenta" />
            <StatPill label="Max Pain" value={live ? fmtPrice(desk?.max_pain ?? null) : "—"} tone="cyan" />
            <StatPill
              label="IV Rank"
              value={live && desk?.uw_iv_rank != null ? String(desk.uw_iv_rank) : "—"}
              tone="gold"
            />
          </div>
        </div>
        {live && desk?.as_of && (
          <p className="relative z-10 mt-3 font-mono text-[8px] text-grey-600 tracking-wider">
            Desk tick · {new Date(desk.as_of).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" })}
          </p>
        )}
      </div>

      <div className="spx-sniper-split">
        <div className="spx-sniper-chart-col">
          <SpxChart height={720} />
        </div>

        <aside className="spx-sniper-right-rail">
          <SpxStructureBlocks desk={desk} live={live} />
          <SpxCommentaryRail desk={desk} live={live} />
        </aside>
      </div>
    </div>
  );
}

const PILL_TONE: Record<string, string> = {
  bull: "text-bull border-bull/30",
  bear: "text-bear border-bear/30",
  support: "text-emerald-400 border-emerald-500/30",
  resistance: "text-rose-400 border-rose-500/30",
  orange: "text-orange-400 border-orange-500/30",
  violet: "text-violet-300 border-violet-500/30",
  magenta: "text-fuchsia-400 border-fuchsia-500/30",
  cyan: "text-cyan-400 border-cyan-500/30",
  gold: "text-amber-300 border-amber-500/30",
};

function StatPill({
  label,
  value,
  tone = "neutral",
  hot,
}: {
  label: string;
  value: string;
  tone?: string;
  hot?: boolean;
}) {
  return (
    <div className={clsx("spx-stat-pill", PILL_TONE[tone], hot && "spx-stat-pill-hot")}>
      <p className="text-[8px] tracking-widest uppercase text-grey-500 mb-0.5">{label}</p>
      <p className={clsx("font-mono text-xs font-semibold tabular-nums capitalize truncate", PILL_TONE[tone]?.split(" ")[0] ?? "text-white")}>
        {value}
      </p>
    </div>
  );
}
