import type { FlowAlert } from "@/lib/api";
import { flowDedupeKey } from "@/features/helix/lib/helix-flow-tape-merge";

const CACHE_VERSION = "v1";

export type VectorLiveHelixCache = {
  sessionYmd: string;
  flows: FlowAlert[];
  seenKeys: string[];
};

function cacheKey(ticker: string, sessionYmd: string): string {
  return `vector:live-helix:${CACHE_VERSION}:${ticker}:${sessionYmd}`;
}

export function readVectorLiveHelixCache(
  ticker: string,
  sessionYmd: string
): VectorLiveHelixCache | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(cacheKey(ticker, sessionYmd));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as VectorLiveHelixCache;
    if (parsed.sessionYmd !== sessionYmd || !Array.isArray(parsed.flows)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeVectorLiveHelixCache(
  ticker: string,
  sessionYmd: string,
  flows: readonly FlowAlert[],
  seenKeys: Iterable<string>
): void {
  if (typeof window === "undefined") return;
  try {
    const payload: VectorLiveHelixCache = {
      sessionYmd,
      flows: [...flows],
      seenKeys: [...seenKeys],
    };
    sessionStorage.setItem(cacheKey(ticker, sessionYmd), JSON.stringify(payload));
  } catch {
    /* quota / private mode — in-memory tape still works */
  }
}

export function clearVectorLiveHelixCache(ticker: string, sessionYmd: string): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(cacheKey(ticker, sessionYmd));
  } catch {
    /* ignore */
  }
}

/** Dedupe keys for a restored cache — validates shape without trusting alert bodies. */
export function seenKeysFromCache(cache: VectorLiveHelixCache | null): Set<string> {
  if (!cache?.seenKeys?.length) {
    return new Set(cache?.flows.map((f) => flowDedupeKey(f)) ?? []);
  }
  return new Set(cache.seenKeys);
}
