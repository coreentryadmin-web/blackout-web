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
import { vectorPickArchiveResetKey } from "./vector-pick-context-key";
import { effectivePickBias } from "./vector-pick-effective-bias";

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
  const [poolRefetchToken, setPoolRefetchToken] = useState(0);
  const archivedOccsRef = useRef<Set<string>>(new Set());
  const poolExhaustionSigRef = useRef<string>("");

  const play = emit?.play ?? null;
  // BUG FIX (round 306 audit): a committed `pivot` play's raw `play.bias` stays "neutral" by
  // design even after spot clears the gamma flip and commits to a real direction (see
  // effectivePickBias's own header, and the near-identical bugs already fixed in
  // contract-picks/live/route.ts and vector-pick-sweep.ts for the exact same raw-vs-effective
  // confusion). `useVectorContractPicks` already re-derives the EFFECTIVE bias to decide what to
  // fetch (`effectivePickBias(play, emit?.spot, emit?.gammaFlip) ?? play.bias`) — but this sibling
  // hook's own archive-reset key kept using the raw field, so when a pivot play's committed
  // direction flips (long -> short or back), `contextKey` can stay byte-identical (callWall/
  // putWall/conviction/headline do not change on a flip — the headline text is the static
  // "pivot at the N gamma flip — long above / short below", not direction-specific) and the
  // archive-reset effect below never fires. `excludeOccs`/`archivedClosed` then carry stale
  // state from the OPPOSITE direction's contracts forward: `mergeArchivedClosedPicks` merges
  // those stale "dont_buy" entries into the CURRENT `closed` list indefinitely, so a member sees
  // leftover call picks archived under a newly-short setup (or vice versa) until some unrelated
  // field happens to change the key. Mirroring the already-correct sibling computation here
  // closes the gap at its source rather than leaving it to coincidence.
  const bias = play ? effectivePickBias(play, emit?.spot, emit?.gammaFlip) ?? play.bias : null;
  const contextKey = vectorPickArchiveResetKey(emit, sessionFlows.length, bias);

  useEffect(() => {
    setExcludeOccs([]);
    setArchivedClosed([]);
    archivedOccsRef.current.clear();
  }, [ticker, contextKey]);

  const { picks: pool, loading } = useVectorContractPicks(
    ticker,
    emit,
    sessionFlows,
    liveSession,
    paused,
    excludeOccs,
    poolRefetchToken
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

  useEffect(() => {
    if (paused || !liveSession || loading || !pool.length) return;
    const activeCount = monitored.filter((p) => p.actionStatus !== "dont_buy").length;
    const poolOccs = pool.map((p) => p.occ).filter(Boolean).join(",");
    const sig = `${excludeOccs.join(",")}|${poolOccs}`;
    if (
      activeCount < VECTOR_PICK_MAX_ACTIVE &&
      excludeOccs.length >= pool.length &&
      pool.every((p) => p.occ && excludeOccs.includes(p.occ)) &&
      poolExhaustionSigRef.current !== sig
    ) {
      poolExhaustionSigRef.current = sig;
      setPoolRefetchToken((t) => t + 1);
    }
  }, [monitored, pool, excludeOccs, loading, liveSession, paused]);

  return useMemo(() => {
    const partitioned = partitionVectorPicksByLiveStatus(monitored, VECTOR_PICK_MAX_ACTIVE);
    const merged = mergeArchivedClosedPicks(partitioned, archivedClosed);
    return { active: merged.active, closed: merged.closed, loading };
  }, [monitored, archivedClosed, loading]);
}
