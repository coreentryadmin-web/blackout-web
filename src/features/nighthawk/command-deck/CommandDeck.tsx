"use client";

import { useEffect, useState } from "react";
import { clsx } from "clsx";
import { PlayTerminal } from "./PlayTerminal";
import type { TerminalPlay } from "./types";

/**
 * COMMAND DECK — the two-panel matrix experience for every board (0DTE / Swings / LEAPS / Legacy).
 * Left: the ranked plays list. Right: the terminal that breaks the selected play down (Thesis / Management /
 * PnL) and streams live. One component, fed a TerminalPlay[] by each board's adapter — the whole point of the
 * HorizonPlay/explainability/allocation unification.
 */
export function CommandDeck({
  plays,
  laneLabel,
  emptyHint,
  degraded = false,
}: {
  plays: TerminalPlay[];
  laneLabel: string;
  /** Shown when the lane has no plays (e.g. Swings/LEAPS before discovery, or a flat 0DTE tape). */
  emptyHint?: string;
  /** True when the board data is unavailable/degraded — renders a distinct warning so an outage is never
   *  painted as a calm flat tape (9-3). */
  degraded?: boolean;
}) {
  const [selId, setSelId] = useState<string | null>(plays[0]?.id ?? null);

  // Keep a valid selection as the polled list changes: default to the first play; drop a stale selection.
  useEffect(() => {
    if (plays.length === 0) {
      if (selId !== null) setSelId(null);
    } else if (!plays.some((p) => p.id === selId)) {
      setSelId(plays[0]!.id);
    }
  }, [plays, selId]);

  const selected = plays.find((p) => p.id === selId) ?? null;

  return (
    <div className="nh-deck">
      <div className="nh-deck-left">
        <div className="nh-deck-lh"><span>{laneLabel}</span><span>{degraded ? "data down" : `${plays.length} plays`}</span></div>
        <div className="nh-deck-rows">
          {degraded && (
            <div className="nh-deck-degraded" role="alert">⚠ Board data unavailable — retrying</div>
          )}
          {plays.length === 0 && (
            <div className="nh-deck-empty">{emptyHint ?? "No plays right now."}</div>
          )}
          {plays.map((p, i) => (
            <button
              key={p.id}
              type="button"
              className={clsx("nh-deck-row", p.id === selId && "sel")}
              onClick={() => setSelId(p.id)}
            >
              <span className="nh-deck-rk">{i + 1}</span>
              <span>
                <span>
                  <span className="nh-deck-tk">{p.ticker}</span>{" "}
                  <span className={clsx("nh-deck-dp", p.direction === "LONG" ? "long" : "short")}>{p.direction}</span>
                </span>
                <span className="nh-deck-sub" style={{ display: "block" }}>{p.contract}</span>
                <span className={clsx("nh-deck-st", p.status)}>{p.status}</span>
              </span>
              <span className="nh-deck-rr">
                <span className="nh-deck-score" style={{ display: "block" }}>{p.score}</span>
                <span className={clsx("nh-deck-pnl", (p.pnlPct ?? 0) > 0 && "nh-deck-pos", (p.pnlPct ?? 0) < 0 && "nh-deck-neg")}>
                  {p.pnlPct != null && p.pnlPct !== 0 ? `${p.pnlPct > 0 ? "+" : ""}${p.pnlPct}%` : "—"}
                </span>
              </span>
            </button>
          ))}
        </div>
      </div>
      <PlayTerminal play={selected} />
    </div>
  );
}
