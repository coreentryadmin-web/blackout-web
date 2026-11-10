"use client";

import { clsx } from "clsx";
import type { TerminalPlay } from "./types";
import { formatScanFreshnessEt } from "./swing-cockpit-utils";
import { blendedTrimPnlPct } from "@/lib/zerodte/terminal-ladder";

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
  // BUG FIX (Ask Largo standing mandate — live-audit follow-up to #7834/#7840, 2026-11-09): this
  // "Session P&L" cockpit stat used to average raw `p.pnlPct` straight off every OPEN/HOLD/TRIM
  // play — for a SWING row with an already-banked trim tranche, `p.pnlPct` is only the return on
  // the still-open runner leg (livePnlPct, live-plays.ts), never the blended whole-position
  // figure. #7834 fixed the verdict-band badge and #7840 fixed TradeExcursionGraphic's "Current"
  // stat for the SAME per-play contradiction; this is the third, cockpit-level call site #7840's
  // own hand-back flagged as the next round's target — a different aggregation shape (an average
  // across many plays' headline figures, not one play's single figure), but the identical root
  // cause: a within-panel number next to the per-card blended badges that disagreed with them.
  // `blendedTrimPnlPct` (terminal-ladder.ts) is the same shared helper #7834/#7840 already use,
  // scoped to `horizon === "SWING"` only for the same reason those two fixes scoped it that way —
  // a 0DTE TRIM row's `pnlPct` comes from a different, unaudited server-side path
  // (reconcileLedgerLivePnlPct) this fix does not touch. It no-ops (returns null, falling back to
  // the raw figure) whenever nothing has fired yet, so a cockpit with no banked trims anywhere is
  // provably unaffected.
  const pnls = working
    .map((p) =>
      p.horizon === "SWING"
        ? blendedTrimPnlPct(p.pnlPct, p.exitPolicy?.trim_levels) ?? p.pnlPct
        : p.pnlPct,
    )
    .filter((n): n is number => n != null && Number.isFinite(n));
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
