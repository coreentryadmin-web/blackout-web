"use client";

import { useEffect, useMemo, useState } from "react";
import { pinnedLivePnlPct } from "@/lib/zerodte/marks-math";
import type { TerminalPlay } from "./types";
import { latchLiveExcursion } from "./use-live-marks";

export type LegacyOptionMarkRow = {
  occ: string;
  mark: number | null;
  bid: number | null;
  ask: number | null;
  asof: string | null;
  stale: boolean;
};

const POLL_MS = 2_500;

/** Poll live option marks for Legacy play OCCs (~2.5s). Empty map until first frame. */
export function useLegacyOptionMarks(occs: string[], enabled = true): Map<string, LegacyOptionMarkRow> {
  const key = occs.join(",");
  const unique = useMemo(
    () => (enabled ? [...new Set(occs.map((o) => o.toUpperCase()).filter(Boolean))] : []),
    [key, enabled],
  );
  const [marks, setMarks] = useState<Map<string, LegacyOptionMarkRow>>(() => new Map());

  useEffect(() => {
    if (!enabled || unique.length === 0) {
      setMarks(new Map());
      return;
    }

    let cancelled = false;
    let inFlight = false;

    const poll = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const r = await fetch(
          `/api/market/nighthawk/legacy-marks?occs=${encodeURIComponent(unique.join(","))}`,
          { cache: "no-store", credentials: "same-origin" },
        );
        if (!r.ok || cancelled) return;
        const data = (await r.json()) as { marks?: LegacyOptionMarkRow[] };
        if (!Array.isArray(data.marks) || cancelled) return;
        const next = new Map<string, LegacyOptionMarkRow>();
        for (const row of data.marks) {
          if (row?.occ) next.set(row.occ.toUpperCase(), row);
        }
        if (next.size > 0) setMarks(next);
      } catch {
        // best-effort — next tick recovers
      } finally {
        inFlight = false;
      }
    };

    void poll();
    const id = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [key, enabled, unique]);

  return marks;
}

/** Overlay live OPTION marks onto Legacy plays — populates mark / pnlPct / peak / trough when
 *  a pinned entry premium exists. Stock-level fields from overlayLegacyQuotes are preserved. */
export function overlayLegacyOptionMarks(
  plays: TerminalPlay[],
  marks: Map<string, LegacyOptionMarkRow>,
): TerminalPlay[] {
  if (marks.size === 0) return plays;

  return plays.map((p) => {
    const occ = p.occ?.toUpperCase();
    if (!occ) return p;
    const row = marks.get(occ);
    if (!row || row.mark == null || !Number.isFinite(row.mark) || row.mark <= 0) return p;
    // Use REST-backed marks even when WS is quiet (weekly names). Stale only affects freshness label.

    const entryPrem =
      typeof p.entryCostPerContract === "number" && p.entryCostPerContract > 0
        ? p.entryCostPerContract
        : null;
    if (entryPrem == null) {
      return { ...p, mark: row.mark ?? p.mark, markAsOf: row.asof ?? p.markAsOf };
    }

    // BUG FIX (2026-10-31, Ask Largo standing mandate): a WATCH play has not been entered yet —
    // status stays WATCH from publish (~8pm ET) until the next morning's 9:15am ET morning-confirm
    // cron runs, and stays WATCH afterward for DEGRADED/UNVERIFIED verdicts too (terminalPlayFromEdition,
    // adapters.ts — only INVALIDATED/severe-pulled maps to SKIP, only CONFIRMED maps to OPEN). SKIP means
    // invalidated/pulled. `entryCostPerContract` is the PUBLISHED entry premium, not a real fill, so this
    // overlay used to compute a live premium % against it with NO status check at all — presenting a
    // not-yet-actionable (or invalidated) setup as an open position with a real, colored P&L, exactly the
    // "never WATCH" invariant legacyVectorStatus's own status badge already protects (legacy-board-table-
    // utils.ts) but that this overlay bypassed by writing straight into `premiumPct`/`execPnlPct`, which
    // feed the board's "Premium vs entry" column (legacy-board-columns.tsx) and the detail panel's hero
    // P&L (legacyPrimaryPnlPct, legacy-primary-pnl.ts) with no status gate of their own. Mirrors
    // terminalPlayFromHorizon's own WATCH/SKIP gate on pnlPct/execMark/execPnlPct (adapters.ts) — `mark`/
    // `markAsOf` stay live (same as that precedent) so the "Entry → mark" display and freshness label
    // keep working; only the computed PERCENTAGE return is withheld. `peak`/`trough` fall out of this for
    // free: `latchLiveExcursion` with a null `pnlPct` just carries over the play's existing (always-null,
    // pre-overlay) peak/trough rather than latching a new excursion.
    const notYetEntered = p.status === "WATCH" || p.status === "SKIP";

    const mark = row.mark ?? p.mark ?? null;
    const pnlPct = notYetEntered ? null : pinnedLivePnlPct(entryPrem, mark);
    const execPnlPct = notYetEntered ? null : pinnedLivePnlPct(entryPrem, row.bid ?? null);
    const latch = latchLiveExcursion({ ...p, mark, pnlPct }, pnlPct);

    return {
      ...p,
      mark,
      pnlPct,
      execMark: notYetEntered ? null : (row.bid ?? p.execMark),
      execPnlPct,
      markAsOf: row.asof ?? p.markAsOf,
      markIsSync: row.stale,
      peak: latch.peak,
      trough: latch.trough,
      exitPolicy: latch.exitPolicy,
    };
  });
}
