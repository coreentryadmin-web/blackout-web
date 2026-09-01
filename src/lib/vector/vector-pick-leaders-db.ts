import "server-only";

import { dbConfigured, dbQuery } from "@/lib/db";
import type { VectorPickActionStatus } from "@/features/vector/lib/vector-pick-live-status";

export type VectorPickLeaderRow = {
  id: number;
  leader_key: string;
  session_date: string;
  ticker: string;
  occ: string;
  side: string;
  strike: number;
  expiry: string;
  rank: number | null;
  label: string | null;
  role: string | null;
  entry_mid: number | null;
  live_mid: number | null;
  premium_pct_from_entry: number | null;
  peak_premium_pct: number | null;
  action_status: VectorPickActionStatus;
  action_reason: string;
  setup_invalidated: boolean;
  spot: number | null;
  vector_play: Record<string, unknown> | null;
  pick_context: Record<string, unknown> | null;
  first_seen_at: string;
  updated_at: string;
};

export type VectorPickLeaderUpsert = {
  leaderKey: string;
  sessionDate: string;
  ticker: string;
  occ: string;
  side: "call" | "put";
  strike: number;
  expiry: string;
  rank: number | null;
  label: string | null;
  role: string | null;
  entryMid: number | null;
  liveMid: number | null;
  premiumPctFromEntry: number | null;
  peakPremiumPct: number | null;
  actionStatus: VectorPickActionStatus;
  actionReason: string;
  setupInvalidated: boolean;
  spot: number;
  playJson: Record<string, unknown> | null;
  pickJson: Record<string, unknown> | null;
};

export async function upsertVectorPickLeader(payload: VectorPickLeaderUpsert): Promise<boolean> {
  if (!dbConfigured()) return false;
  const res = await dbQuery<{ id: number }>(
    `INSERT INTO vector_pick_leaders (
      leader_key, session_date, ticker, occ, side, strike, expiry,
      rank, label, role, entry_mid, live_mid, premium_pct_from_entry, peak_premium_pct,
      action_status, action_reason, setup_invalidated, spot, vector_play, pick_context
    ) VALUES (
      $1, $2::date, $3, $4, $5, $6, $7::date,
      $8, $9, $10, $11, $12, $13, $14,
      $15, $16, $17, $18, $19::jsonb, $20::jsonb
    )
    ON CONFLICT (leader_key) DO UPDATE SET
      live_mid = EXCLUDED.live_mid,
      premium_pct_from_entry = EXCLUDED.premium_pct_from_entry,
      peak_premium_pct = GREATEST(
        COALESCE(vector_pick_leaders.peak_premium_pct, EXCLUDED.peak_premium_pct),
        COALESCE(EXCLUDED.peak_premium_pct, vector_pick_leaders.peak_premium_pct)
      ),
      action_status = EXCLUDED.action_status,
      action_reason = EXCLUDED.action_reason,
      setup_invalidated = EXCLUDED.setup_invalidated,
      spot = EXCLUDED.spot,
      vector_play = EXCLUDED.vector_play,
      pick_context = EXCLUDED.pick_context,
      updated_at = NOW()
    RETURNING id`,
    [
      payload.leaderKey,
      payload.sessionDate,
      payload.ticker,
      payload.occ,
      payload.side,
      payload.strike,
      payload.expiry.slice(0, 10),
      payload.rank,
      payload.label,
      payload.role,
      payload.entryMid,
      payload.liveMid,
      payload.premiumPctFromEntry,
      payload.peakPremiumPct,
      payload.actionStatus,
      payload.actionReason,
      payload.setupInvalidated,
      payload.spot,
      payload.playJson ? JSON.stringify(payload.playJson) : null,
      payload.pickJson ? JSON.stringify(payload.pickJson) : null,
    ]
  );
  return (res.rows?.length ?? 0) > 0;
}

/**
 * The frozen entry basis for an already-tracked leader, keyed by `leader_key`. `entry_mid` is
 * intentionally NOT in `upsertVectorPickLeader`'s `ON CONFLICT ... DO UPDATE SET` — it is a
 * first-write-wins entry price, same discipline as the 0DTE ledger's `entry_premium`. Callers
 * computing a live drift % must re-use THIS value once a row exists, not re-derive a fresh
 * "entry" from the current sweep pass (see `vector-pick-sweep.ts`'s call site for why: the
 * ranked-pick premium for the same rank/role/occ is re-computed from the live chain every pass
 * and can differ from the one the row was first opened against).
 */
export async function fetchVectorPickLeaderEntryMid(leaderKey: string): Promise<number | null> {
  if (!dbConfigured()) return null;
  const res = await dbQuery<{ entry_mid: number | null }>(
    `SELECT entry_mid::float8 AS entry_mid FROM vector_pick_leaders WHERE leader_key = $1 LIMIT 1`,
    [leaderKey]
  );
  return res.rows?.[0]?.entry_mid ?? null;
}

export async function fetchVectorPickLeaderRows(opts?: {
  sessionDate?: string | null;
  limit?: number;
}): Promise<VectorPickLeaderRow[]> {
  if (!dbConfigured()) return [];
  const limit = Math.min(500, Math.max(1, opts?.limit ?? 200));
  const sessionDate = opts?.sessionDate?.trim() || null;

  const res = sessionDate
    ? await dbQuery<VectorPickLeaderRow>(
        `SELECT
          id, leader_key, session_date::text AS session_date, ticker, occ, side,
          strike::float8 AS strike, expiry::text AS expiry, rank, label, role,
          entry_mid::float8 AS entry_mid, live_mid::float8 AS live_mid,
          premium_pct_from_entry::float8 AS premium_pct_from_entry,
          peak_premium_pct::float8 AS peak_premium_pct,
          action_status, action_reason, setup_invalidated, spot::float8 AS spot,
          vector_play, pick_context,
          first_seen_at::text AS first_seen_at, updated_at::text AS updated_at
        FROM vector_pick_leaders
        WHERE session_date = $2::date
        ORDER BY GREATEST(COALESCE(premium_pct_from_entry, -9999), COALESCE(peak_premium_pct, -9999)) DESC,
          updated_at DESC
        LIMIT $1`,
        [limit, sessionDate]
      )
    : await dbQuery<VectorPickLeaderRow>(
        `SELECT
          id, leader_key, session_date::text AS session_date, ticker, occ, side,
          strike::float8 AS strike, expiry::text AS expiry, rank, label, role,
          entry_mid::float8 AS entry_mid, live_mid::float8 AS live_mid,
          premium_pct_from_entry::float8 AS premium_pct_from_entry,
          peak_premium_pct::float8 AS peak_premium_pct,
          action_status, action_reason, setup_invalidated, spot::float8 AS spot,
          vector_play, pick_context,
          first_seen_at::text AS first_seen_at, updated_at::text AS updated_at
        FROM vector_pick_leaders
        ORDER BY session_date DESC,
          GREATEST(COALESCE(premium_pct_from_entry, -9999), COALESCE(peak_premium_pct, -9999)) DESC,
          updated_at DESC
        LIMIT $1`,
        [limit]
      );
  return res.rows ?? [];
}
