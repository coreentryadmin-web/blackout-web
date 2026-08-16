import "server-only";

import { logToken } from "@/lib/log-token";

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
    console.warn("[vector-wall-db] persist failed", `${logToken(ticker)}:${logToken(sessionYmd)}`, err);
    return false;
  }
}

/**
 * Upsert MANY samples in ONE statement — the durable write path for the bead recorder.
 *
 * WHY THIS EXISTS. `persistWallSampleToDb` issues one INSERT per sample. The recorder writes ~122
 * tickers x 4 horizons = ~488 samples every 5 seconds, each dispatched fire-and-forget with NO
 * concurrency bound, against a pool of `PG_POOL_MAX=4`. Demand (~98 writes/sec) exceeded what four
 * connections could drain, so the pool's waiter queue grew without limit and every caller past the
 * 15s `connectionTimeoutMillis` threw:
 *
 *   [vector-wall-db] persist failed GRAB::0dte: Error: timeout exceeded when trying to connect
 *
 * Observed continuously across dozens of tickers on prod 2026-08-12. The consequence was NOT a
 * slow rail — it was silent data loss: Redis holds bead rails for 72h and Postgres is the 15-day
 * durable mirror, so anything past the TTL was gone with no durable copy behind it.
 *
 * One multi-row INSERT collapses a sweep's ~488 round-trips into a handful, which takes the load
 * from ~20x the pool's capacity to a small fraction of it. Batching is the fix rather than a bigger
 * pool because the pool is sized against a shared PgBouncer backend budget — widening it here just
 * moves the exhaustion to whoever else needs a connection.
 *
 * Same ON CONFLICT upsert semantics as the single-row path, so a re-recorded bucket still
 * overwrites rather than duplicates. Best-effort: returns the number of rows written, 0 on any
 * failure, and never throws into the recorder.
 */
export async function persistWallSamplesToDb(
  rows: readonly { sessionYmd: string; ticker: string; sample: WallHistorySample }[]
): Promise<number> {
  if (rows.length === 0 || !dbConfigured()) return 0;
  const usable = rows.filter((r) => r.sessionYmd && r.ticker && r.sample);
  if (usable.length === 0) return 0;
  try {
    const values: unknown[] = [];
    const tuples = usable.map((r, i) => {
      const b = i * 7;
      values.push(
        r.ticker,
        r.sessionYmd,
        r.sample.time,
        JSON.stringify(r.sample.walls),
        r.sample.gammaFlip ?? null,
        r.sample.vexWalls ? JSON.stringify(r.sample.vexWalls) : null,
        r.sample.vexFlip ?? null
      );
      return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}::jsonb, $${b + 5}, $${b + 6}::jsonb, $${b + 7})`;
    });
    await dbQuery(
      `
      INSERT INTO vector_wall_history
        (ticker, session_ymd, bucket_time, walls, gamma_flip, vex_walls, vex_flip)
      VALUES ${tuples.join(", ")}
      ON CONFLICT (ticker, session_ymd, bucket_time) DO UPDATE SET
        walls = EXCLUDED.walls,
        gamma_flip = EXCLUDED.gamma_flip,
        vex_walls = EXCLUDED.vex_walls,
        vex_flip = EXCLUDED.vex_flip,
        updated_at = NOW()
      `,
      values
    );
    return usable.length;
  } catch (err) {
    // One line per FLUSH, not per sample — the single-row path logged ~488 lines per sweep during
    // the outage, which buried every other signal in the worker's logs.
    console.warn(`[vector-wall-db] batch persist failed (${usable.length} rows):`, err);
    return 0;
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
    console.warn("[vector-wall-db] tail load failed", `${logToken(ticker)}:${logToken(sessionYmd)}`, err);
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
    console.warn("[vector-wall-db] load failed", `${logToken(ticker)}:${logToken(sessionYmd)}`, err);
    return [];
  }
}
