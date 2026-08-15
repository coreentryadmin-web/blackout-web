"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createFlowEventSource, fetchFlows, type FlowAlert } from "@/lib/api";
import { sessionOpenMs } from "@/lib/largo/temporal/timeframe";
import { findMatchingFlow, mergeFlowAlerts } from "@/features/helix/lib/helix-flow-merge";
import {
  flowDedupeKey,
  mergeFlowTapeHead,
} from "@/features/helix/lib/helix-flow-tape-merge";
import {
  filterFlowsSinceSessionOpen,
  hoursSinceSessionOpen,
  isFlowSinceSessionOpen,
  trimVectorHelixFlowPool,
  VECTOR_HELIX_MIN_PREMIUM,
  VECTOR_LIVE_HELIX_SESSION_FETCH_LIMIT,
  VECTOR_LIVE_HELIX_TAPE_CAP,
} from "@/features/vector/lib/vector-helix-flows";

const FLOW_POLL_MS = 30_000;
const FLASH_MS = 2_000;

/**
 * Vector Live Helix — today's session tape for the ticker.
 * On load: seed from Postgres/cache (since today's 09:30 ET open) so a mid-day join
 * still sees the 9:30 anchor. Then SSE + poll keep the ranked list live.
 */
export function useVectorHelixFlows(ticker: string, liveSession: boolean) {
  const normalized = ticker.trim().toUpperCase();
  const sessionOpenMsRef = useRef(sessionOpenMs(Date.now()));
  const loadGenRef = useRef(0);

  const [flows, setFlows] = useState<FlowAlert[]>([]);
  const [loading, setLoading] = useState(liveSession);
  const [live, setLive] = useState(false);
  const [flashKeys, setFlashKeys] = useState<ReadonlySet<string>>(() => new Set());
  const seenRef = useRef(new Set<string>());
  const flashTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const markFlash = useCallback((key: string) => {
    setFlashKeys((prev) => {
      const next = new Set(prev);
      next.add(key);
      return next;
    });
    const existing = flashTimersRef.current.get(key);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      flashTimersRef.current.delete(key);
      setFlashKeys((prev) => {
        if (!prev.has(key)) return prev;
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }, FLASH_MS);
    flashTimersRef.current.set(key, timer);
  }, []);

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
      limit: VECTOR_LIVE_HELIX_SESSION_FETCH_LIMIT,
      since_hours: hoursSinceSessionOpen(),
      min_premium: VECTOR_HELIX_MIN_PREMIUM,
    }),
    [normalized]
  );

  const applySessionPool = useCallback((rows: FlowAlert[]) => {
    const sessionRows = filterFlowsSinceSessionOpen(rows, sessionOpenMsRef.current);
    return trimVectorHelixFlowPool(sessionRows, VECTOR_LIVE_HELIX_TAPE_CAP);
  }, []);

  const setPool = useCallback(
    (rows: FlowAlert[]) => {
      const pool = applySessionPool(rows);
      seedSeen(pool);
      setFlows(pool);
      return pool;
    },
    [applySessionPool, seedSeen]
  );

  const ingestFlow = useCallback(
    (alert: FlowAlert, opts: { flash: boolean }) => {
      if (!isFlowSinceSessionOpen(alert, sessionOpenMsRef.current)) return false;
      const key = flowDedupeKey(alert);
      const isNew = !seenRef.current.has(key);
      if (isNew) seenRef.current.add(key);

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
        return applySessionPool(next);
      });

      if (isNew && opts.flash) markFlash(key);
      setLive(true);
      return true;
    },
    [applySessionPool, markFlash]
  );

  const loadSessionTape = useCallback(async () => {
    const gen = ++loadGenRef.current;
    setLoading(true);
    try {
      sessionOpenMsRef.current = sessionOpenMs(Date.now());
      const data = await fetchFlows(fetchParams());
      if (gen !== loadGenRef.current) return;
      setPool(data.flows);
      setLive(true);
    } catch {
      if (gen === loadGenRef.current) setLive(false);
    } finally {
      if (gen === loadGenRef.current) setLoading(false);
    }
  }, [fetchParams, setPool]);

  const refreshSessionTape = useCallback(async () => {
    const gen = ++loadGenRef.current;
    try {
      sessionOpenMsRef.current = sessionOpenMs(Date.now());
      const data = await fetchFlows(fetchParams());
      if (gen !== loadGenRef.current) return;
      setFlows((prev) => {
        const merged = applySessionPool(mergeFlowTapeHead(prev, data.flows));
        seedSeen(merged);
        return merged;
      });
      setLive(true);
    } catch {
      if (gen === loadGenRef.current) setLive(false);
    }
  }, [applySessionPool, fetchParams, seedSeen]);

  useEffect(() => {
    sessionOpenMsRef.current = sessionOpenMs(Date.now());
    seenRef.current = new Set();
    setFlows([]);
    setFlashKeys(new Set());
    setLive(false);

    if (!liveSession) {
      setLoading(false);
      return;
    }

    void loadSessionTape();
  }, [liveSession, loadSessionTape, normalized]);

  useEffect(() => {
    return () => {
      for (const timer of flashTimersRef.current.values()) {
        clearTimeout(timer);
      }
      flashTimersRef.current.clear();
    };
  }, []);

  useEffect(() => {
    if (!liveSession) return;

    let poll: ReturnType<typeof setInterval> | null = null;
    const go = () => {
      if (!poll) poll = setInterval(() => void refreshSessionTape(), FLOW_POLL_MS);
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
        ingestFlow(alert, { flash: true });
      },
      {
        onOpen: () => {
          setLive(true);
          stop();
        },
        onClose: () => {
          setLive(false);
          go();
          void refreshSessionTape();
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
  }, [ingestFlow, liveSession, normalized, refreshSessionTape]);

  return {
    flows,
    loading,
    live,
    flashKeys,
  };
}
