"use client";

import type { VectorDarkPoolLevel, VectorWallLevel } from "@/lib/api";

export type VectorCrosshairState = {
  time: string;
  close: number | null;
  gammaFlip: number | null;
  callWalls: VectorWallLevel[];
  putWalls: VectorWallLevel[];
  darkPoolLevels: VectorDarkPoolLevel[];
};

type Props = {
  state: VectorCrosshairState | null;
};

function fmtStrike(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

export function VectorCrosshairLegend({ state }: Props) {
  if (!state) return null;

  return (
    <div
      className="pointer-events-none absolute left-3 top-3 z-10 flex max-w-[min(100%,420px)] flex-col gap-1 rounded-md border border-white/10 bg-[#040407]/90 px-3 py-2 font-mono text-[11px] leading-snug text-white shadow-lg backdrop-blur-sm"
      aria-live="polite"
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <span className="text-sky-300">{state.time}</span>
        {state.close != null && (
          <span>
            SPX <span className="text-cyan-400">{fmtStrike(state.close)}</span>
          </span>
        )}
        {state.gammaFlip != null && (
          <span>
            Flip <span className="text-cyan-400">{fmtStrike(state.gammaFlip)}</span>
          </span>
        )}
      </div>
      {state.callWalls.length > 0 && (
        <div className="text-[#ffd60a]">
          Call{" "}
          {state.callWalls
            .slice(0, 3)
            .map((w) => `${fmtStrike(w.strike)} (${w.pct.toFixed(0)}%)`)
            .join(" · ")}
        </div>
      )}
      {state.putWalls.length > 0 && (
        <div className="text-[#b26bff]">
          Put{" "}
          {state.putWalls
            .slice(0, 3)
            .map((w) => `${fmtStrike(w.strike)} (${w.pct.toFixed(0)}%)`)
            .join(" · ")}
        </div>
      )}
      {state.darkPoolLevels.length > 0 && (
        <div className="text-[#00d4ff]">
          DP{" "}
          {state.darkPoolLevels
            .slice(0, 3)
            .map((l) => `${fmtStrike(l.strike)} (${l.pct.toFixed(0)}%)`)
            .join(" · ")}
        </div>
      )}
    </div>
  );
}
