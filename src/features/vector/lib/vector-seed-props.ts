import "server-only";
import { todayEt } from "@/features/nighthawk/lib/session";
import { ensureDataSockets } from "@/lib/ws/init-data-sockets";
import type { VectorBar } from "@/features/vector/components/VectorChart";
import type { VectorDarkPoolLevel, VectorWalls } from "@/lib/api";
import { fetchVectorSeedBars } from "@/features/vector/lib/vector-seed-bars";
import { lastSessionBars } from "@/features/vector/lib/vector-key-levels";
import {
  getVectorDarkPoolLevels,
  getVectorGammaFlip,
  getVectorGexWalls,
  getVectorVexFlip,
  getVectorVexWalls,
  primeVectorWallScope,
} from "@/features/vector/lib/vector-snapshot";
import {
  seedWallHistoryForDisplay,
  decimateSeedHistory,
  trimHistoryToSession,
  type WallHistorySample,
} from "@/features/vector/lib/vector-wall-history";
import { enrichSessionWallHistory } from "@/features/vector/lib/vector-wall-history-enrich";
import { loadSessionWallHistory } from "@/features/vector/lib/vector-wall-persist";
import { resolveWallTrailSampleSec } from "@/features/vector/lib/vector-wall-sample-server";
import type { VectorDteHorizon } from "@/features/vector/lib/vector-dte-horizon";

/** Server-seeded props consumed by VectorPageShell (SSR snapshot for first paint). */
export type VectorSeedProps = {
  ticker: string;
  initialBars: VectorBar[];
  initialWalls: VectorWalls | null;
  initialVexWalls: VectorWalls | null;
  initialWallHistory: WallHistorySample[];
  /** Preloaded per-horizon recorded rail for the host's default DTE (e.g. SPX desk 0DTE). */
  initialHorizonWallHistory: WallHistorySample[];
  initialGammaFlip: number | null;
  initialVexFlip: number | null;
  initialDarkPoolLevels: VectorDarkPoolLevel[];
  sessionYmd: string;
  liveSession: boolean;
  /** Server-resolved bead bucket size (5s shared universe, 15s on-demand). */
  initialWallTrailSec: number;
};

export type LoadVectorSeedOpts = {
  /** When set, also SSR-load the recorded wall-history rail for this horizon so narrowed
   *  toggles (SPX desk 0DTE) paint the full session on first paint, not a single live column. */
  seedDteHorizon?: VectorDteHorizon;
};

/**
 * ONE server-side seed loader for every surface that embeds Vector (the /vector page AND the
 * SPX Slayer flagship dashboard). Extracted from the /vector page (2026-07-13, member-directed
 * desk consolidation) so the two entry points can never drift: same bars, same wall scope, same
 * observed-rail merge + modeled-prefix backfill + empty-case seeding on both routes.
 *
 * `ticker` must already be normalized (normalizeVectorTicker) by the caller.
 */
export async function loadVectorSeedProps(
  ticker: string,
  opts: LoadVectorSeedOpts = {}
): Promise<VectorSeedProps> {
  ensureDataSockets();
  await primeVectorWallScope(ticker);
  const [{ bars, sessionYmd }, walls, vexWalls, gammaFlip, vexFlip, darkPoolLevels, initialWallTrailSec] =
    await Promise.all([
      fetchVectorSeedBars(ticker),
      Promise.resolve(getVectorGexWalls(ticker)),
      Promise.resolve(getVectorVexWalls(ticker)),
      getVectorGammaFlip(ticker),
      Promise.resolve(getVectorVexFlip(ticker)),
      getVectorDarkPoolLevels(ticker),
      resolveWallTrailSampleSec(ticker),
    ]);
  const persistedHistory = await loadSessionWallHistory(sessionYmd, ticker).catch(
    () => [] as WallHistorySample[]
  );
  const today = todayEt();
  // 24/7 spot: liveSession drives ALL client-side live-update plumbing (SSE, SWR polling,
  // freshness clock). Gate on today's date only — the server-side UW WebSocket and SSE
  // endpoint already serve data around the clock (PR #438).
  const liveSession = sessionYmd === today;

  // Observed rail first — exactly what the live recorder captured point-in-time during RTH:
  // genuinely dynamic walls that shift/build/fade with the tape (in-memory + persisted Redis/PG
  // rows). `sessionYmd` comes from fetchVectorSeedBars, which walks back to the most recent day
  // that actually HAS price bars — so off-hours (weekend/overnight) this is the last RTH session,
  // and loadSessionWallHistory(sessionYmd) returns THAT session's real recorded beads. The bars
  // and the rail therefore always describe the same session and align on the time axis.
  const sessionBars = lastSessionBars(bars);
  const firstBar = sessionBars[0]?.time;
  const sessionScopedHistory = await enrichSessionWallHistory({
    ticker,
    sessionYmd,
    persistedHistory,
    bars,
    mergeLiveMemory: true,
    decimate: true,
  });

  // Empty-case fallback: a single as-of-close snapshot at the last bar when there is genuinely
  // nothing recorded OR reconstructable for this session. No-ops whenever the rail already has
  // samples. Never a full-day fabrication.
  const initialWallHistory = seedWallHistoryForDisplay(
    sessionScopedHistory,
    bars.map((b) => b.time),
    walls,
    gammaFlip,
    vexWalls,
    vexFlip
  );

  const seedHorizon = opts.seedDteHorizon;
  const initialHorizonWallHistory =
    seedHorizon && seedHorizon !== "all"
      ? decimateSeedHistory(
          trimHistoryToSession(
            await loadSessionWallHistory(sessionYmd, ticker, seedHorizon).catch(
              () => [] as WallHistorySample[]
            ),
            firstBar
          )
        )
      : [];

  return {
    ticker,
    initialBars: bars,
    initialWalls: walls,
    initialVexWalls: vexWalls,
    initialWallHistory,
    initialHorizonWallHistory,
    initialGammaFlip: gammaFlip,
    initialVexFlip: vexFlip,
    initialDarkPoolLevels: darkPoolLevels,
    sessionYmd,
    liveSession,
    initialWallTrailSec,
  };
}
