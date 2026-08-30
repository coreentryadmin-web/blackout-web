import "server-only";

import { dbConfigured, dbQuery } from "@/lib/db";
import type { VectorPickClosurePayload } from "./vector-pick-closure-log";

export type VectorPickClosureRow = {
  id: number;
  commit_key: string;
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
  close_mid: number | null;
  premium_pct_from_entry: number | null;
  close_reason: string;
  setup_invalidated: boolean;
  spot: number | null;
  vector_play: Record<string, unknown> | null;
  pick_context: Record<string, unknown> | null;
  closed_at: string;
};

export async function insertVectorPickClosure(payload: VectorPickClosurePayload): Promise<boolean> {
  if (!dbConfigured()) return false;
  const res = await dbQuery<{ id: number }>(
    `INSERT INTO vector_pick_closures (
      commit_key, session_date, ticker, occ, side, strike, expiry,
      rank, label, role, entry_mid, close_mid, premium_pct_from_entry,
      close_reason, setup_invalidated, spot, vector_play, pick_context
    ) VALUES (
      $1, $2::date, $3, $4, $5, $6, $7::date,
      $8, $9, $10, $11, $12, $13,
      $14, $15, $16, $17::jsonb, $18::jsonb
    )
    ON CONFLICT (commit_key) DO NOTHING
    RETURNING id`,
    [
      payload.commitKey,
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
      payload.closeMid,
      payload.premiumPctFromEntry,
      payload.closeReason,
      payload.setupInvalidated,
      payload.spot,
      payload.playJson ? JSON.stringify(payload.playJson) : null,
      payload.pickJson ? JSON.stringify(payload.pickJson) : null,
    ]
  );
  return (res.rows?.length ?? 0) > 0;
}

export async function fetchVectorPickClosureRows(
  limit = 120,
  sessionDate: string | null = null
): Promise<VectorPickClosureRow[]> {
  if (!dbConfigured()) return [];
  const params: unknown[] = [limit];
  const sessionClause = sessionDate
    ? (params.push(sessionDate), `AND session_date = $2::date`)
    : "";
  const res = await dbQuery<VectorPickClosureRow>(
    `SELECT
      id, commit_key, session_date::text AS session_date, ticker, occ, side,
      strike::float8 AS strike, expiry::text AS expiry, rank, label, role,
      entry_mid::float8 AS entry_mid, close_mid::float8 AS close_mid,
      premium_pct_from_entry::float8 AS premium_pct_from_entry,
      close_reason, setup_invalidated, spot::float8 AS spot,
      vector_play, pick_context, closed_at::text AS closed_at
    FROM vector_pick_closures
    WHERE TRUE ${sessionClause}
    ORDER BY closed_at DESC
    LIMIT $1`,
    params
  );
  return res.rows ?? [];
}

export async function vectorPickClosureExists(commitKey: string): Promise<boolean> {
  if (!dbConfigured()) return false;
  const res = await dbQuery<{ one: number }>(
    `SELECT 1 AS one FROM vector_pick_closures WHERE commit_key = $1 LIMIT 1`,
    [commitKey]
  );
  return (res.rows?.length ?? 0) > 0;
}
