"use client";

// Client-side watchlist persistence. This is the first localStorage usage in the
// repo, so the SSR guard + try/catch live HERE and nowhere else. Pure logic is in
// src/lib/watchlist-store.ts (unit-tested); this hook only owns I/O + React state.

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  STORAGE_KEY,
  parseWatchlist,
  serializeWatchlist,
  toggleTicker as togglePure,
  removeTicker as removePure,
  isStarred as isStarredPure,
} from "@/lib/watchlist-store";

export interface UseWatchlist {
  watchlist: string[];
  watchlistSet: Set<string>;
  isStarred: (ticker: string) => boolean;
  toggle: (ticker: string) => void;
  remove: (ticker: string) => void;
  clear: () => void;
  /** false during SSR / before hydration — lets callers avoid flicker */
  ready: boolean;
}

function readStorage(): string[] {
  if (typeof window === "undefined") return [];
  try {
    return parseWatchlist(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return [];
  }
}

function writeStorage(list: string[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, serializeWatchlist(list));
  } catch {
    /* quota / privacy mode — watchlist stays in-memory for this session */
  }
}

export function useWatchlist(): UseWatchlist {
  // Start empty on server AND first client render to avoid hydration mismatch;
  // hydrate real value in useEffect.
  const [watchlist, setWatchlist] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  const skipNextWrite = useRef(true);

  // Hydrate once on mount.
  useEffect(() => {
    setWatchlist(readStorage());
    setReady(true);
  }, []);

  // Persist on change (skip the initial hydrate write).
  useEffect(() => {
    if (skipNextWrite.current) {
      skipNextWrite.current = false;
      return;
    }
    writeStorage(watchlist);
  }, [watchlist]);

  // Cross-tab sync.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      skipNextWrite.current = true; // don't echo back what another tab wrote
      setWatchlist(parseWatchlist(e.newValue));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const toggle = useCallback((ticker: string) => {
    setWatchlist((prev) => togglePure(prev, ticker));
  }, []);

  const remove = useCallback((ticker: string) => {
    setWatchlist((prev) => removePure(prev, ticker));
  }, []);

  const clear = useCallback(() => setWatchlist([]), []);

  const watchlistSet = useMemo(() => new Set(watchlist), [watchlist]);
  const isStarred = useCallback((ticker: string) => isStarredPure(watchlist, ticker), [watchlist]);

  return { watchlist, watchlistSet, isStarred, toggle, remove, clear, ready };
}
