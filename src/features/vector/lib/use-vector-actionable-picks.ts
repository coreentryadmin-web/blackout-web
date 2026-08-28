"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FlowAlert } from "@/lib/api";
import type { VectorContractPick } from "./vector-contract-picks";
import type { VectorPlayEmit } from "./vector-play-engine";
import {
  mergeArchivedClosedPicks,
  partitionVectorPicksByLiveStatus,
  VECTOR_PICK_MAX_ACTIVE,
} from "./vector-pick-partition";
import { useVectorContractPicks } from "./use-vector-contract-picks";
import { useVectorPickLiveMonitor } from "./use-vector-pick-live-monitor";

export type VectorActionablePicks = {
  active: VectorContractPick[];
  closed: VectorContractPick[];
  loading: boolean;
};

/**
 * End-to-end Vector contract pick lifecycle:
 * 1. Rank a deep pool (8) from chain + play context every ~45s
 * 2. Live-monitor each pick (~1s) for Still buy / Caution / Don't buy
 * 3. When a pick closes (dont_buy), archive it for display and exclude its OCC from the next rank
 *    so a replacement promotes into the active 1–3 strip
 */
export function useVectorActionablePicks(
  ticker: string,
  emit: VectorPlayEmit | null,
  sessionFlows: readonly FlowAlert[],
  liveSession: boolean,
  paused = false
): VectorActionablePicks {
  const [excludeOccs, setExcludeOccs] = useState<string[]>([]);
  const [archivedClosed, setArchivedClosed] = useState<VectorContractPick[]>([]);
  const archivedOccsRef = useRef<Set<string>>(new Set());

  const play = emit?.play ?? null;
  const bias = play?.bias ?? null;
  // SETUP key for the archive reset — deliberately narrower than useVectorContractPicks' own
  // contextKey (which embeds live spot and re-fires on every price tick, by design, to trigger a
  // re-rank). Using that same key here would clear excludeOccs/archivedClosed on nearly every
  // tick — the exclusion never survives long enough to keep an invalidated pick out of the very
  // next pool fetch, and the Closed strip would flicker empty and repopulate continuously. This
  // key only changes on a genuinely NEW setup (new ticker, new directional bias, new thesis),
  // which is the only time throwing away the archive is correct.
  const setupKey = `${ticker}|${bias}|${play?.headline ?? ""}`;

  useEffect(() => {
    setExcludeOccs([]);
    setArchivedClosed([]);
    archivedOccsRef.current.clear();
  }, [setupKey]);

  const { picks: pool, loading } = useVectorContractPicks(
    ticker,
    emit,
    sessionFlows,
    liveSession,
    paused,
    excludeOccs
  );

  const monitored = useVectorPickLiveMonitor(ticker, emit, pool, liveSession, paused);

  const archiveClosed = useCallback((pick: VectorContractPick) => {
    const occ = pick.occ;
    if (!occ || archivedOccsRef.current.has(occ)) return;
    archivedOccsRef.current.add(occ);
    setArchivedClosed((prev) => [...prev, { ...pick, actionStatus: "dont_buy" }]);
    setExcludeOccs((prev) => (prev.includes(occ) ? prev : [...prev, occ]));
  }, []);

  useEffect(() => {
    if (paused || !liveSession) return;
    for (const pick of monitored) {
      if (pick.actionStatus === "dont_buy") {
        archiveClosed(pick);
      }
    }
  }, [monitored, archiveClosed, liveSession, paused]);

  return useMemo(() => {
    const partitioned = partitionVectorPicksByLiveStatus(monitored, VECTOR_PICK_MAX_ACTIVE);
    const merged = mergeArchivedClosedPicks(partitioned, archivedClosed);
    return { active: merged.active, closed: merged.closed, loading };
  }, [monitored, archivedClosed, loading]);
}
