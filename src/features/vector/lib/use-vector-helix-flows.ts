"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createFlowEventSource, fetchFlows, type FlowAlert } from "@/lib/api";
import { todayEtYmd } from "@/lib/providers/spx-session";
import { sessionOpenMs } from "@/lib/largo/temporal/timeframe";
import { findMatchingFlow, mergeFlowAlerts } from "@/features/helix/lib/helix-flow-merge";
import { flowDedupeKey } from "@/features/helix/lib/helix-flow-tape-merge";
import {
  flowAlertedMs,
  isFlowSinceSessionOpen,
  trimVectorHelixFlowPool,
  VECTOR_HELIX_MIN_PREMIUM,
  VECTOR_LIVE_HELIX_TAPE_CAP,
} from "@/features/vector/lib/vector-helix-flows";
import {
  readVectorLiveHelixCache,
  seenKeysFromCache,
  writeVectorLiveHelixCache,
} from "@/features/vector/lib/vector-live-helix-cache";

const FLOW_POLL_MS = 30_000;
const FLASH_MS = 2_000;
const GAP_FILL_SINCE_HOURS = 1;

/**
 * Vector Live Helix — SSE-only live tape for the current session.
 * No REST backfill of pre-existing prints; the list starts empty at the open
 * and grows only as live flows arrive (sessionStorage restores same-day live tape on refresh).
 */
export function useVectorHelixFlows(ticker: string, liveSession: boolean) {
  const normalized = ticker.trim().toUpperCase();
  const sessionYmd = todayEtYmd();
  const sessionOpenMsRef = useRef(sessionOpenMs(Date.now()));
  const watchStartedMsRef = useRef(Date.now());

  const [flows, setFlows] = useState<FlowAlert[]>([]);
  const [loading, setLoading] = useState(liveSession);
  const [live, setLive] = useState(false);
  const [flashKeys, setFlashKeys] = useState<ReadonlySet<string>>(() => new Set());
  const seenRef = useRef(new Set<string>());
  const flashTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const persistTape = useCallback(
    (rows: FlowAlert[]) => {
      writeVectorLiveHelixCache(normalized, sessionYmd, rows, seenRef.current);
    },
    [normalized, sessionYmd]
  );

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

  const acceptLivePrint = useCallback(
    (flow: FlowAlert, allowGapFill: boolean): boolean => {
      if (!isFlowSinceSessionOpen(flow, sessionOpenMsRef.current)) return false;
      if (allowGapFill) {
        return flowAlertedMs(flow) >= watchStartedMsRef.current;
      }
      return true;
    },
    []
  );

  const ingestFlow = useCallback(
    (alert: FlowAlert, opts: { flash: boolean; gapFill: boolean }) => {
      if (!acceptLivePrint(alert, opts.gapFill)) return false;
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
        const trimmed = trimVectorHelixFlowPool(next, VECTOR_LIVE_HELIX_TAPE_CAP);
        persistTape(trimmed);
        return trimmed;
      });

      if (isNew && opts.flash) markFlash(key);
      setLive(true);
      return true;
    },
    [acceptLivePrint, markFlash, persistTape]
  );

  const resetTape = useCallback(() => {
    seenRef.current = new Set();
    setFlows([]);
    setFlashKeys(new Set());
    setLive(false);
    persistTape([]);
  }, [persistTape]);

  // Ticker or session-day change → fresh live tape (restore from sessionStorage if same day).
  useEffect(() => {
    sessionOpenMsRef.current = sessionOpenMs(Date.now());
    watchStartedMsRef.current = Date.now();

    if (!liveSession) {
      resetTape();
      setLoading(false);
      return;
    }

    const cached = readVectorLiveHelixCache(normalized, sessionYmd);
    const restored = (cached?.flows ?? []).filter((f) =>
      isFlowSinceSessionOpen(f, sessionOpenMsRef.current)
    );
    seenRef.current = seenKeysFromCache(cached);
    for (const row of restored) {
      seenRef.current.add(flowDedupeKey(row));
    }
    setFlows(trimVectorHelixFlowPool(restored, VECTOR_LIVE_HELIX_TAPE_CAP));
    setLoading(false);
  }, [liveSession, normalized, resetTape, sessionYmd]);

  const fillGap = useCallback(async () => {
    if (!liveSession) return;
    try {
      const data = await fetchFlows({
        ticker: normalized,
        limit: VECTOR_LIVE_HELIX_TAPE_CAP,
        since_hours: GAP_FILL_SINCE_HOURS,
        min_premium: VECTOR_HELIX_MIN_PREMIUM,
      });
      for (const row of data.flows) {
        ingestFlow(row, { flash: false, gapFill: true });
      }
      setLive(true);
    } catch {
      setLive(false);
    }
  }, [ingestFlow, liveSession, normalized]);

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
      if (!poll) poll = setInterval(() => void fillGap(), FLOW_POLL_MS);
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
        ingestFlow(alert, { flash: true, gapFill: false });
      },
      {
        onOpen: () => {
          setLive(true);
          stop();
        },
        onClose: () => {
          setLive(false);
          go();
          void fillGap();
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
  }, [fillGap, ingestFlow, liveSession, normalized]);

  return {
    flows,
    loading,
    live,
    flashKeys,
  };
}
