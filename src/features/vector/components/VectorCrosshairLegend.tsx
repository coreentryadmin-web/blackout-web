"use client";

import { forwardRef, memo } from "react";
import type { VectorDarkPoolLevel, VectorWallLevel } from "@/lib/api";
import type { VectorWallLens } from "@/features/vector/lib/vector-wall-history";

export type VectorCrosshairState = {
  time: string;
  close: number | null;
  lens: VectorWallLens;
  flip: number | null;
  callWalls: VectorWallLevel[];
  putWalls: VectorWallLevel[];
  darkPoolLevels: VectorDarkPoolLevel[];
  /** Nearest reconstructed GEX cell when the heatmap overlay is on. */
  gexCell?: { strike: number; value: number } | null;
};

function fmtStrike(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

function fmtGex(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
  return Math.round(n).toLocaleString("en-US");
}

function wallsLine(
  walls: VectorWallLevel[],
  label: string,
  className: string
): string {
  if (!walls.length) return "";
  const body = walls
    .slice(0, 3)
    .map((w) => `${fmtStrike(w.strike)} (${w.pct.toFixed(0)}%)`)
    .join(" · ");
  return `<div class="${className}">${label} ${body}</div>`;
}

/** Imperative paint — avoids re-rendering VectorChart on every crosshair tick. */
export function renderVectorCrosshairLegend(
  el: HTMLElement | null,
  state: VectorCrosshairState | null,
  ticker: string
): void {
  if (!el) return;
  if (!state) {
    el.hidden = true;
    el.textContent = "";
    return;
  }
  el.hidden = false;
  const isVex = state.lens === "vex";
  const callClass = isVex ? "text-sky-300" : "text-[#ffd60a]";
  const putClass = isVex ? "text-rose-300" : "text-[#b26bff]";
  const callLabel = isVex ? "Vanna +" : "Call";
  const putLabel = isVex ? "Vanna −" : "Put";
  const flipLabel = isVex ? "Vanna flip" : "γ flip";

  const head: string[] = [
    `<span class="text-sky-300">${state.time}</span>`,
    `<span class="uppercase tracking-wider text-cyan-400">${state.lens}</span>`,
  ];
  if (state.close != null) {
    head.push(
      `<span>${ticker} <span class="text-cyan-400">${fmtStrike(state.close)}</span></span>`
    );
  }
  if (state.flip != null) {
    head.push(
      `<span>${flipLabel} <span class="text-cyan-400">${fmtStrike(state.flip)}</span></span>`
    );
  }

  const lines = [`<div class="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">${head.join("")}</div>`];
  lines.push(wallsLine(state.callWalls, callLabel, callClass));
  lines.push(wallsLine(state.putWalls, putLabel, putClass));
  if (state.darkPoolLevels.length) {
    lines.push(
      wallsLine(
        state.darkPoolLevels.map((l) => ({ strike: l.strike, pct: l.pct })),
        "DP",
        "text-[#ff8a3d]"
      )
    );
  }
  if (state.gexCell != null) {
    const tone = state.gexCell.value > 0 ? "text-emerald-400" : "text-fuchsia-400";
    lines.push(
      `<div class="${tone}">GEX ${fmtStrike(state.gexCell.strike)} <span class="text-white/80">${fmtGex(state.gexCell.value)}</span></div>`
    );
  }
  el.innerHTML = lines.filter(Boolean).join("");
}

/** Static shell — content is painted imperatively from the chart crosshair handler. */
export const VectorCrosshairLegend = memo(
  forwardRef<HTMLDivElement, { ticker: string }>(function VectorCrosshairLegend(_props, ref) {
    return (
      <div
        ref={ref}
        hidden
        className="pointer-events-none absolute left-3 top-3 z-10 flex max-w-[min(100%,420px)] flex-col gap-1 rounded-md border border-white/10 bg-[#040407] px-3 py-2 font-mono text-[11px] leading-snug text-white shadow-lg"
        aria-live="polite"
      />
    );
  })
);
