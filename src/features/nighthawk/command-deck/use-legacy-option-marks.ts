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
    if (!row || row.stale) return p;

    const entryPrem =
      typeof p.entryCostPerContract === "number" && p.entryCostPerContract > 0
        ? p.entryCostPerContract
        : null;
    if (entryPrem == null) {
      return { ...p, mark: row.mark ?? p.mark, markAsOf: row.asof ?? p.markAsOf };
    }

    const mark = row.mark ?? p.mark ?? null;
    const pnlPct = pinnedLivePnlPct(entryPrem, mark);
    const execPnlPct = pinnedLivePnlPct(entryPrem, row.bid ?? null);
    const latch = latchLiveExcursion({ ...p, mark, pnlPct }, pnlPct);

    return {
      ...p,
      mark,
      pnlPct,
      execMark: row.bid ?? p.execMark,
      execPnlPct,
      markAsOf: row.asof ?? p.markAsOf,
      markIsSync: false,
      peak: latch.peak,
      trough: latch.trough,
      exitPolicy: latch.exitPolicy,
    };
  });
}
