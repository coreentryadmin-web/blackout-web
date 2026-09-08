import type { GexWalls } from "@/lib/providers/gex-wall-levels";
import type { WallHistorySample } from "./vector-wall-history";

/**
 * PURE row-mapping for the durable Vector wall-history rail.
 *
 * Split out of vector-wall-db.ts (which is `import "server-only"`) so the mapper can be unit
 * tested with a plain `tsx --test` run: importing the server-only module directly throws
 * ("cannot be imported from a Client Component"), so the test targets THIS side-effect-free
 * file instead. vector-wall-db.ts re-exports `rowToWallSample` so its public surface is
 * unchanged for real (server) callers.
 */

export type WallRow = {
  bucket_time: number | string | bigint;
  walls: GexWalls | string;
  gamma_flip: number | null;
  vex_walls: GexWalls | string | null;
  vex_flip: number | null;
};

/** pg returns jsonb as an already-parsed object, but tolerate a string just in case. */
function asWalls(value: GexWalls | string | null): GexWalls | null {
  if (value == null) return null;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as GexWalls;
    } catch {
      return null;
    }
  }
  return value;
}

/**
 * DB row → sample mapper. bucket_time is a BIGINT and pg may hand it back as a string, so
 * coerce with Number(); null gamma/vex columns map to nulls (legacy rows never had vex).
 */
export function rowToWallSample(row: WallRow): WallHistorySample {
  return {
    time: Number(row.bucket_time),
    walls: (asWalls(row.walls) ?? { callWalls: [], putWalls: [] }) as GexWalls,
    gammaFlip: row.gamma_flip ?? null,
    vexWalls: asWalls(row.vex_walls),
    vexFlip: row.vex_flip ?? null,
  };
}

/**
 * Deterministic row order for the multi-row UPSERT in persistWallSamplesToDb — by the exact
 * (ticker, session_ymd, bucket_time) ON CONFLICT target.
 *
 * Each web replica keeps its own in-process durableQueue (module-level state in
 * vector-wall-persist.ts) and flushes on its own ~2s timer, so two replicas' batches for popular
 * tickers (many SSE-connected clients spread across the fleet) routinely overlap in time. Without
 * a deterministic row order, replica A's batch might lock ticker "SPX" then want "QQQ" while
 * replica B's batch (built from ITS OWN Map's insertion order, unrelated to A's) locks "QQQ" then
 * wants "SPX" — the textbook circular wait Postgres reports as `deadlock detected`. A deadlocked
 * multi-row UPSERT rolls back the WHOLE batch, not just the colliding rows — silent data loss on
 * the durable mirror. Sorting makes every concurrent writer (any replica, the bead recorder, cron
 * snapshots) acquire row locks in the SAME global order, the standard fix for this deadlock shape.
 * Confirmed live 2026-09-01: 4 `deadlock detected` errors on this exact INSERT over a ~29h window
 * in production telemetry. Pure (no server-only import) so it is unit-testable directly.
 */
export function sortWallSamplesForUpsert<T extends { ticker: string; sessionYmd: string; sample: { time: number } }>(
  rows: readonly T[]
): T[] {
  return [...rows].sort((a, b) => {
    if (a.ticker !== b.ticker) return a.ticker < b.ticker ? -1 : 1;
    if (a.sessionYmd !== b.sessionYmd) return a.sessionYmd < b.sessionYmd ? -1 : 1;
    return a.sample.time - b.sample.time;
  });
}
