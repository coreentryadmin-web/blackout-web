"use client";

import { clsx } from "clsx";
import { condorTent } from "@/lib/zerodte/condor-render";
import { zerodteTimeStopEtLabel } from "@/lib/zerodte/plan";
import { timeStopClock } from "@/lib/zerodte/terminal-ladder";
import { etNowParts } from "@/features/nighthawk/lib/session";
import type { DeckCondor, TerminalPlay } from "./types";

function tentGeomOf(c: DeckCondor) {
  return {
    spot: c.spot,
    short_put: c.shortPut,
    long_put: c.longPut,
    short_call: c.shortCall,
    long_call: c.longCall,
    wing_pts: c.wingPts,
    net_credit: c.netCredit,
    max_loss: c.maxLoss,
    breach_lower: c.breachLower,
    breach_upper: c.breachUpper,
    est_win_rate: c.winRate,
    est_intraday_breach_pct: c.breachRatePct,
  };
}

/** Iron-condor tent gauge — shared by tabbed Manage panel and 0DTE Command v2. */
export function CondorPanel({ play }: { play: TerminalPlay }) {
  const c = play.condor;
  if (!c) {
    return (
      <div className="nh-deck-recnote" style={{ marginTop: 4 }}>
        Credit iron condor — profit comes from the underlying pinning between the short strikes
        (premium decay), not a rising long premium. The 4-leg geometry wasn&apos;t pinned on this row,
        so the tent gauge is unavailable.
      </div>
    );
  }
  const tent = condorTent(tentGeomOf(c), c.spot);
  const pts = (n: number | null): string => (n == null ? "—" : n.toFixed(0));
  return (
    <div className="nh-deck-condor">
      <div className="nh-deck-lab" style={{ marginTop: 4 }}>
        Iron condor — sell the range · WIN if {c.spotIsLive ? "spot" : "close"} stays between the shorts
      </div>

      <div className="nh-deck-tent">
        <div className="wing lo">▽ {c.longPut}</div>
        <div className={clsx("tent-band", tent.breached && "brk")}>
          <span className="edge lo">{c.breachLower}</span>
          <span className="edge hi">{c.breachUpper}</span>
          {tent.spotFrac != null ? (
            <span
              className={clsx("spot", tent.breached && "brk")}
              style={{ left: `${Math.round(tent.spotFrac * 100)}%` }}
            >
              <span className="dot" />
              <span className="lbl">
                {c.spot != null ? c.spot.toFixed(0) : "?"}
                {c.spotIsLive ? "" : " ∗"}
              </span>
            </span>
          ) : null}
        </div>
        <div className="wing hi">△ {c.longCall}</div>
      </div>
      {!c.spotIsLive && c.spot != null && (
        <div className="nh-deck-recnote">∗ commit-time spot — live underlying not on this refresh.</div>
      )}
      {tent.spotFrac == null && (
        <div className="nh-deck-recnote">Underlying price unavailable — showing the sold range only.</div>
      )}

      <div className="nh-deck-breach">
        <div className={clsx("side dn", (tent.roomDown ?? 1) <= 0 && "brk")}>
          <span className="k">↓ to put breach</span>
          <span className="v">{pts(tent.roomDown)} pt</span>
        </div>
        <div className={clsx("side up", (tent.roomUp ?? 1) <= 0 && "brk")}>
          <span className="k">↑ to call breach</span>
          <span className="v">{pts(tent.roomUp)} pt</span>
        </div>
      </div>

      <div className="nh-deck-meta" style={{ marginTop: 12 }}>
        <div>
          <span className="k">Net credit</span>
          <span className="v">{c.netCredit != null ? `$${c.netCredit.toFixed(0)}` : "—"}</span>
        </div>
        <div>
          <span className="k">Defined max loss</span>
          <span className="v">{c.maxLoss != null ? `$${c.maxLoss.toFixed(0)}` : "—"}</span>
        </div>
        <div>
          <span className="k">Wings</span>
          <span className="v">{c.wingPts.toFixed(0)} pt</span>
        </div>
        <div>
          <span className="k">Range</span>
          <span className="v">{tent.widthPts.toFixed(0)} pt</span>
        </div>
      </div>

      {c.breachRatePct != null && (
        <div className={clsx("nh-deck-wrline", tent.breached && "brk")}>
          <span className="br">Intraday breach rate · {c.breachRatePct.toFixed(0)}%</span>
        </div>
      )}
      <div className="nh-deck-recnote">
        Negative skew: a small credit on most days, a DEFINED loss on a breakout. High WR is not edge on
        its own — the credit, the breach stop, and small size are.{" "}
        {tent.breached
          ? "Range BREACHED — the defended pin failed; the loss is capped at the wing."
          : "Range holding — decay is working for you."}
      </div>
    </div>
  );
}

/** Countdown to the hard time-stop + session-decay bar (09:30→exit elapsed). */
export function TimeStopClock({ nowMs }: { nowMs: number }) {
  const exitLabel = zerodteTimeStopEtLabel();
  void nowMs;
  const { hour, minute } = etNowParts();
  const clock = timeStopClock(hour * 60 + minute);
  return (
    <div className={clsx("nh-deck-clock", clock.past_time_stop && "past")}>
      <div className="row">
        <span className="lab">◷ THETA / TIME-STOP</span>
        <span className={clsx("val", clock.minutes_remaining <= 30 && "warn")}>
          {clock.past_time_stop ? `TIME STOP — flat by ${exitLabel}` : `${clock.label} to ${exitLabel} ET`}
        </span>
      </div>
      <div className="decay">
        <i style={{ width: `${Math.round(clock.elapsed_frac * 100)}%` }} />
      </div>
    </div>
  );
}
