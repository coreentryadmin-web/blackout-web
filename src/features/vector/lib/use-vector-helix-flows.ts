"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createFlowEventSource, fetchFlows, type FlowAlert } from "@/lib/api";
import { findMatchingFlow, mergeFlowAlerts } from "@/features/helix/lib/helix-flow-merge";
import {
  appendFlowTapePage,
  flowDedupeKey,
  mergeFlowTapeHead,
} from "@/features/helix/lib/helix-flow-tape-merge";
import {
  HELIX_FLOW_DEFAULT_SINCE_HOURS,
} from "@/features/helix/lib/helix-flow-limits";
import {
  VECTOR_HELIX_MIN_PREMIUM,
  VECTOR_HELIX_PAGE_SIZE,
} from "@/features/vector/lib/vector-helix-flows";

const FLOW_POLL_MS = 30_000;

export function useVectorHelixFlows(ticker: string, liveSession: boolean) {
  const normalized = ticker.trim().toUpperCase();
  const [flows, setFlows] = useState<FlowAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [live, setLive] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const seenRef = useRef(new Set<string>());
  const loadGenRef = useRef(0);

  const seedSeen = useCallback((rows: FlowAlert[]) => {
    const seeded = new Set<string>();
    for (const row of rows) {
      seeded.add(flowDedupeKey(row));
    }
    seenRef.current = seeded;
  }, []);

  const fetchParams = useCallback(
    (before?: string) => ({
      ticker: normalized,
      limit: VECTOR_HELIX_PAGE_SIZE,
      since_hours: HELIX_FLOW_DEFAULT_SINCE_HOURS,
      min_premium: VECTOR_HELIX_MIN_PREMIUM,
      ...(before ? { before } : {}),
    }),
    [normalized]
  );

  const loadInitial = useCallback(async () => {
    const gen = ++loadGenRef.current;
    setLoading(true);
    try {
      const data = await fetchFlows(fetchParams());
      if (gen !== loadGenRef.current) return;
      seedSeen(data.flows);
      setFlows(data.flows);
      setHasMore(Boolean(data.has_more));
      setNextBefore(data.next_before ?? null);
      setLive(true);
    } catch {
      if (gen === loadGenRef.current) setLive(false);
    } finally {
      if (gen === loadGenRef.current) setLoading(false);
    }
  }, [fetchParams, seedSeen]);

  const refreshHead = useCallback(async () => {
    const gen = ++loadGenRef.current;
    try {
      const data = await fetchFlows(fetchParams());
      if (gen !== loadGenRef.current) return;
      seedSeen(data.flows);
      setFlows((prev) => mergeFlowTapeHead(prev, data.flows));
      setHasMore(Boolean(data.has_more));
      setNextBefore(data.next_before ?? null);
      setLive(true);
    } catch {
      if (gen === loadGenRef.current) setLive(false);
    }
  }, [fetchParams, seedSeen]);

  const loadOlder = useCallback(async () => {
    if (!nextBefore || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const data = await fetchFlows(fetchParams(nextBefore));
      for (const row of data.flows) {
        seenRef.current.add(flowDedupeKey(row));
      }
      setFlows((prev) => appendFlowTapePage(prev, data.flows));
      setHasMore(Boolean(data.has_more));
      setNextBefore(data.next_before ?? null);
    } finally {
      setLoadingOlder(false);
    }
  }, [fetchParams, nextBefore, loadingOlder]);

  useEffect(() => {
    void loadInitial();
  }, [loadInitial]);

  useEffect(() => {
    if (!liveSession) return;
    let poll: ReturnType<typeof setInterval> | null = null;
    const go = () => {
      if (!poll) poll = setInterval(() => void refreshHead(), FLOW_POLL_MS);
    };
    const stop = () => {
      if (poll) {
        clearInterval(poll);
        poll = null;
      }
    };

    const conn = createFlowEventSource(
      (alert) => {
        if (alert.ticker?.toUpperCase() !== normalized) return;
        const key = flowDedupeKey(alert);
        if (seenRef.current.has(key)) return;
        seenRef.current.add(key);
        setFlows((prev) => {
          const idx = findMatchingFlow(prev, alert);
          if (idx >= 0) {
            const merged = mergeFlowAlerts(alert, prev[idx]!);
            const rest = prev.filter((_, i) => i !== idx);
            return [merged, ...rest];
          }
          return [alert, ...prev];
        });
        setLive(true);
      },
      {
        onOpen: () => {
          setLive(true);
          stop();
        },
        onClose: () => {
          setLive(false);
          go();
          void refreshHead();
        },
      },
      normalized
    );

    if (conn) return () => {
      conn.close();
      stop();
    };
    go();
    return () => stop();
  }, [liveSession, normalized, refreshHead]);

  return {
    flows,
    loading,
    loadingOlder,
    live,
    hasMore,
    loadOlder,
    refreshHead,
  };
}
