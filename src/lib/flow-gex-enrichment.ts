import { getGexPositioning } from "@/lib/providers/gex-positioning";
import {
  enrichFlowWithGex,
  tickersToEvaluate,
  type GexLevelSnapshot,
} from "@/lib/flow-gex-proximity";

export type { GexProximityLabel, GexLevelSnapshot } from "@/lib/flow-gex-proximity";
export { computeGexProximity, enrichFlowWithGex } from "@/lib/flow-gex-proximity";

const GEX_ENRICH_TIMEOUT_MS = 300;
const GEX_CACHE_TTL_MS = 60_000;

const gexCache = new Map<string, { data: GexLevelSnapshot; expires: number }>();

export async function getGexLevelsForTicker(ticker: string): Promise<GexLevelSnapshot | null> {
  const key = ticker.toUpperCase();
  const cached = gexCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.data;

  try {
    const pos = await Promise.race([
      getGexPositioning(key),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), GEX_ENRICH_TIMEOUT_MS)),
    ]);
    if (!pos) return null;
    const data: GexLevelSnapshot = {
      flip: pos.flip,
      call_wall: pos.call_wall,
      put_wall: pos.put_wall,
    };
    gexCache.set(key, { data, expires: Date.now() + GEX_CACHE_TTL_MS });
    return data;
  } catch {
    return null;
  }
}

// Root cause (2026-08-01 Helix audit): the caller (`/api/market/flows`) passed a fixed
// maxTickers=8, so any page with more than 8 distinct tickers — routine on a busy session,
// a 500-row page commonly spans 30-80+ names — silently left most rows with no gex_proximity
// at all. Not "not near a wall": never evaluated. 100 comfortably covers realistic ticker
// diversity even on a max-size (5000-row, HELIX_FLOW_MAX_LIMIT) page while still bounding
// worst-case fan-out; each lookup is individually capped at GEX_ENRICH_TIMEOUT_MS (300ms) and
// hits getGexLevelsForTicker's own 60s per-ticker cache, and this whole function only runs on
// a flows-cache miss (flowsCacheTtlMs(), also 60s) rather than per member request.
export async function enrichFlowsWithGex<T extends { ticker: string; strike: number }>(
  flows: T[],
  maxTickers = 100
): Promise<
  Array<
    T & {
      gex_proximity?: import("@/lib/flow-gex-proximity").GexProximityLabel;
      gex_evaluated: boolean;
    }
  >
> {
  // Cap decision lives in flow-gex-proximity.ts because THIS module reaches `server-only` and
  // cannot be unit-tested — see tickersToEvaluate's header.
  const { evaluated: uniqueTickers } = tickersToEvaluate(flows, maxTickers);
  const gexMap = new Map<string, GexLevelSnapshot>();
  await Promise.all(
    uniqueTickers.map(async (t) => {
      const levels = await getGexLevelsForTicker(t);
      if (levels) gexMap.set(t.toUpperCase(), levels);
    })
  );
  return flows.map((f) => {
    const gex = gexMap.get(f.ticker.toUpperCase());
    // EXPLICIT `false`, never an omitted key. "We did not evaluate this print" is a KNOWN state —
    // the ticker was past the `maxTickers` cap, or its lookup timed out / returned nothing — and
    // C3 forbids letting absence stand in for a state we know. Measured live: 173 of 273 tickers
    // on one page were past the cap, so this branch is the COMMON one, not an edge case.
    if (!gex) return { ...f, gex_evaluated: false };
    return enrichFlowWithGex(f, gex);
  });
}
