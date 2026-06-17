"use client";

import { motion, AnimatePresence } from "framer-motion";
import { clsx } from "clsx";
import type { SpxDeskPayload } from "@/lib/providers/spx-desk";
import { fmtPct, fmtPremium, fmtPrice } from "@/lib/api";

type Props = {
  desk?: SpxDeskPayload;
  live?: boolean;
};

export function SpxSniperHeader({ desk, live }: Props) {
  const bull = (desk?.spx_change_pct ?? 0) >= 0;

  return (
    <header className="spx-sniper-command">
      <div className="spx-sniper-command-grid" aria-hidden />
      <div className="relative z-10">
        <div className="flex flex-col xl:flex-row xl:items-start xl:justify-between gap-5">
          <div className="flex flex-col md:flex-row md:items-end gap-5 md:gap-8 min-w-0 flex-1">
            <div className="shrink-0">
              <h1 className="spx-sniper-title">
                <span className="text-grey-200">SPX</span>
                <span className="text-grey-600">-</span>
                <span className="text-grey-300">SNIPER</span>
              </h1>
              <p className="font-mono text-[9px] tracking-[0.3em] text-grey-600 uppercase mt-1.5">
                Precision · Patience · 0DTE Structure
              </p>
            </div>

            <div className="min-w-0">
              <AnimatePresence mode="popLayout">
                <motion.p
                  key={desk?.price}
                  initial={{ opacity: 0.6, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25 }}
                  className="font-anton text-5xl sm:text-6xl md:text-7xl text-grey-100 leading-none tabular-nums"
                >
                  {live ? fmtPrice(desk?.price ?? null, 2) : "— — —"}
                </motion.p>
              </AnimatePresence>
              <div className="flex flex-wrap items-center gap-2 mt-3">
                <span
                  className={clsx(
                    "font-mono text-lg font-semibold tabular-nums",
                    bull ? "text-emerald-500/90" : "text-rose-500/90"
                  )}
                >
                  {live ? fmtPct(desk?.spx_change_pct ?? null) : "—"}
                </span>
                <StatPill label="VIX" value={live && desk?.vix != null ? fmtPrice(desk.vix, 2) : "—"} tone="muted" />
                <StatPill
                  label="VWAP"
                  value={live ? fmtPrice(desk?.vwap ?? null) : "—"}
                  tone={desk?.above_vwap ? "bull" : "bear"}
                />
                <StatPill label="HOD" value={live ? fmtPrice(desk?.hod ?? null) : "—"} tone="muted" />
                <StatPill label="LOD" value={live ? fmtPrice(desk?.lod ?? null) : "—"} tone="muted" />
                <StatPill
                  label="GEX"
                  value={live && desk?.gex_net != null ? fmtPremium(desk.gex_net) : "—"}
                  tone={(desk?.gex_net ?? 0) >= 0 ? "bull" : "bear"}
                />
              </div>
            </div>
          </div>

          <div className="flex flex-col items-start xl:items-end gap-3 shrink-0">
            <span className={clsx("spx-command-live", live && "spx-command-live-on")}>
              <span className="badge-live-dot" />
              {live ? "Live" : "Standby"}
            </span>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 w-full xl:w-auto min-w-[200px]">
              <StatPill label="Regime" value={live ? (desk?.regime ?? "—") : "—"} tone="muted" capitalize />
              <StatPill label="γ Flip" value={live && desk?.gamma_flip ? fmtPrice(desk.gamma_flip) : "—"} tone="muted" />
              <StatPill label="Max Pain" value={live ? fmtPrice(desk?.max_pain ?? null) : "—"} tone="muted" />
              <StatPill
                label="IV Rank"
                value={live && desk?.uw_iv_rank != null ? String(desk.uw_iv_rank) : "—"}
                tone="muted"
              />
            </div>
          </div>
        </div>

        {live && desk?.as_of && (
          <p className="mt-4 font-mono text-[8px] text-grey-700 tracking-wider">
            Desk · {new Date(desk.as_of).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" })}
          </p>
        )}
      </div>
    </header>
  );
}

const PILL_TONE: Record<string, string> = {
  bull: "text-emerald-600/90 border-emerald-900/50",
  bear: "text-rose-600/90 border-rose-900/50",
  muted: "text-grey-400 border-grey-800/80",
};

function StatPill({
  label,
  value,
  tone = "muted",
  capitalize: cap,
}: {
  label: string;
  value: string;
  tone?: string;
  capitalize?: boolean;
}) {
  return (
    <div className={clsx("spx-stat-pill spx-stat-pill-dark", PILL_TONE[tone])}>
      <p className="text-[7px] tracking-widest uppercase text-grey-600 mb-0.5">{label}</p>
      <p
        className={clsx(
          "font-mono text-[11px] font-medium tabular-nums truncate",
          cap && "capitalize",
          PILL_TONE[tone]?.split(" ")[0] ?? "text-grey-400"
        )}
      >
        {value}
      </p>
    </div>
  );
}
