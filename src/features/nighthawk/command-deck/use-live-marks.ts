"use client";

import { useEffect, useState } from "react";
import type { TerminalPlay } from "./types";

/**
 * The "no lag" path for the 0DTE Command Deck.
 *
 * The board poll (SWR, ~5s) carries entry/mark/P&L, but that's up to 5s stale for a fast-moving 0DTE
 * contract. The platform already pushes a ~1s SSE lane of live per-contract marks + P&L + greeks
 * (`/api/market/zerodte/marks/stream`, built in one place server-side against the PINNED entry — see
 * src/lib/zerodte/live-marks.ts + #1017 for greeks). This hook subscribes to that lane and returns the
 * latest row per OCC, so the terminal's mark / P&L / Δ Γ Θ V IV update ~1s and flash on real change.
 *
 * EventSource (not WS) because browsers can't hold a WS through the agent proxy — SSE is the established
 * transport (mirrors vector/stream). It auto-reconnects on drop; if it never connects, the 5s board poll
 * still carries (slower) mark/P&L, so this is a pure enhancement — never a hard dependency.
 */
export interface LiveMarkGreeks {
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
  iv: number | null;
}

export interface LiveMarkRow {
  ticker: string;
  occ: string;
  mark: number | null;
  live_pnl_pct: number | null;
  stale: boolean;
  greeks: LiveMarkGreeks | null;
}

interface LiveMarksPayload {
  available?: boolean;
  idle?: boolean;
  marks?: LiveMarkRow[];
}

/** Latest live-marks row keyed by OCC symbol; empty until the first frame lands (or if SSE is unavailable). */
export function useZeroDteLiveMarks(enabled = true): Map<string, LiveMarkRow> {
  const [marks, setMarks] = useState<Map<string, LiveMarkRow>>(() => new Map());

  useEffect(() => {
    if (!enabled || typeof window === "undefined" || typeof EventSource === "undefined") return;

    // Same-origin: EventSource sends the __session cookie automatically, so the premium + nighthawk
    // launch gate on the route is satisfied by the signed-in member already viewing the deck.
    const es = new EventSource("/api/market/zerodte/marks/stream");

    es.onmessage = (ev) => {
      try {
        const payload = JSON.parse(ev.data) as LiveMarksPayload;
        const rows = payload?.marks;
        if (!Array.isArray(rows) || rows.length === 0) return;
        const next = new Map<string, LiveMarkRow>();
        for (const r of rows) if (r?.occ) next.set(r.occ, r);
        setMarks(next);
      } catch {
        // A single malformed frame is harmless — the next ~1s tick recovers.
      }
    };

    // On error the browser retries automatically (SSE semantics); nothing to do but let it — and never
    // throw, so a dropped lane silently falls back to the board poll rather than breaking the deck.
    return () => es.close();
  }, [enabled]);

  return marks;
}

/** Overlay the freshest live-marks row onto each play by OCC: mark, P&L and greeks come from the ~1s SSE
 *  frame while everything else (thesis/gates/allocation) rides the slower board poll. A play with no live
 *  row keeps its board values, so this is a pure enhancement — never a regression when the lane is cold. */
export function overlayLiveMarks(plays: TerminalPlay[], marks: Map<string, LiveMarkRow>): TerminalPlay[] {
  if (marks.size === 0) return plays;
  return plays.map((p) => {
    const row = p.occ ? marks.get(p.occ) : undefined;
    if (!row) return p;
    return {
      ...p,
      mark: row.mark ?? p.mark,
      // Same percent scale as the board (both from pinnedLivePnlPct against the pinned entry premium).
      pnlPct: row.live_pnl_pct ?? p.pnlPct,
      greeks: row.greeks ?? p.greeks,
    };
  });
}
