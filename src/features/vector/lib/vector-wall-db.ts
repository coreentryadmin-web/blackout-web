import "server-only";

import { dbConfigured, dbQuery } from "@/lib/db";
import type { WallHistorySample } from "./vector-wall-history";
import { rowToWallSample, type WallRow } from "./vector-wall-db-row";

/**
 * Durable Postgres write-through for the Vector wall-history rail.
 *
 * The rail's hot path is Redis (48h TTL — see vector-wall-persist.ts). This module is the
 * durable mirror: recorder writes fan out here too, and reads fall back here when Redis is
 * cold (restart / eviction). Everything is best-effort — a DB failure must NEVER throw into
 * the live stream, so every export swallows its error and returns a neutral value.
 *
 * server-only: this file must not be pulled into a client bundle. vector-wall-persist.ts (which
 * is reachable from the client-facing feature barrel) imports it via a LAZY dynamic import so
 * this marker never leaks into the browser build. The PURE row mapper lives in the
 * side-effect-free vector-wall-db-row.ts (unit-testable without tripping server-only); it is
 * re-exported here so the module's public surface is unchanged.
 */
export { rowToWallSample } from "./vector-wall-db-row";

/**
 * Upsert ONE bar sample into the durable rail (best-effort). Idempotent per
 * (ticker, session_ymd, bucket_time) so a re-recorded bucket overwrites rather than duplicates.
 * Returns false (never throws) on any guard miss or DB error.
 */
export async function persistWallSampleToDb(
  sessionYmd: string,
  sample: WallHistorySample,
  ticker = "SPX"
): Promise<boolean> {
  if (!sessionYmd || !dbConfigured()) return false;
  try {
    await dbQuery(
      `
      INSERT INTO vector_wall_history
        (ticker, session_ymd, bucket_time, walls, gamma_flip, vex_walls, vex_flip)
      VALUES ($1, $2, $3, $4::jsonb, $5, $6::jsonb, $7)
      ON CONFLICT (ticker, session_ymd, bucket_time) DO UPDATE SET
        walls = EXCLUDED.walls,
        gamma_flip = EXCLUDED.gamma_flip,
        vex_walls = EXCLUDED.vex_walls,
        vex_flip = EXCLUDED.vex_flip,
        updated_at = NOW()
      `,
      [
        ticker,
        sessionYmd,
        sample.time,
        JSON.stringify(sample.walls),
        sample.gammaFlip ?? null,
        sample.vexWalls ? JSON.stringify(sample.vexWalls) : null,
        sample.vexFlip ?? null,
      ]
    );
    return true;
  } catch (err) {
    console.warn(`[vector-wall-db] persist failed ${ticker}:${sessionYmd}:`, err);
    return false;
  }
}

/**
 * Load the durable per-bar rail for a session, ascending by bucket. Returns [] (never throws)
 * on any guard miss or DB error — the caller treats an empty rail as "nothing durable, use Redis".
 */
/**
 * Load only the NEWEST `limit` samples of a session's rail, ascending.
 *
 * Some callers need one sample per session, not the session. `daily-regime` is the clear case: it
 * keeps the last reading of each of ~15 sessions to draw an end-of-session regime overlay, and was
 * loading every rail in full to do it. For the SPX oracle ticker that is ~5,760 samples carrying a
 * 20-per-side ladder each, per session, to produce one row — measured at 30.2s for a 1.3 KB
 * response before this existed.
 *
 * `vector_wall_history_lookup_idx` is `(ticker, session_ymd, bucket_time)`, so DESC + LIMIT is a
 * single index seek rather than a scan-then-sort. Re-sorted ascending on the way out so the return
 * shape matches `loadSessionWallHistoryFromDb` exactly and callers cannot tell the two apart.
 */
export async function loadSessionWallTailFromDb(
  sessionYmd: string,
  ticker = "SPX",
  limit = 1
): Promise<WallHistorySample[]> {
  if (!sessionYmd || !dbConfigured()) return [];
  const capped = Math.max(1, Math.min(500, Math.trunc(limit)));
  try {
    const res = await dbQuery<WallRow>(
      `
      SELECT bucket_time, walls, gamma_flip, vex_walls, vex_flip
      FROM vector_wall_history
      WHERE ticker = $1 AND session_ymd = $2
      ORDER BY bucket_time DESC
      LIMIT $3
      `,
      [ticker, sessionYmd, capped]
    );
    return res.rows.map(rowToWallSample).reverse();
  } catch (err) {
    console.warn(`[vector-wall-db] tail load failed ${ticker}:${sessionYmd}:`, err);
    return [];
  }
}

export async function loadSessionWallHistoryFromDb(
  sessionYmd: string,
  ticker = "SPX"
): Promise<WallHistorySample[]> {
  if (!sessionYmd || !dbConfigured()) return [];
  try {
    const res = await dbQuery<WallRow>(
      `
      SELECT bucket_time, walls, gamma_flip, vex_walls, vex_flip
      FROM vector_wall_history
      WHERE ticker = $1 AND session_ymd = $2
      ORDER BY bucket_time ASC
      `,
      [ticker, sessionYmd]
    );
    return res.rows.map(rowToWallSample);
  } catch (err) {
    console.warn(`[vector-wall-db] load failed ${ticker}:${sessionYmd}:`, err);
    return [];
  }
}
