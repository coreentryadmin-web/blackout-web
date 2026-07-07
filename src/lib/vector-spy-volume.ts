import { todayEtYmd } from "@/lib/providers/spx-session";
import { fetchStockMinuteBars } from "@/lib/providers/polygon";

type AggBar = { t?: number; o: number; h: number; l: number; c: number; v?: number };
type FetchSpyBars = (symbol: string, from: string, to: string) => Promise<AggBar[]>;

type VolumeCache = { barTimeSec: number; volume: number; fetchedAt: number };

let cache: VolumeCache | null = null;
const CACHE_MS = 55_000;

/**
 * SPY 1m share volume for the minute bar aligned with SPX — standard proxy when the
 * index chart has no native tape volume. Returns undefined when Polygon has no bar yet.
 */
export async function spyVolumeForMinuteBar(
  barTimeSec: number,
  nowMs: number = Date.now(),
  fetchSpy: FetchSpyBars = fetchStockMinuteBars
): Promise<number | undefined> {
  if (!Number.isFinite(barTimeSec) || barTimeSec <= 0) return undefined;
  if (
    cache &&
    cache.barTimeSec === barTimeSec &&
    nowMs - cache.fetchedAt < CACHE_MS
  ) {
    return cache.volume;
  }

  const ymd = todayEtYmd();
  const bars = await fetchSpy("SPY", ymd, ymd).catch(() => []);
  const match = bars.find(
    (b) => typeof b.t === "number" && Math.floor(b.t / 1000) === barTimeSec
  );
  const volume = match?.v;
  if (volume == null || !Number.isFinite(volume) || volume <= 0) return undefined;

  cache = { barTimeSec, volume, fetchedAt: nowMs };
  return volume;
}

/** Test-only reset. */
export function _resetSpyVolumeCacheForTest(): void {
  cache = null;
}
