"use client";

import type { VectorBar } from "@/features/vector/components/VectorChart";
import type { VectorDarkPoolLevel, VectorWalls } from "@/lib/api";
import type { WallHistorySample } from "@/features/vector/lib/vector-wall-history";
import { seedWallHistoryForDisplay, prepareRailBootstrapHistory } from "@/features/vector/lib/vector-wall-history";
import {
  defaultVectorDteHorizon,
  normalizeVectorTicker,
  VECTOR_ORACLE_TICKERS,
} from "@/features/vector/lib/vector-ticker";
import { lastSessionBars } from "@/features/vector/lib/vector-key-levels";
import { todayEtYmd } from "@/lib/providers/spx-session";
import { isHeatmapOverlayAllowed } from "@/lib/heatmap-allowlist";

export type VectorClientSeed = {
  ticker: string;
  initialBars: VectorBar[];
  initialWalls: VectorWalls | null;
  initialVexWalls: VectorWalls | null;
  initialWallHistory: WallHistorySample[];
  initialHorizonWallHistory: WallHistorySample[];
  initialGammaFlip: number | null;
  initialVexFlip: number | null;
  initialDarkPoolLevels: VectorDarkPoolLevel[];
  sessionYmd: string;
  liveSession: boolean;
  initialWallTrailSec: number;
};

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export type VectorRailBootstrapPayload = {
  blended: WallHistorySample[];
  narrowed: WallHistorySample[];
};

/** Client-side seed for ticker switches — avoids full SSR on every VectorTickerSelect navigation. */
export async function fetchVectorClientSeed(ticker: string): Promise<VectorClientSeed> {
  const t = encodeURIComponent(ticker);
  const barsPayload = await fetchJson<{ bars?: VectorBar[]; sessionYmd?: string }>(
    `/api/market/vector/bars?ticker=${t}`
  );
  const sessionYmd = barsPayload?.sessionYmd ?? todayEtYmd();
  const horizon = defaultVectorDteHorizon(ticker);
  const [wallsPayload, historyPayload, horizonHistory] = await Promise.all([
    fetchJson<{ walls?: VectorWalls; flip?: number | null }>(
      `/api/market/vector/walls?ticker=${t}&dte=all`
    ),
    fetchJson<{ history?: WallHistorySample[] }>(
      `/api/market/vector/wall-history?ticker=${t}&dte=all&session=${encodeURIComponent(sessionYmd)}`
    ),
    horizon !== "all"
      ? fetchJson<{ history?: WallHistorySample[] }>(
          `/api/market/vector/wall-history?ticker=${t}&dte=${horizon}&session=${encodeURIComponent(sessionYmd)}`
        )
      : Promise.resolve(null),
  ]);

  return {
    ticker,
    initialBars: barsPayload?.bars ?? [],
    initialWalls: wallsPayload?.walls ?? null,
    initialVexWalls: null,
    initialWallHistory: seedWallHistoryForDisplay(
      historyPayload?.history ?? [],
      (barsPayload?.bars ?? []).map((b) => b.time),
      wallsPayload?.walls ?? null,
      wallsPayload?.flip ?? null,
      null,
      null
    ),
    initialHorizonWallHistory:
      horizon !== "all"
        ? prepareRailBootstrapHistory(
            horizonHistory?.history ?? [],
            barsPayload?.bars?.[0]?.time
          )
        : [],
    initialGammaFlip: wallsPayload?.flip ?? null,
    initialVexFlip: null,
    initialDarkPoolLevels: [],
    sessionYmd,
    liveSession: sessionYmd === todayEtYmd(),
    initialWallTrailSec: isHeatmapOverlayAllowed(ticker) ? 5 : 15,
  };
}

/**
 * Should the phase-2 "full" client seed (from {@link fetchVectorClientSeed}) replace the phase-1
 * "fast" seed (from {@link fetchVectorEmbedFastSeed}) already on screen?
 *
 * THE BUG THIS FIXES (SpxVectorEmbed, the SPX Slayer chart embed). `fetchJson` above swallows every
 * network/parse failure and resolves `null` rather than throwing, so `fetchVectorClientSeed` never
 * rejects on a transient fetch hiccup — it resolves SUCCESSFULLY with `initialBars: []` (every field
 * null-coalesced to its empty default per line 70 above). The embed's two-phase load calls
 * `setSeed(fast)` first (chart renders real candles), then unconditionally calls `setSeed(full)`
 * once the phase-2 fetch resolves — so a transient failure on JUST the enrichment fetch (the fast
 * seed already succeeded and is rendering) replaced a chart showing real bars with an empty one,
 * even though nothing was wrong with what was already on screen.
 *
 * The rule: only adopt the full seed when it actually carries bars, or the fast seed never had any
 * to begin with (both legitimately empty, e.g. a pre-open session — adopting then is a no-op for
 * bars but still lets other fields like walls/history refresh). An empty full seed while the fast
 * seed has real bars is a degraded/failed phase-2 fetch, never a genuine "SPX has no bars" answer —
 * SPX always has bars once a session exists — so keeping the fast seed on screen is strictly safer
 * than regressing to nothing. Same "a failed refresh must not wipe a good prior read" discipline as
 * `warmVectorDarkPool` (vector-dark-pool-cache.ts: "a transient UW outage must not actively WIPE
 * good levels a previous run fetched — skip the write").
 */
export function shouldAdoptFullVectorSeed(
  fastSeedBarsLength: number,
  fullSeedBarsLength: number
): boolean {
  return fullSeedBarsLength > 0 || fastSeedBarsLength === 0;
}

type VectorEmbedFastSeed = Pick<
  VectorClientSeed,
  | "initialBars"
  | "initialWalls"
  | "initialWallHistory"
  | "initialHorizonWallHistory"
  | "initialGammaFlip"
  | "sessionYmd"
  | "initialWallTrailSec"
>;

/**
 * Fast first paint for desk embeds (SPX Slayer): bars + walls + decimated rail bootstrap in
 * parallel — no Polygon reconstruct. Call `fetchVectorClientSeed` afterward to upgrade history.
 */
export async function fetchVectorEmbedFastSeed(ticker: string): Promise<VectorEmbedFastSeed> {
  const t = encodeURIComponent(ticker);
  const barsPayload = await fetchJson<{ bars?: VectorBar[]; sessionYmd?: string }>(
    `/api/market/vector/bars?ticker=${t}`
  );
  const bars = barsPayload?.bars ?? [];
  const sessionYmd = barsPayload?.sessionYmd ?? todayEtYmd();
  const firstBar = lastSessionBars(bars)[0]?.time;
  const horizon = defaultVectorDteHorizon(ticker);
  // BUG FIX (round 207 DISCOVERY sweep): every sibling `VECTOR_ORACLE_TICKERS.has(...)` call site
  // (vector-cadence.ts, vector-snapshot.ts, vector-wall-sample.ts, vector-wall-sample-server.ts,
  // vector-rail-bootstrap.ts) normalizes the ticker FIRST — this one compared the raw, caller-
  // supplied `ticker` against the canonical-uppercase Set directly, so a non-canonical key that is
  // genuinely SPX/SPY/QQQ (lowercase, or the Polygon-style "I:SPX" deep-link form `normalizeVectorTicker`
  // exists specifically to strip) silently failed the membership check and skipped the oracle
  // rail-bootstrap fetch — degrading the fast first-paint bead rail to empty for no real reason, on
  // exactly the tickers this fast path exists for. Same bug shape already fixed once for
  // `normalizeDteHorizon` (see its own doc comment: "the old exact-match check silently re-scoped
  // ... normalize ... so no consumer can repeat it") — this call site repeated it.
  const normalizedTicker = normalizeVectorTicker(ticker);

  const [wallsPayload, bootstrap] = await Promise.all([
    fetchJson<{ walls?: VectorWalls; flip?: number | null }>(
      `/api/market/vector/walls?ticker=${t}&dte=all`
    ),
    VECTOR_ORACLE_TICKERS.has(normalizedTicker)
      ? fetchJson<VectorRailBootstrapPayload>(
          `/api/market/vector/rail-bootstrap?ticker=${t}&session=${encodeURIComponent(sessionYmd)}&dte=${horizon}${
            firstBar != null ? `&firstBar=${firstBar}` : ""
          }`
        )
      : Promise.resolve(null),
  ]);

  const blended = bootstrap?.blended ?? [];
  const narrowed = bootstrap?.narrowed ?? [];

  return {
    initialBars: bars,
    initialWalls: wallsPayload?.walls ?? null,
    initialWallHistory: seedWallHistoryForDisplay(
      blended,
      bars.map((b) => b.time),
      wallsPayload?.walls ?? null,
      wallsPayload?.flip ?? null,
      null,
      null
    ),
    initialHorizonWallHistory: narrowed,
    initialGammaFlip: wallsPayload?.flip ?? null,
    sessionYmd,
    initialWallTrailSec: isHeatmapOverlayAllowed(ticker) ? 5 : 15,
  };
}
