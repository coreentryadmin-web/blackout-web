import { getCurrentSpxCandle } from "@/lib/ws/spx-candle-store";
import { getGexStrikeExpiryLadder } from "@/lib/ws/uw-socket";
import { fetchGexHeatmap } from "@/lib/providers/polygon-options-gex";
import { getGexPositioning } from "@/lib/providers/gex-positioning";
import {
  darkPoolLevelsFromSnapshot,
  type VectorDarkPoolLevel,
} from "@/lib/providers/vector-dark-pool-levels";
import {
  computeGexWalls,
  mapFromStrikeTotalsRecord,
  nextWallScope,
  type GexWalls,
  type WallScopeState,
} from "@/lib/providers/gex-wall-levels";
import { todayEtYmd } from "@/lib/providers/spx-session";
import { persistWallSampleDebounced } from "@/lib/providers/vector-wall-persist";
import { bucketWallSampleTime } from "@/lib/providers/vector-wall-sample";
import { recordWallSample, type WallHistorySample } from "@/lib/providers/vector-wall-history";
import { fetchUwDarkPool } from "@/lib/providers/unusual-whales";

const WALL_SCOPE_REFRESH_MS = 15_000;
const DARK_POOL_REFRESH_MS = 60_000;
let wallScope: WallScopeState = { expiries: undefined, fetchedAt: 0 };
let wallScopeInFlight: Promise<void> | null = null;
let fallbackStrikeTotals: Record<string, number> | null = null;

const WALLS_CACHE_MS = 900;
let cachedWalls: GexWalls | null = null;
let cachedWallsAt = 0;

let cachedFlip: number | null = null;
let cachedFlipAt = 0;
const FLIP_CACHE_MS = 5_000;

let cachedDarkPool: VectorDarkPoolLevel[] = [];
let cachedDarkPoolAt = 0;
let darkPoolInFlight: Promise<void> | null = null;

function refreshWallScope(): void {
  const now = Date.now();
  if (now - wallScope.fetchedAt < WALL_SCOPE_REFRESH_MS || wallScopeInFlight) return;
  wallScopeInFlight = fetchGexHeatmap("SPX")
    .then((hm) => {
      wallScope = nextWallScope(wallScope, Date.now(), hm);
      if (hm?.gex?.strike_totals && Object.keys(hm.gex.strike_totals).length > 0) {
        fallbackStrikeTotals = hm.gex.strike_totals;
      }
    })
    .catch(() => {
      wallScope = nextWallScope(wallScope, Date.now(), null);
    })
    .finally(() => {
      wallScopeInFlight = null;
    });
}

function refreshDarkPoolLevels(): void {
  const now = Date.now();
  if (now - cachedDarkPoolAt < DARK_POOL_REFRESH_MS || darkPoolInFlight) return;
  darkPoolInFlight = Promise.all([
    fetchUwDarkPool("SPX", { limit: 30, min_premium: 500_000 }).catch(() => null),
    fetchUwDarkPool("SPY", { limit: 30, min_premium: 500_000 }).catch(() => null),
  ])
    .then(([spx, spy]) => {
      const levels = darkPoolLevelsFromSnapshot(spx);
      cachedDarkPool =
        levels.length > 0 ? levels : darkPoolLevelsFromSnapshot(spy);
      cachedDarkPoolAt = Date.now();
    })
    .catch(() => {
      cachedDarkPoolAt = Date.now();
    })
    .finally(() => {
      darkPoolInFlight = null;
    });
}

/** Shared gamma-wall read for Vector SSE + SSR seed (cache-backed, replica-safe fallback). */
export function getVectorGexWalls(): GexWalls | null {
  refreshWallScope();
  const now = Date.now();
  if (now - cachedWallsAt < WALLS_CACHE_MS) return cachedWalls;

  const ws = getGexStrikeExpiryLadder("SPX", wallScope.expiries);
  if (ws) {
    cachedWalls = computeGexWalls(ws.ladder);
  } else if (fallbackStrikeTotals) {
    cachedWalls = computeGexWalls(mapFromStrikeTotalsRecord(fallbackStrikeTotals));
  } else {
    cachedWalls = null;
  }
  cachedWallsAt = now;
  return cachedWalls;
}

/** Zero-gamma flip from the shared GEX positioning cache (same as Thermal / SPX desk). */
export async function getVectorGammaFlip(): Promise<number | null> {
  const now = Date.now();
  if (now - cachedFlipAt < FLIP_CACHE_MS) return cachedFlip;
  try {
    const pos = await getGexPositioning("SPX");
    cachedFlip = pos?.flip ?? null;
  } catch {
    cachedFlip = null;
  }
  cachedFlipAt = now;
  return cachedFlip;
}

export function getVectorDarkPoolLevels(): VectorDarkPoolLevel[] {
  refreshDarkPoolLevels();
  return cachedDarkPool;
}

export type VectorStreamPayload = {
  candle: ReturnType<typeof getCurrentSpxCandle>["current"];
  walls: GexWalls | null;
  gammaFlip: number | null;
  darkPoolLevels: VectorDarkPoolLevel[];
  t: number;
  wallHistory: WallHistorySample[];
  sessionYmd: string;
};

let wallHistory: WallHistorySample[] = [];

export function getVectorWallHistory(): WallHistorySample[] {
  return wallHistory;
}

export async function buildVectorStreamPayload(): Promise<VectorStreamPayload> {
  const { current, updatedAt } = getCurrentSpxCandle();
  const walls = getVectorGexWalls();
  const gammaFlip = await getVectorGammaFlip();
  const darkPoolLevels = getVectorDarkPoolLevels();
  const sessionYmd = todayEtYmd();

  if (walls) {
    const sampleTime = bucketWallSampleTime(Math.floor(Date.now() / 1000));
    const sample: WallHistorySample = { time: sampleTime, walls, gammaFlip };
    wallHistory = recordWallSample(wallHistory, sample);
    persistWallSampleDebounced(sessionYmd, sample);
  }

  return {
    candle: current,
    walls,
    gammaFlip,
    darkPoolLevels,
    t: updatedAt,
    wallHistory,
    sessionYmd,
  };
}

/** Test-only reset of module caches. */
export function _resetVectorSnapshotForTest(): void {
  wallScope = { expiries: undefined, fetchedAt: 0 };
  wallScopeInFlight = null;
  fallbackStrikeTotals = null;
  cachedWalls = null;
  cachedWallsAt = 0;
  cachedFlip = null;
  cachedFlipAt = 0;
  cachedDarkPool = [];
  cachedDarkPoolAt = 0;
  darkPoolInFlight = null;
  wallHistory = [];
}
