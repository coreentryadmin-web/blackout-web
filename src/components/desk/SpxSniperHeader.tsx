"use client";

import { clsx } from "clsx";

type SpxSniperHeaderProps = {
  live?: boolean;
};

export function SpxSniperHeader({ live }: SpxSniperHeaderProps) {
  return (
    <header className="spx-sniper-header">
      <div className="spx-sniper-header-inner">
        <div>
          <p className="font-mono text-[10px] tracking-[0.55em] text-bull uppercase mb-1">
            ◆ BlackOut Ops
          </p>
          <h1 className="spx-sniper-title">
            <span className="text-stroke-green">SPX</span>
            <span className="text-white">-</span>
            <span className="text-gradient-fire">SNIPER</span>
          </h1>
          <p className="font-mono text-[10px] tracking-[0.35em] text-grey-300 uppercase mt-2">
            Precision · Patience · 0DTE Structure
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <span className={clsx("badge-live", live && "animate-pulse")}>
            <span className="badge-live-dot" />
            {live ? "Live Fire" : "Standby"}
          </span>
          <p className="font-mono text-[9px] tracking-widest text-grey-500 uppercase hidden sm:block">
            Polygon · Massive Indices
          </p>
        </div>
      </div>
      <div className="spx-sniper-header-scan" aria-hidden />
    </header>
  );
}
