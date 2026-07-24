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
 * transport (mirrors vector/stream). It auto-reconnects on drop; while the lane is NOT open (its own
 * CONNECTING reconnect window, or a terminal CLOSED the browser won't retry) a REST fallback polls
 * `/api/market/zerodte/marks` every ~2.5s — the cadence the route headers document as the client
 * fallback — and feeds the SAME overlay map, so a dropped SSE lane degrades to ~2.5s marks/greeks
 * instead of the 5s board poll (or vanished greeks). A healthy OPEN stream short-circuits the poll every
 * tick, so the two never double-fetch. Either way this is a pure enhancement over the board poll — never
 * a hard dependency.
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

const STREAM_URL = "/api/market/zerodte/marks/stream";
/** REST fallback endpoint — the SAME bounded live-marks payload the stream pushes
 *  (one shared server build; see marks/route.ts). */
const POLL_URL = "/api/market/zerodte/marks";
/** Fallback poll cadence while SSE is down — the "polled at 2–3s" the route headers
 *  (marks/stream/route.ts, marks/route.ts) document as the client fallback contract. */
const POLL_MS = 2_500;
/** EventSource.readyState === OPEN (0 CONNECTING · 1 OPEN · 2 CLOSED). A local constant
 *  so the gate below is testable without a browser EventSource. */
const SSE_READY_OPEN = 1;

/** Build the OCC-keyed overlay map from a live-marks payload — the ONE shaping of the
 *  hook's state, called by BOTH the SSE frame and the REST fallback so the two lanes feed
 *  structurally identical maps (same keys, same LiveMarkRow objects, so the >5s `stale`
 *  drop in overlayLiveMarks applies to a polled row exactly as to a pushed one). Returns
 *  null for an absent/empty (idle) payload — the caller treats that as a NO-OP and leaves
 *  the last good marks in place, mirroring the SSE handler's rows.length===0 skip so a
 *  between-frames idle poll can't blank a populated terminal. */
export function marksMapFromPayload(payload: LiveMarksPayload): Map<string, LiveMarkRow> | null {
  const rows = payload?.marks;
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const next = new Map<string, LiveMarkRow>();
  for (const r of rows) if (r?.occ) next.set(r.occ, r);
  return next;
}

/** The REST fallback's activation gate: poll ONLY while the SSE lane is not OPEN — its own
 *  CONNECTING reconnect window, or a terminal CLOSED the browser won't auto-retry. A healthy
 *  OPEN stream returns false so the poll stands down and never double-fetches alongside the
 *  ~1s push. Pure (takes the numeric readyState) so it unit-tests without a live EventSource. */
export function restFallbackShouldPoll(sseReadyState: number): boolean {
  return sseReadyState !== SSE_READY_OPEN;
}

/** Latest live-marks row keyed by OCC symbol; empty until the first frame lands (or if SSE is unavailable). */
export function useZeroDteLiveMarks(enabled = true): Map<string, LiveMarkRow> {
  const [marks, setMarks] = useState<Map<string, LiveMarkRow>>(() => new Map());

  useEffect(() => {
    if (!enabled || typeof window === "undefined" || typeof EventSource === "undefined") return;

    let closed = false;
    let pollInflight = false;

    const applyPayload = (payload: LiveMarksPayload) => {
      if (closed) return;
      const next = marksMapFromPayload(payload);
      if (next) setMarks(next);
    };

    // Same-origin: EventSource sends the __session cookie automatically, so the premium + nighthawk
    // launch gate on the route is satisfied by the signed-in member already viewing the deck.
    const es = new EventSource(STREAM_URL);

    es.onmessage = (ev) => {
      try {
        applyPayload(JSON.parse(ev.data) as LiveMarksPayload);
      } catch {
        // A single malformed frame is harmless — the next ~1s tick recovers.
      }
    };

    es.onerror = () => {
      // The browser auto-reconnects while readyState is CONNECTING — leave the last marks in place so a
      // 1s blip doesn't flicker the terminal. But if the connection is fully CLOSED, drop every mark so
      // the deck falls back to the REST poll / board poll instead of freezing the last frame on screen.
      // The REST fallback below (readyState !== OPEN) then repopulates within one POLL_MS tick.
      if (es.readyState === EventSource.CLOSED) setMarks(new Map());
    };

    // REST fallback (the route headers' documented contract: "Client fallback: GET
    // /api/market/zerodte/marks polled at 2–3s"). Fires ONLY while the SSE lane is not OPEN
    // (restFallbackShouldPoll) — the CONNECTING reconnect window and the terminal CLOSED state
    // the browser won't retry — and feeds the SAME map via applyPayload. When SSE reopens,
    // readyState flips to OPEN and this stands down on its own next tick.
    const pollId = setInterval(() => {
      if (closed || pollInflight || !restFallbackShouldPoll(es.readyState)) return;
      pollInflight = true;
      fetch(POLL_URL, { cache: "no-store", credentials: "same-origin" })
        .then((r) => (r.ok ? (r.json() as Promise<LiveMarksPayload>) : null))
        .then((payload) => {
          if (payload) applyPayload(payload);
        })
        .catch(() => {
          // Best-effort: a failed poll just waits for the next tick (or SSE recovery).
        })
        .finally(() => {
          pollInflight = false;
        });
    }, POLL_MS);

    return () => {
      closed = true;
      clearInterval(pollId);
      es.close();
    };
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
    // Skip a STALE row: the server flags a row stale when its quote is older than the mark-stale window
    // (>5s), yet still computes a live_pnl_pct off that old mark. Overlaying it would REPLACE the fresher
    // 5s board-poll mark/P&L with an older number under a "● LIVE" badge — the exact stale-shown-as-fresh
    // failure this lane exists to kill (and if the SSE lane dies mid-session its last frame would freeze
    // on screen, masking the still-advancing board poll). When the live row is stale, keep board values.
    if (!row || row.stale) return p;
    return {
      ...p,
      mark: row.mark ?? p.mark,
      // Same percent scale as the board (both from pinnedLivePnlPct against the pinned entry premium).
      pnlPct: row.live_pnl_pct ?? p.pnlPct,
      greeks: row.greeks ?? p.greeks,
    };
  });
}
