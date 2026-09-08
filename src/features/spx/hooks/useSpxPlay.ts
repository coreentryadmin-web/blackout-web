"use client";

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { fetchSpxPlay } from "@/lib/api";
import type { SpxPlayPayload } from "@/features/spx/lib/spx-play-engine";
import {
  clearSessionCacheKey,
  readSessionCache,
  todayEtYmdClient,
  writeSessionCache,
} from "@/lib/session-cache";
import { shouldPersistPlayPayload } from "@/features/spx/hooks/useStablePlayConfirmations";
import { SPX_PLAY_POLL_MS } from "@/features/spx/lib/spx-desk-poll-ms";

const PLAY_MS = SPX_PLAY_POLL_MS;
const PLAY_CACHE_KEY = "spx-play";
const PLAY_CACHE_MAX_AGE_MS = 12 * 60 * 60 * 1000;

/** Exported for unit tests — client play SWR merges session cache on poll gaps. */
export function mergePlayWithCache(
  fresh: SpxPlayPayload | undefined,
  cached: SpxPlayPayload | undefined
): SpxPlayPayload | null {
  if (!fresh && !cached) return null;
  if (!fresh) return cached ?? null;
  if (!cached) return fresh;

  const freshHasLayer = Boolean(fresh.confirmations?.checks?.length);
  const cachedHasLayer = Boolean(cached.confirmations?.checks?.length);

  if (!freshHasLayer && cachedHasLayer) {
    // Fresh SCANNING has no confirmation layer — never resurrect a prior WATCH/BUY layer.
    if (fresh.action === "SCANNING") return fresh;

    const sameDirection =
      fresh.direction != null &&
      cached.direction != null &&
      fresh.direction === cached.direction;
    // Never use cached confirmations when direction flipped — stale confirmations
    // from the opposite direction would mislead the user for one poll cycle.
    const directionFlipped =
      fresh.direction != null &&
      cached.direction != null &&
      fresh.direction !== cached.direction;

    if (!sameDirection || directionFlipped) return fresh;

    return {
      ...fresh,
      confirmations: cached.confirmations,
      technicals: fresh.technicals ?? cached.technicals,
      mtf: fresh.mtf ?? cached.mtf,
      watch: fresh.watch ?? cached.watch,
      telemetry: fresh.telemetry ?? cached.telemetry,
      gates: {
        ...fresh.gates,
        blocks: fresh.gates.blocks.length ? fresh.gates.blocks : cached.gates.blocks,
        warnings: fresh.gates.warnings.length ? fresh.gates.warnings : cached.gates.warnings,
        play_idea: fresh.gates.play_idea ?? cached.gates.play_idea,
      },
    };
  }

  return fresh;
}

export function clearPlayCache(): void {
  clearSessionCacheKey(PLAY_CACHE_KEY);
}

export function useSpxPlay(sessionActive = true) {
  const sessionDate = todayEtYmdClient();

  // MUST start undefined, not a lazy initializer reading sessionStorage — that runs during
  // the render React uses for hydration reconciliation, and readSessionCache() returns
  // undefined on the server (no `window`) but a real cached play on the client's very first
  // paint whenever the member reloaded mid-session (onSuccess below persists on every poll
  // while a play is live). `play` below folds cachedPayload into the merged result, so a
  // divergent cachedPayload on that first render is a guaranteed React #418 hydration
  // mismatch — the same defect class fixed in useMergedDesk.ts's deskStable ref, here as a
  // useState lazy initializer instead of a useRef initializer. Hydrated one tick later via
  // the effect below instead — a normal post-mount re-render, not part of hydration.
  const [cachedPayload, setCachedPayload] = useState<SpxPlayPayload | undefined>(undefined);

  useEffect(() => {
    if (!sessionActive) {
      clearPlayCache();
      setCachedPayload(undefined);
      return;
    }
    const cached = readSessionCache<SpxPlayPayload>(PLAY_CACHE_KEY, PLAY_CACHE_MAX_AGE_MS);
    if (cached) setCachedPayload(cached);
  }, [sessionActive]);

  const { data, isValidating, isLoading } = useSWR(
    sessionActive ? `spx-play:${sessionDate}` : null,
    fetchSpxPlay,
    {
      refreshInterval: sessionActive ? PLAY_MS : 0,
      refreshWhenHidden: false,
      refreshWhenOffline: false,
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
      keepPreviousData: true,
      dedupingInterval: Math.max(800, PLAY_MS - 500),
      // Deliberately no SWR "initial data from cache" option here — it would reintroduce the
      // same hydration hazard cachedPayload above was just fixed to avoid (SWR treats it as
      // the initial `data`, so a value that exists client-side-only would diverge from the
      // server's render the same way). Not needed either — cachedPayload already carries the
      // cached play into `play` via mergePlayWithCache below, one tick after mount.
      onSuccess: (payload) => {
        if (!sessionActive || !payload || !shouldPersistPlayPayload(payload)) return;

        writeSessionCache(PLAY_CACHE_KEY, payload, sessionDate);
        // Update state cache so useMemo uses fresh data without a hot-path read
        setCachedPayload(payload);
      },
    }
  );

  const play = useMemo(() => {
    if (!sessionActive) return null;
    return mergePlayWithCache(data, cachedPayload);
  }, [data, sessionActive, cachedPayload]);

  return {
    play,
    playLoading: sessionActive && isLoading && !play,
    playRefreshing: sessionActive && isValidating && Boolean(play),
  };
}
