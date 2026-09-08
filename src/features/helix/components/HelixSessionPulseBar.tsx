import { useMemo } from "react";
import { clsx } from "clsx";
import { fmtPremium } from "@/lib/api";
import {
  computeHelixSessionPulse,
  type HelixSessionPulse,
} from "@/features/helix/lib/helix-session-pulse";

function directionTone(read: HelixSessionPulse["directionRead"]): string {
  if (read === "bullish") return "helix-pulse-stat--bull";
  if (read === "bearish") return "helix-pulse-stat--bear";
  return "helix-pulse-stat--neutral";
}

function directionLabel(read: HelixSessionPulse["directionRead"]): string {
  if (read === "bullish") return "Bullish";
  if (read === "bearish") return "Bearish";
  if (read === "mixed") return "Mixed";
  return "Unreadable";
}

export function HelixSessionPulseBar({
  flows,
  scopeLabel,
  className,
}: {
  flows: Parameters<typeof computeHelixSessionPulse>[0];
  scopeLabel?: string;
  className?: string;
}) {
  const pulse = useMemo(() => computeHelixSessionPulse(flows), [flows]);

  if (pulse.printCount === 0) return null;

  const readable = pulse.bullishPremium + pulse.bearishPremium;
  const bullPct =
    readable > 0 ? Math.round((pulse.bullishPremium / readable) * 100) : null;

  return (
    <div className={clsx("helix-session-pulse", className)} aria-label="Session flow pulse">
      <div className="helix-session-pulse-head">
        <span className="helix-session-pulse-kicker">Session pulse</span>
        {scopeLabel ? <span className="helix-session-pulse-scope">{scopeLabel}</span> : null}
      </div>
      <div className="helix-session-pulse-grid">
        <div className="helix-pulse-stat">
          <span className="helix-pulse-stat-label">Net prem</span>
          <span
            className={clsx(
              "helix-pulse-stat-value font-mono",
              pulse.netPremium > 0 && "text-bull",
              pulse.netPremium < 0 && "text-bear"
            )}
          >
            {pulse.netPremium >= 0 ? "+" : "−"}
            {fmtPremium(Math.abs(pulse.netPremium))}
          </span>
          <span className="helix-pulse-stat-meta">
            {fmtPremium(pulse.callPremium)} calls · {fmtPremium(pulse.putPremium)} puts
          </span>
        </div>

        <div className={clsx("helix-pulse-stat", directionTone(pulse.directionRead))}>
          <span className="helix-pulse-stat-label">Aggression read</span>
          <span className="helix-pulse-stat-value">{directionLabel(pulse.directionRead)}</span>
          <span className="helix-pulse-stat-meta">
            {bullPct != null ? `${bullPct}% bull / ${100 - bullPct}% bear` : "No ask-side data"}
          </span>
        </div>

        <div className="helix-pulse-stat">
          <span className="helix-pulse-stat-label">Whales</span>
          <span className="helix-pulse-stat-value font-mono">{pulse.whaleCount}</span>
          <span className="helix-pulse-stat-meta">$1M+ prints</span>
        </div>

        <div className="helix-pulse-stat">
          <span className="helix-pulse-stat-label">Velocity</span>
          <span className="helix-pulse-stat-value font-mono">{pulse.printsLast15m}</span>
          <span className="helix-pulse-stat-meta">prints / 15m</span>
        </div>

        <div className="helix-pulse-stat">
          <span className="helix-pulse-stat-label">New OI</span>
          <span className="helix-pulse-stat-value font-mono">{pulse.openingCount}</span>
          <span className="helix-pulse-stat-meta">provably opening</span>
        </div>

        {pulse.topTicker ? (
          <div className="helix-pulse-stat">
            <span className="helix-pulse-stat-label">Leader</span>
            <span className="helix-pulse-stat-value font-mono">{pulse.topTicker.ticker}</span>
            <span className="helix-pulse-stat-meta">{fmtPremium(pulse.topTicker.premium)}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
