"use client";

import type { TerminalPlay } from "./types";
import { formatScanFreshnessEt } from "./swing-cockpit-utils";

const WORKING = new Set(["OPEN", "HOLD", "TRIM"]);
const WATCHING = new Set(["WATCH", "SKIP"]);

export function SwingCockpitStrip({
  plays,
  scanAsOf,
  winRatePct,
}: {
  plays: readonly TerminalPlay[];
  scanAsOf: string | null;
  winRatePct: number | null;
}) {
  const working = plays.filter((p) => WORKING.has(p.status));
  const openCount = working.length;
  const watchCount = plays.filter((p) => WATCHING.has(p.status)).length;
  const buyCount = plays.filter((p) => p.status === "WATCH" && p.recommendation === "BUY").length;
  const pnls = working.map((p) => p.pnlPct).filter((n): n is number => n != null && Number.isFinite(n));
  const sessionPnl =
    pnls.length > 0 ? Math.round((pnls.reduce((a, b) => a + b, 0) / pnls.length) * 10) / 10 : null;
  const regime = plays.find((p) => p.regime)?.regime ?? null;
  const scanLabel = formatScanFreshnessEt(scanAsOf);

  return (
    <div className="nh-deck-cockpit nh-deck-cockpit--compact nh-swing-cockpit" aria-label="Swing command cockpit">
      <div className="nh-deck-cockpit__stat">
        <span className="k">Open</span>
        <span className="v">{openCount}</span>
      </div>
      <div className="nh-deck-cockpit__stat">
        <span className="k">Buyable</span>
        <span className="v">{buyCount}</span>
      </div>
      <div className="nh-deck-cockpit__stat">
        <span className="k">Watch</span>
        <span className="v">{watchCount}</span>
      </div>
      <div className="nh-deck-cockpit__stat">
        <span className="k">Session P&L</span>
        <span className={`v ${sessionPnl != null && sessionPnl > 0 ? "nh-deck-pos" : sessionPnl != null && sessionPnl < 0 ? "nh-deck-neg" : ""}`}>
          {sessionPnl != null ? `${sessionPnl >= 0 ? "+" : ""}${sessionPnl}%` : "—"}
        </span>
      </div>
      <div className="nh-deck-cockpit__stat">
        <span className="k">30d WR</span>
        <span className="v">{winRatePct != null ? `${winRatePct}%` : "—"}</span>
      </div>
      <div className="nh-deck-cockpit__stat">
        <span className="k">Scan</span>
        <span className="v">{scanLabel}</span>
      </div>
      {regime && (
        <div className="nh-deck-cockpit__stat">
          <span className="k">Regime</span>
          <span className="v">{regime}</span>
        </div>
      )}
    </div>
  );
}
