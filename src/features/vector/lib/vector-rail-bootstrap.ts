import "server-only";

import { loadSessionWallHistory } from "@/features/vector/lib/vector-wall-persist";
import {
  prepareRailBootstrapHistory,
  type WallHistorySample,
} from "@/features/vector/lib/vector-wall-history";
import { resolveDteHorizonParam, type VectorDteHorizon } from "@/features/vector/lib/vector-dte-horizon";
import { VECTOR_ORACLE_TICKERS, normalizeVectorTicker } from "@/features/vector/lib/vector-ticker";

export type VectorRailBootstrapPayload = {
  ticker: string;
  sessionYmd: string;
  horizon: VectorDteHorizon;
  /** Blended near-term rail — decimated Redis/Postgres read, no Polygon reconstruct. */
  blended: WallHistorySample[];
  /** Per-horizon rail (e.g. 0DTE) — empty when horizon is `all`. */
  narrowed: WallHistorySample[];
};

export { prepareRailBootstrapHistory } from "@/features/vector/lib/vector-wall-history";

/**
 * Fast rail bootstrap for oracle desk embeds — Redis/Postgres only, no gap-fill reconstruct.
 * SPX Slayer paints a session-shaped bead rail on first paint instead of a right-edge column.
 */
export async function loadVectorRailBootstrap(input: {
  ticker: string;
  sessionYmd: string;
  horizon: VectorDteHorizon;
  firstBarTime?: number;
}): Promise<VectorRailBootstrapPayload | null> {
  const ticker = normalizeVectorTicker(input.ticker);
  if (!VECTOR_ORACLE_TICKERS.has(ticker) || !input.sessionYmd) return null;

  const { sessionYmd, horizon, firstBarTime } = input;
  const [blendedRaw, narrowedRaw] = await Promise.all([
    loadSessionWallHistory(sessionYmd, ticker, "all").catch(() => [] as WallHistorySample[]),
    horizon === "all"
      ? Promise.resolve([] as WallHistorySample[])
      : loadSessionWallHistory(sessionYmd, ticker, horizon).catch(() => [] as WallHistorySample[]),
  ]);

  return {
    ticker,
    sessionYmd,
    horizon,
    blended: prepareRailBootstrapHistory(blendedRaw, firstBarTime),
    narrowed: horizon === "all" ? [] : prepareRailBootstrapHistory(narrowedRaw, firstBarTime),
  };
}

/** Parse horizon for the bootstrap route — defaults to 0dte for desk embeds. */
export function resolveRailBootstrapHorizon(
  raw: string | null | undefined
): VectorDteHorizon {
  if (!raw || raw === "0dte") return "0dte";
  return resolveDteHorizonParam(new URLSearchParams({ dte: raw }));
}
