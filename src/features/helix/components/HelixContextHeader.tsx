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
  /** Put/Call premium RATIO — putPremium / callPremium, `null` when there is no call premium to
   *  divide by. Matches the ONE PCR convention every other reader of this field in the codebase
   *  uses (`unusual-whales.ts`'s dark-pool `pcr`, `spx-desk-brief.ts`, `MeridianEarningsIntelPanel`'s
   *  `P/C`) — a ratio around 1.0 (e.g. 0.65, 1.20), not a percentage. This header previously
   *  computed `putPremium / (callPremium + putPremium)` instead — that is PUT PREMIUM'S SHARE OF
   *  TOTAL premium (bounded 0-100%, reads as 50% on a perfectly even split), a different quantity
   *  rendered under the same "PCR" label the rest of the product uses for the true ratio. See the
   *  REGRESSION test for the live disagreement this produced. */
  pcr: number | null;
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
    const optType = a.option_type?.toUpperCase();
    // gap-#6 (same discipline as FlowFeed.tsx/NetPremiumLeaderboard.tsx): `option_type` is a bare
    // `string` on FlowAlert, not a "CALL" | "PUT" union, so an UNKNOWN/typeless/malformed print is
    // a real possibility, not a theoretical one. The previous `else callPremium += prem` treated
    // every non-PUT value — including '', null-ish, and any garbage string — as a CALL, which
    // fabricates call premium out of prints this header could not classify at all and silently
    // inflates the Call/Put premium readout and the PCR this header renders for the ticker.
    if (optType === "CALL") callPremium += prem;
    else if (optType === "PUT") putPremium += prem;
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
    // Same formula + rounding as unusual-whales.ts's dark-pool `pcr` (callPrem > 0 ? putPrem /
    // callPrem : null, rounded to 2dp) — one shared definition of what "PCR" means on this page.
    pcr: callPremium > 0 ? Math.round((putPremium / callPremium) * 100) / 100 : null,
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
        {summary.pcr != null ? ` · PCR ${summary.pcr.toFixed(2)}` : ""}
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
      <div className="ml-auto flex items-center gap-3">
        <a
          href={`/heatmap?ticker=${encodeURIComponent(summary.ticker)}`}
          className="font-mono text-[10px] text-sky-300 hover:text-white"
        >
          Thermal →
        </a>
        {/* Vector accepts any well-formed ticker (isVectorTickerAllowed is not an allowlist —
            see vector-ticker.ts), and every ticker reaching this header already has real option
            flow, so it is always optionable. Meridian and Night Hawk have no ticker-scoped deep
            link today (Meridian's search is client-state-only, Night Hawk's board has no ticker
            param), so a link there would drop the user on an unscoped page — worse than no link. */}
        <a
          href={`/vector?ticker=${encodeURIComponent(summary.ticker)}`}
          className="font-mono text-[10px] text-sky-300 hover:text-white"
        >
          Vector →
        </a>
      </div>
    </div>
  );
}
