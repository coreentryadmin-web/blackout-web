"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createFlowEventSource, fetchFlows, type FlowAlert } from "@/lib/api";
import { findMatchingFlow, mergeFlowAlerts } from "@/features/helix/lib/helix-flow-merge";
import {
  flowDedupeKey,
  mergeFlowTapeHead,
} from "@/features/helix/lib/helix-flow-tape-merge";
import { HELIX_FLOW_DEFAULT_SINCE_HOURS } from "@/features/helix/lib/helix-flow-limits";
import {
  trimVectorHelixFlowPool,
  VECTOR_HELIX_FETCH_LIMIT,
  VECTOR_HELIX_MIN_PREMIUM,
} from "@/features/vector/lib/vector-helix-flows";

const FLOW_POLL_MS = 30_000;

/** Vector desk Helix rail — small premium-ranked pool for major-print curation (not full tape). */
export function useVectorHelixFlows(ticker: string, liveSession: boolean) {
  const normalized = ticker.trim().toUpperCase();
  const [flows, setFlows] = useState<FlowAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [live, setLive] = useState(false);
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
    () => ({
      ticker: normalized,
      limit: VECTOR_HELIX_FETCH_LIMIT,
      since_hours: HELIX_FLOW_DEFAULT_SINCE_HOURS,
      min_premium: VECTOR_HELIX_MIN_PREMIUM,
    }),
    [normalized]
  );

  const applyPool = useCallback((rows: FlowAlert[]) => trimVectorHelixFlowPool(rows), []);

  const loadInitial = useCallback(async () => {
    const gen = ++loadGenRef.current;
    setLoading(true);
    try {
      const data = await fetchFlows(fetchParams());
      if (gen !== loadGenRef.current) return;
      const pool = applyPool(data.flows);
      seedSeen(pool);
      setFlows(pool);
      setLive(true);
    } catch {
      if (gen === loadGenRef.current) setLive(false);
    } finally {
      if (gen === loadGenRef.current) setLoading(false);
    }
  }, [applyPool, fetchParams, seedSeen]);

  const refreshHead = useCallback(async () => {
    const gen = ++loadGenRef.current;
    try {
      const data = await fetchFlows(fetchParams());
      if (gen !== loadGenRef.current) return;
      setFlows((prev) => {
        const merged = applyPool(mergeFlowTapeHead(prev, data.flows));
        seedSeen(merged);
        return merged;
      });
      setLive(true);
    } catch {
      if (gen === loadGenRef.current) setLive(false);
    }
  }, [applyPool, fetchParams, seedSeen]);

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
          let next: FlowAlert[];
          if (idx >= 0) {
            const merged = mergeFlowAlerts(alert, prev[idx]!);
            const rest = prev.filter((_, i) => i !== idx);
            next = [merged, ...rest];
          } else {
            next = [alert, ...prev];
          }
          return applyPool(next);
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
  }, [applyPool, liveSession, normalized, refreshHead]);

  return {
    flows,
    loading,
    live,
  };
}
