import { getCurrentSpxCandle } from "@/lib/ws/spx-candle-store";
import { getGexStrikeExpiryLadder } from "@/lib/ws/uw-socket";
import { fetchGexHeatmap } from "@/lib/providers/polygon-options-gex";
import {
  computeGexWalls,
  mapFromStrikeTotalsRecord,
  nextWallScope,
  type GexWalls,
  type WallScopeState,
} from "@/lib/providers/gex-wall-levels";

const WALL_SCOPE_REFRESH_MS = 15_000;
let wallScope: WallScopeState = { expiries: undefined, fetchedAt: 0 };
let wallScopeInFlight: Promise<void> | null = null;
let fallbackStrikeTotals: Record<string, number> | null = null;

const WALLS_CACHE_MS = 900;
let cachedWalls: GexWalls | null = null;
let cachedWallsAt = 0;

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

export type VectorStreamPayload = {
  candle: ReturnType<typeof getCurrentSpxCandle>["current"];
  walls: GexWalls | null;
  t: number;
};

export function buildVectorStreamPayload(): VectorStreamPayload {
  const { current, updatedAt } = getCurrentSpxCandle();
  return { candle: current, walls: getVectorGexWalls(), t: updatedAt };
}

/** Test-only reset of module caches. */
export function _resetVectorSnapshotForTest(): void {
  wallScope = { expiries: undefined, fetchedAt: 0 };
  wallScopeInFlight = null;
  fallbackStrikeTotals = null;
  cachedWalls = null;
  cachedWallsAt = 0;
}
