"use client";

import { useEffect, useMemo, useState } from "react";
import { clsx } from "clsx";
import { PlayTerminal } from "./PlayTerminal";
import { sortPlaysForDeck } from "./deck-sort";
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
  // Display-only re-order: OPEN(top) → WATCH(middle) → CLOSED(bottom), stable within each band so the
  // incoming score rank is preserved per group. Never mutates `plays`.
  const sorted = useMemo(() => sortPlaysForDeck(plays), [plays]);

  const [selId, setSelId] = useState<string | null>(sorted[0]?.id ?? null);

  // Keep a valid selection as the polled list changes: default to the top (sorted) play; drop a stale
  // selection. Membership is checked against the same play objects, so ordering doesn't affect validity.
  useEffect(() => {
    if (sorted.length === 0) {
      if (selId !== null) setSelId(null);
    } else if (!sorted.some((p) => p.id === selId)) {
      setSelId(sorted[0]!.id);
    }
  }, [sorted, selId]);

  const selected = sorted.find((p) => p.id === selId) ?? null;

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
          {sorted.map((p, i) => (
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
                {/* Premium, not score — entry premium once entered/closed, else the live mark (would-be
                    entry) for a WATCH setup. Members trade the premium, not an internal score. */}
                <span className="nh-deck-prem" style={{ display: "block" }}>
                  {p.entry != null || p.mark != null
                    ? `$${(p.entry != null ? p.entry : p.mark!).toFixed(2)}`
                    : "—"}
                </span>
                <span className="nh-deck-premlab">PREM</span>
                <span className={clsx("nh-deck-pnl", (p.pnlPct ?? 0) > 0 && "nh-deck-pos", (p.pnlPct ?? 0) < 0 && "nh-deck-neg")} style={{ display: "block" }}>
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
