"use client";

import useSWR from "swr";
import { fetchSpxState, fmtPct, type SpxState } from "@/lib/api";
import { clsx } from "clsx";
import { EngineStatusBar } from "@/components/desk/EngineStatusBar";
import { DeskHeroTicker } from "@/components/desk/DeskHeroTicker";
import { GexDealerPanel, Flow0dtePanel, BreadthPanel } from "@/components/desk/GexDealerPanel";
import { LevelLadder } from "@/components/desk/LevelLadder";
import { BenzingaNewsTicker } from "@/components/desk/BenzingaNewsTicker";
import { TradingViewWidget } from "@/components/embeds/TradingViewWidget";
import { PlatformEmpty } from "@/components/platform/PlatformEmpty";

export function SpxDashboard() {
  const { data, isLoading, error } = useSWR<SpxState>("spx-state", fetchSpxState, {
    refreshInterval: 12_000,
  });

  const live = !error && data?.available === true;
  const s = data;

  return (
    <div className="desk-layout space-y-5">
      <EngineStatusBar />
      <BenzingaNewsTicker />
      <DeskHeroTicker data={s} live={live && !isLoading} />

      {!live && !isLoading && (
        <PlatformEmpty
          variant="dashboard"
          title="MARKET DATA STANDBY"
          description="Add POLYGON_API_KEY and UW_API_KEY on Railway (server-side, not NEXT_PUBLIC). SPX quotes load from Polygon; GEX and levels overlay when BlackOut Engine is online."
        />
      )}

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        <div className="xl:col-span-8 space-y-4">
          <TradingViewWidget type="advanced-chart" symbol="CBOE:SPX" title="SPX Live Chart" height={420} />
          <div className="grid md:grid-cols-3 gap-4">
            <GexDealerPanel data={s} live={live} />
            <Flow0dtePanel data={s} live={live} />
            <BreadthPanel data={s} live={live} />
          </div>
        </div>
        <div className="xl:col-span-4 space-y-4">
          <LevelLadder data={s} live={live} />
          {live && s && (s.sector_leaders.length > 0 || s.sector_laggards.length > 0) && (
            <SectorPulse leaders={s.sector_leaders} laggards={s.sector_laggards} />
          )}
        </div>
      </div>

      <TradingViewWidget type="ticker-tape" title="Market Tape" height={48} />
    </div>
  );
}

function SectorPulse({
  leaders,
  laggards,
}: {
  leaders: Array<{ sector: string; change_pct: number }>;
  laggards: Array<{ sector: string; change_pct: number }>;
}) {
  return (
    <div className="desk-panel desk-panel-neutral">
      <div className="desk-panel-header">
        <p className="desk-panel-title">Sector Pulse</p>
      </div>
      <div className="desk-panel-body grid grid-cols-2 gap-4">
        <div>
          <p className="text-[9px] tracking-widest uppercase text-grey-500 mb-2">Leaders</p>
          {leaders.slice(0, 4).map((sec) => (
            <div key={sec.sector} className="flex justify-between py-1.5 border-b border-grey-800/80 last:border-0">
              <span className="text-xs text-grey-300 truncate pr-2">{sec.sector}</span>
              <span className="font-mono text-xs num-bull">{fmtPct(sec.change_pct)}</span>
            </div>
          ))}
        </div>
        <div>
          <p className="text-[9px] tracking-widest uppercase text-grey-500 mb-2">Laggards</p>
          {laggards.slice(0, 4).map((sec) => (
            <div key={sec.sector} className="flex justify-between py-1.5 border-b border-grey-800/80 last:border-0">
              <span className="text-xs text-grey-300 truncate pr-2">{sec.sector}</span>
              <span className={clsx("font-mono text-xs", "num-bear")}>{fmtPct(sec.change_pct)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
