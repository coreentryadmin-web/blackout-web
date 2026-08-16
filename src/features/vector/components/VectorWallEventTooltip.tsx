"use client";

import { forwardRef, memo } from "react";

export type WallEventTooltipState = {
  label: string;
  x: number;
  y: number;
};

/** Imperative paint — avoids re-rendering VectorChart on every crosshair tick. */
export function renderWallEventTooltip(
  el: HTMLElement | null,
  state: WallEventTooltipState | null
): void {
  if (!el) return;
  if (!state?.label) {
    el.hidden = true;
    el.textContent = "";
    return;
  }
  el.hidden = false;
  el.textContent = state.label;
  // Anchor above-right of the glyph; clamp inside the stage via CSS max-width + transform.
  el.style.left = `${Math.round(state.x + 10)}px`;
  el.style.top = `${Math.round(state.y - 28)}px`;
}

/** Static shell — content is painted imperatively from the chart crosshair handler. */
export const VectorWallEventTooltip = memo(
  forwardRef<HTMLDivElement>(function VectorWallEventTooltip(_props, ref) {
    return (
      <div
        ref={ref}
        hidden
        className="pointer-events-none absolute z-20 max-w-[min(100%,280px)] rounded border border-white/15 bg-[#040407] px-2.5 py-1.5 font-mono text-[11px] leading-snug text-white shadow-lg"
        role="tooltip"
      />
    );
  })
);
