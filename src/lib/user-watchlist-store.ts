// Server-side persistence for a user's watchlist. Backs the native iOS app's
// cross-device sync and (eventually) the web watchlist as well — today the
// web keeps its localStorage-only store; migrating that reader to this table
// is a separate PR so this slice stays scoped to enabling the native app.
//
// Storage: one row per user in `user_watchlists`, tickers as TEXT[] so
// ordering is preserved (user's insertion order is user-meaningful — a
// reordered list is a different watchlist to them).
//
// Ticker normalization deliberately REUSES `normalizeTicker` from
// `watchlist-store.ts` so client and server agree byte-for-byte (case, char
// class, length cap). Any drift there → drift on this table → subtle
// "why isn't SPX in my list" bug.

import { dbConfigured, dbQuery } from "@/lib/db";
import { normalizeTicker, MAX_WATCHLIST } from "@/lib/watchlist-store";

/** Idempotent create — matches the pattern used by push_subscriptions +
 *  push_native_devices (lazy CREATE TABLE IF NOT EXISTS at route entry
 *  instead of a global migration change). */
export async function ensureUserWatchlistTable(): Promise<void> {
  await dbQuery(`
    CREATE TABLE IF NOT EXISTS user_watchlists (
      user_id     TEXT PRIMARY KEY,
      tickers     TEXT[] NOT NULL DEFAULT '{}',
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

/** Read the caller's watchlist. Returns an empty array (never null) so callers
 *  can treat "no row yet" the same as "empty list" — this is a UI store, not
 *  a domain object with meaningful nullity. */
export async function getUserWatchlist(userId: string): Promise<string[]> {
  if (!dbConfigured()) return [];
  await ensureUserWatchlistTable();
  const rows = (await dbQuery(
    `SELECT tickers FROM user_watchlists WHERE user_id = $1`,
    [userId]
  )).rows as Array<{ tickers: string[] | null }>;
  const raw = rows[0]?.tickers ?? [];
  // Defensive normalize on read — a hand-inserted or externally-migrated row
  // shouldn't leak un-normalized values into the client.
  return sanitize(raw);
}

/** Replace the caller's watchlist with the supplied list. Normalizes + dedupes
 *  + caps at MAX_WATCHLIST before writing so the DB matches the client
 *  contract exactly. UPSERT so a first-time user creates a row without a
 *  separate INSERT/UPDATE branch. */
export async function setUserWatchlist(userId: string, incoming: string[]): Promise<string[]> {
  if (!dbConfigured()) return [];
  await ensureUserWatchlistTable();
  const clean = sanitize(incoming);
  await dbQuery(
    `INSERT INTO user_watchlists (user_id, tickers, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (user_id)
     DO UPDATE SET tickers = EXCLUDED.tickers, updated_at = now()`,
    [userId, clean]
  );
  return clean;
}

/** Public for testability. Normalize + dedupe + cap while PRESERVING insertion
 *  order. Non-string entries are dropped; empty entries are dropped. */
export function sanitize(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    if (typeof item !== "string") continue;
    const t = normalizeTicker(item);
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= MAX_WATCHLIST) break;
  }
  return out;
}
