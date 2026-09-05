"use client";

import { clsx } from "clsx";
import type { TerminalPlay } from "./types";
import { formatScanFreshnessEt } from "./swing-cockpit-utils";

const WORKING = new Set(["OPEN", "HOLD", "TRIM"]);
const WATCHING = new Set(["WATCH", "SKIP"]);

function CockpitStat({ label, value, tone }: { label: string; value: string; tone?: "up" | "down" }) {
  return (
    <div className="nh-deck-ck nh-deck-ck--compact">
      <span className="ckh">{label}</span>
      <span className={clsx("ckv", tone === "up" && "nh-deck-pos", tone === "down" && "nh-deck-neg")}>
        <b>{value}</b>
      </span>
    </div>
  );
}

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
  const buyCount = plays.filter(
    (p) =>
      p.swingEntryAction === "buy" ||
      p.swingEntryAction === "still_buy" ||
      (p.status === "WATCH" && p.recommendation === "BUY"),
  ).length;
  const pnls = working.map((p) => p.pnlPct).filter((n): n is number => n != null && Number.isFinite(n));
  const sessionPnl =
    pnls.length > 0 ? Math.round((pnls.reduce((a, b) => a + b, 0) / pnls.length) * 10) / 10 : null;
  const regime = plays.find((p) => p.regime)?.regime ?? null;
  const scanLabel = formatScanFreshnessEt(scanAsOf);

  return (
    <div className="nh-deck-cockpit nh-deck-cockpit--compact nh-swing-cockpit" aria-label="Swing command cockpit">
      <CockpitStat label="Open" value={String(openCount)} />
      <CockpitStat label="Buyable" value={String(buyCount)} />
      <CockpitStat label="Watch" value={String(watchCount)} />
      <CockpitStat
        label="Session P&L"
        value={sessionPnl != null ? `${sessionPnl >= 0 ? "+" : ""}${sessionPnl}%` : "—"}
        tone={sessionPnl != null ? (sessionPnl > 0 ? "up" : sessionPnl < 0 ? "down" : undefined) : undefined}
      />
      <CockpitStat label="30d WR" value={winRatePct != null ? `${winRatePct}%` : "—"} />
      <CockpitStat label="Scan" value={scanLabel} />
      {regime && <CockpitStat label="Regime" value={regime} />}
    </div>
  );
}
