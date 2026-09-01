"use client";

import { useMemo } from "react";
import { clsx } from "clsx";
import type { FlowAlert } from "@/lib/api";
import { fmtPremium } from "@/lib/api";
import { fmtIv, fmtSpot } from "@/features/helix/lib/helix-flow-format";
import {
  helixScoreContextForPrint,
  helixScoreDistribution,
  helixScoreTierLabel,
  helixScoreTierTone,
} from "@/features/helix/lib/helix-score-context";

export type HelixTapeContextSummary = {
  ticker: string;
  printCount: number;
  callPremium: number;
  putPremium: number;
  spot: number | null;
  iv: number | null;
  dte0Count: number;
  chainOi: number | null;
  topScore: number | null;
  topScoreTier: string | null;
};

export function summarizeHelixTapeContext(
  alerts: readonly FlowAlert[],
  ticker: string
): HelixTapeContextSummary | null {
  const sym = ticker.trim().toUpperCase();
  if (!sym) return null;
  const scoped = alerts.filter((a) => a.ticker.toUpperCase() === sym);
  if (!scoped.length) return null;

  let callPremium = 0;
  let putPremium = 0;
  let dte0Count = 0;
  let chainOi = 0;
  let oiSamples = 0;
  let spot: number | null = null;
  let iv: number | null = null;
  let topScore = -1;

  for (const a of scoped) {
    const prem = a.premium ?? 0;
    if (a.option_type?.toUpperCase() === "PUT") putPremium += prem;
    else callPremium += prem;
    if (a.dte === 0) dte0Count += 1;
    if (a.open_interest != null && a.open_interest > 0) {
      chainOi += a.open_interest;
      oiSamples += 1;
    }
    if (a.underlying_price != null && a.underlying_price > 0) spot = a.underlying_price;
    if (a.implied_volatility != null && a.implied_volatility > 0) iv = a.implied_volatility;
    if (a.score > topScore) topScore = a.score;
  }

  const dist = helixScoreDistribution(scoped.map((a) => a.score));
  const topCtx =
    topScore > 0 ? helixScoreContextForPrint(topScore, dist) : null;

  return {
    ticker: sym,
    printCount: scoped.length,
    callPremium,
    putPremium,
    spot,
    iv,
    dte0Count,
    chainOi: oiSamples > 0 ? chainOi : null,
    topScore: topScore > 0 ? topScore : null,
    topScoreTier: topCtx ? helixScoreTierLabel(topCtx.tier) : null,
  };
}

/** Sticky session context for the focused ticker — spot, IV, flow mix, chain depth proxy. */
export function HelixContextHeader({
  alerts,
  ticker,
  className,
}: {
  alerts: readonly FlowAlert[];
  ticker: string;
  className?: string;
}) {
  const summary = useMemo(
    () => summarizeHelixTapeContext(alerts, ticker),
    [alerts, ticker]
  );

  if (!summary) return null;

  const pcr =
    summary.callPremium + summary.putPremium > 0
      ? summary.putPremium / (summary.callPremium + summary.putPremium)
      : null;

  const topTone =
    summary.topScoreTier === "Rare"
      ? helixScoreTierTone("rare")
      : summary.topScoreTier === "Notable"
        ? helixScoreTierTone("notable")
        : helixScoreTierTone("common");

  return (
    <div
      className={clsx(
        "helix-context-header flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 rounded-lg border border-white/[0.08] bg-[rgba(8,9,14,0.85)]",
        className
      )}
      data-testid="helix-context-header"
    >
      <span className="font-mono text-[11px] font-semibold text-white tracking-wide">
        {summary.ticker}
      </span>
      <span className="font-mono text-[10px] text-cyan-400">
        {summary.printCount} print{summary.printCount === 1 ? "" : "s"}
      </span>
      {summary.spot != null && (
        <span className="font-mono text-[10px] text-sky-300 tabular-nums">
          Spot {fmtSpot(summary.spot)}
        </span>
      )}
      {summary.iv != null && (
        <span className="font-mono text-[10px] text-sky-300 tabular-nums">
          IV {fmtIv(summary.iv)}
        </span>
      )}
      {summary.dte0Count > 0 && (
        <span className="font-mono text-[10px] text-cyan-400">
          0DTE {summary.dte0Count}
        </span>
      )}
      {summary.chainOi != null && (
        <span className="font-mono text-[10px] text-cyan-400 tabular-nums">
          Tape OI Σ {summary.chainOi.toLocaleString()}
        </span>
      )}
      <span className="font-mono text-[10px] text-cyan-400 tabular-nums">
        C {fmtPremium(summary.callPremium)} · P {fmtPremium(summary.putPremium)}
        {pcr != null ? ` · PCR ${(pcr * 100).toFixed(0)}%` : ""}
      </span>
      {summary.topScore != null && summary.topScoreTier && (
        <span
          className="font-mono text-[10px] font-semibold px-1.5 py-0.5 rounded border tabular-nums"
          style={{
            color: topTone.text,
            borderColor: topTone.border,
            background: topTone.bg,
          }}
          title="Top session score for this symbol — notability tier, not directional conviction"
        >
          Top {summary.topScore.toFixed(0)} · {summary.topScoreTier}
        </span>
      )}
      <a
        href={`/heatmap?ticker=${encodeURIComponent(summary.ticker)}`}
        className="font-mono text-[10px] text-sky-300 hover:text-white ml-auto"
      >
        Thermal →
      </a>
    </div>
  );
}
