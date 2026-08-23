"use client";

import useSWR from "swr";
import { clsx } from "clsx";
import { fetchSpxState, type SpxState } from "@/lib/api";
import { tideSplit, netPremiumSense } from "@/features/helix/lib/helix-tide-split";

function fmtMoney(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(0)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

/**
 * Compact market tide indicator for the HELIX page header. Reads from the shared
 * SPX desk merged payload (cache-reader — no extra upstream call). Shows:
 *   - Call vs put tide premium split bar
 *   - Directional bias pill (BULLISH / BEARISH / NEUTRAL)
 * Zero new API paths: reuses fetchSpxState → /api/market/spx/merged.
 */
export function HelixTideBar({ className }: { className?: string }) {
  const { data } = useSWR<SpxState>("helix-tide", fetchSpxState, { refreshInterval: 5_000 });

  const tideBias = (data?.tide_bias ?? "").toLowerCase();
  const callPrem = data?.tide_call ?? null;
  const putPrem = data?.tide_put ?? null;

  // No data or market closed — render nothing (self-hides cleanly).
  if (!data?.available || (callPrem == null && putPrem == null && !tideBias)) return null;

  // `tide_call` / `tide_put` are UW's SIGNED net premiums — negative means that side was net SOLD.
  // Summing them and taking a ratio treated them as magnitudes: on a full measured session the bar
  // fell back to a flat 50/50 on 61.7% of snapshots (while the pill read BULLISH) and exceeded 100%
  // width on the other 38.3%. See helix-tide-split.ts for the measurement and the decomposition.
  const split = tideSplit(callPrem, putPrem);
  const callSense = netPremiumSense(callPrem);
  const putSense = netPremiumSense(putPrem);

  const isBull = tideBias.includes("bull");
  const isBear = tideBias.includes("bear");
  const biasLabel = isBull ? "BULLISH" : isBear ? "BEARISH" : "NEUTRAL";
  const biasCls = isBull
    ? "bg-emerald-400/15 text-emerald-400 outline-emerald-400/50"
    : isBear
    ? "bg-[#ff5c78]/15 text-[#ff5c78] outline-[#ff5c78]/50"
    : "bg-sky-400/15 text-sky-300 outline-sky-400/50";

  return (
    <div className={clsx("helix-tide-bar flex items-center gap-3", className)}>
      {/* Bias pill */}
      <span
        className={clsx(
          "shrink-0 rounded-md px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider outline outline-1",
          biasCls
        )}
      >
        {biasLabel}
      </span>

      {/* BULLISH vs BEARISH flow split — not call-vs-put premium, which cannot be split while the
          inputs are signed. Bullish = calls bought + puts sold; bearish = calls sold + puts bought.
          Both non-negative, so the width is always a real proportion. */}
      <div className="flex min-w-[80px] flex-1 flex-col gap-0.5">
        {split.bullishPct == null ? (
          // No directional flow to split. Deliberately NOT a 50/50 bar: "nothing measured" and
          // "measured and balanced" are different facts and the old fallback conflated them.
          <div className="font-mono text-[9px] uppercase tracking-wider text-sky-300/50">
            No directional flow
          </div>
        ) : (
          <div className="flex h-1.5 overflow-hidden rounded-full bg-[rgba(8,9,14,0.8)]">
            <span
              className="h-full transition-[width] duration-500"
              style={{ width: `${split.bullishPct.toFixed(1)}%`, backgroundColor: "#a3e635", boxShadow: "0 0 6px #a3e63566" }}
            />
            <span
              className="h-full flex-1"
              style={{ backgroundColor: "#ff2d55", boxShadow: "0 0 6px #ff2d5566" }}
            />
          </div>
        )}
        <div className="flex flex-wrap justify-between gap-x-2 gap-y-0.5 font-mono text-[9px] tabular-nums">
          {/* The SENSE is shown, not hidden. Gating on `> 0` meant a net-sold side simply vanished —
              net put premium was negative on every snapshot measured, so the puts figure never
              rendered at all. */}
          {callSense && (
            <span className={callSense === "sold" ? "text-[#ff5c78]" : "text-emerald-400"}>
              {fmtMoney(Math.abs(callPrem ?? 0))} calls {callSense}
            </span>
          )}
          {putSense && (
            <span className={putSense === "sold" ? "text-emerald-400" : "text-[#ff5c78]"}>
              {fmtMoney(Math.abs(putPrem ?? 0))} puts {putSense}
            </span>
          )}
        </div>
      </div>

      {/* Tide label */}
      <span className="shrink-0 font-mono text-[9px] uppercase tracking-widest text-sky-300/60">
        Tide
      </span>
    </div>
  );
}
