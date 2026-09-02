"use client";

import useSWR from "swr";
import { clsx } from "clsx";
import { fetchMarketIndices } from "@/lib/api";

function fmtPct(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

/**
 * Whole-market regime context for the HELIX tape — VIX level + session move. A print's size or
 * aggression reads differently depending on whether the whole market is calm or already moving:
 * a $2M sweep on a 12% VIX day is a different signal than the same sweep on a 30% VIX day, and
 * the tape itself carries no such context per print.
 *
 * Zero new upstream calls: `/api/market/indices` already exists (SPX+VIX via one cached Polygon
 * snapshot, `authorizeMarketDeskApi` — community tier, same bar as the rest of the market API) —
 * this is its first client-side consumer. VIX only for now, not sector ETF moves: `/api/market/
 * heatmap` carries sector performance but is gated "locked to non-admins until this tool ships"
 * (heatmap/route.ts), so it is not safe to surface here yet.
 */
export function HelixRegimeRibbon({ className }: { className?: string }) {
  const { data } = useSWR("helix-regime-ribbon", fetchMarketIndices, {
    refreshInterval: 15_000,
  });

  const vix = data?.vix;
  if (!vix) return null;

  // VIX itself has no bull/bear sense — a RISING VIX means rising fear/hedging demand, which is
  // conventionally shown as a warning color regardless of direction elsewhere in this app (where
  // green=bullish/red=bearish). Amber above a real elevated-vol threshold, sky at a calm level —
  // never green/red, so it can't be misread as a directional call on the market itself.
  const elevated = vix.price >= 25;
  const toneCls = elevated
    ? "text-gold border-gold/40 bg-gold/[0.08]"
    : "text-sky-300 border-sky-300/30 bg-sky-400/[0.06]";

  return (
    <div
      className={clsx("helix-regime-ribbon flex items-center gap-1.5", className)}
      data-testid="helix-regime-ribbon"
    >
      <span
        className={clsx(
          "rounded-md border px-1.5 py-0.5 font-mono text-[10px] font-semibold tabular-nums",
          toneCls
        )}
        title={elevated ? "VIX at or above 25 — elevated volatility/hedging demand" : "VIX — implied volatility index"}
      >
        VIX {vix.price.toFixed(1)}
      </span>
      <span
        className={clsx(
          "font-mono text-[10px] tabular-nums",
          vix.change_pct >= 0 ? "text-[#ff5c78]" : "text-emerald-400"
        )}
      >
        {fmtPct(vix.change_pct)}
      </span>
    </div>
  );
}
