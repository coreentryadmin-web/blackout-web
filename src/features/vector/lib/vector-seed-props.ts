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
  getVectorWallHistory,
  primeVectorWallScope,
} from "@/features/vector/lib/vector-snapshot";
import {
  backfillRailGaps,
  railUncoveredSec,
  mergeWallHistory,
  seedWallHistoryForDisplay,
  decimateSeedHistory,
  trimHistoryToSession,
  type WallHistorySample,
} from "@/features/vector/lib/vector-wall-history";
import { loadSessionWallHistory } from "@/features/vector/lib/vector-wall-persist";
import { reconstructSessionRail } from "@/features/vector/lib/vector-gex-reconstruct-server";
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
  const combined = mergeWallHistory(getVectorWallHistory(ticker), persistedHistory);

  // UNIVERSE PARITY (2026-07-13, user-directed): Vector must behave the same for EVERY optionable
  // ticker, not just the pre-recorded ~20-name universe. A ticker with no viewer has no recorded
  // rail before its first view, so the first member of the day saw single beads. Backfill ONLY the
  // missing PREFIX (before the first observed sample) from the reconstruction: today's published OI
  // with gamma recomputed along the session's REAL spot path — genuinely time-varying, and now
  // rendered through the per-bucket DOMINANCE filter so it shows honest staggered births, not the
  // flat axis-to-axis underlay that got the model removed on 2026-07-12 (that flatness was the
  // dominance bug, since fixed). Modeled beads draw as faint ghosts (MODELED_ALPHA_SCALE) under
  // solid observed ones, and the model never overwrites or extends past a real sample — a member
  // can always tell recorded structure from reconstructed context. Redis-cached per ticker+session;
  // best-effort (a reconstruction failure just leaves the honest gap).
  // Bars of the LATEST session, not bars[0..]: the seed carries ~3 sessions, so bars[0] is the
  // OLDEST session's open. Measuring coverage against a two-days-ago open would report the whole
  // window as a gap on every load. The rail, the reconstruction (sessionYmd-scoped), and this
  // coverage check must all describe the SAME (displayed/latest) session.
  const sessionBars = lastSessionBars(bars);
  const firstBar = sessionBars[0]?.time;
  const lastBar = sessionBars[sessionBars.length - 1]?.time;
  // FULL-DAY RAIL (FINDINGS 2026-08-07): reconstruct whenever the observed rail leaves ANY material
  // hole in the session, not only a leading one. The recorder is viewer-driven for tickers outside
  // the shared universe (`recordActiveNonUniverseWallSamples` samples `getActiveVectorTickers()`),
  // so gaps appear wherever nobody had the chart open — mid-session and, every single day, from the
  // 16:00 close to the last extended-hours bar. The old `firstObserved - firstBar > 20min` test only
  // ever saw the front, so those blank blocks shipped to members untouched.
  // `reconstructSessionRail` is Redis-cached per ticker+session, so asking more often is cheap.
  const uncoveredSec = railUncoveredSec(combined, firstBar, lastBar);
  const modeledRail =
    bars.length > 0 && uncoveredSec > 20 * 60
      ? await reconstructSessionRail({ ticker, sessionYmd }).catch(() => [] as WallHistorySample[])
      : ([] as WallHistorySample[]);
  const backfilled = backfillRailGaps(combined, modeledRail, firstBar, lastBar);

  // SSR-payload size guard (2026-08-01): `combined`/`backfilled` can carry up to MAX_HISTORY
  // (24h of 15s buckets, ~3-4 sessions) for recorder resilience across restarts, but this page
  // renders ONE session (bars is session-scoped display data). Prior-session samples were riding
  // along into every SSR payload as dead weight the client never draws — measured 28-50MB HTML /
  // 10-12s downloads on /vector and the SPX Slayer embed before this trim. Never clips the
  // backfilled prefix (always >= firstBar) or the current session's observed rail.
  // …but ONE session at the oracle recorder's 5s cadence is still 5,760 samples x ~2.5KB of wall
  // ladder. Measured live on /vector?ticker=SPX (2026-08-07): initialWallHistory 14.76MB +
  // initialHorizonWallHistory 7.82MB = 22.6MB of a 22.8MB HTML document, next to 143KB of actual
  // price bars. That is over-RESOLUTION, not just size — 5,760 bead columns on a ~1,600px chart is
  // ~3.6 columns per pixel. decimateSeedHistory keeps the newest 30 minutes at full recorder
  // fidelity and buckets the older tail to 15s (the cadence non-oracle tickers already ship), which
  // the chart can actually resolve. The live SSE/poll path still appends at full cadence, so a
  // member watching the session sees exactly what they see today.
  const sessionScopedHistory = decimateSeedHistory(trimHistoryToSession(backfilled, firstBar));

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
