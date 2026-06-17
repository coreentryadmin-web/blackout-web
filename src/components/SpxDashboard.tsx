"use client";

import useSWR from "swr";
import { motion, AnimatePresence } from "framer-motion";
import { clsx } from "clsx";
import { fetchSpxIndices, fetchSpxState, fmtPct, fmtPrice, fmtPremium, type SpxState } from "@/lib/api";
import { SpxSniperHeader } from "@/components/desk/SpxSniperHeader";
import { BenzingaNewsRail } from "@/components/desk/BenzingaNewsRail";
import { SpxChart } from "@/components/desk/SpxChart";

const REFRESH_MS = 5_000;

function useSpxLive() {
  const { data: indices } = useSWR("spx-indices", fetchSpxIndices, {
    refreshInterval: REFRESH_MS,
    revalidateOnFocus: true,
  });

  const { data: intel, error: intelError } = useSWR<SpxState>("spx-state", fetchSpxState, {
    refreshInterval: REFRESH_MS,
    revalidateOnFocus: true,
  });

  const merged: SpxState | undefined = intel
    ? {
        ...intel,
        available:
          Boolean(indices?.spx) ||
          intel.available ||
          (intel.price > 0 && !intelError),
        price: indices?.spx?.price ?? intel.price,
        spx_change_pct: indices?.spx?.change_pct ?? intel.spx_change_pct,
        vix: indices?.vix?.price ?? intel.vix,
        vix_change_pct: indices?.vix?.change_pct ?? intel.vix_change_pct,
        as_of: indices?.as_of ?? intel.as_of,
        source: indices?.spx ? (intel.available ? "merged" : "polygon") : intel.source,
      }
    : undefined;

  const live = Boolean(merged?.available && merged.price > 0);

  return { data: merged, live };
}

export function SpxDashboard() {
  const { data: s, live } = useSpxLive();
  const bull = (s?.spx_change_pct ?? 0) >= 0;

  return (
    <div className="spx-sniper-desk">
      <SpxSniperHeader live={live} />

      <div className="spx-sniper-hero">
        <div className="spx-sniper-hero-grid" aria-hidden />
        <div className="relative z-10 flex flex-col xl:flex-row xl:items-end xl:justify-between gap-6">
          <div>
            <p className="font-mono text-[10px] tracking-[0.45em] text-bull uppercase mb-2">
              ◆ I:SPX · updates every 5s
            </p>
            <AnimatePresence mode="popLayout">
              <motion.p
                key={s?.price}
                initial={{ opacity: 0.5, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25 }}
                className="font-anton text-6xl md:text-8xl text-white leading-none tabular-nums text-glow-green"
              >
                {live ? fmtPrice(s?.price ?? null, 2) : "— — —"}
              </motion.p>
            </AnimatePresence>
            <div className="flex flex-wrap items-center gap-4 mt-4">
              <span
                className={clsx(
                  "font-mono text-xl font-bold tabular-nums",
                  bull ? "num-bull" : "num-bear"
                )}
              >
                {live ? fmtPct(s?.spx_change_pct ?? null) : "—"}
              </span>
              <StatPill label="VIX" value={live && s?.vix != null ? fmtPrice(s.vix, 2) : "—"} />
              <StatPill label="VWAP" value={live ? fmtPrice(s?.vwap ?? null) : "—"} />
              <StatPill label="HOD" value={live ? fmtPrice(s?.hod ?? null) : "—"} />
              <StatPill label="LOD" value={live ? fmtPrice(s?.lod ?? null) : "—"} />
              <StatPill
                label="GEX"
                value={live && s?.gex_net != null ? fmtPremium(s.gex_net) : "—"}
                accent
              />
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 min-w-[240px]">
            <StatPill label="Regime" value={live ? (s?.chart_levels?.regime ?? "—") : "—"} accent />
            <StatPill
              label="γ Flip"
              value={live && s?.gamma_flip ? fmtPrice(s.gamma_flip) : "—"}
            />
            <StatPill
              label="Max Pain"
              value={live && s?.max_pain ? fmtPrice(s.max_pain) : "—"}
            />
            <StatPill
              label="IV Rank"
              value={live && s?.uw_iv_rank != null ? String(s.uw_iv_rank) : "—"}
            />
          </div>
        </div>
      </div>

      <div className="spx-sniper-main">
        <div className="spx-sniper-chart-col">
          <SpxChart height={640} />
        </div>
        <BenzingaNewsRail />
      </div>
    </div>
  );
}

function StatPill({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="spx-stat-pill">
      <p className="text-[8px] tracking-widest uppercase text-grey-500 mb-0.5">{label}</p>
      <p
        className={clsx(
          "font-mono text-xs font-semibold tabular-nums capitalize truncate",
          accent ? "text-bull" : "text-white"
        )}
      >
        {value}
      </p>
    </div>
  );
}
