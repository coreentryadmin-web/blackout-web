/**
 * ENGINE B — banger_positions DB accessors.
 * ============================================================================
 * Follows the swing_positions accessor conventions (src/lib/db.ts): idempotent commit_key upsert with
 * first-write-wins pinning on commit-time columns, a monotonic status ladder enforced IN the SQL
 * (belt) with a schema CHECK (suspenders — see the migration's DDL comment), and typed row mapping.
 * Lives in its own module (rather than growing db.ts further) since Engine B's accessors are a small,
 * self-contained set; all IO still goes through the shared `dbQuery` helper (pool + retry + ensureSchema
 * already wired there).
 */

import type { QueryResultRow } from "pg";
import { dbQuery, toJsonbParam } from "@/lib/db";

export type BangerStatus = "OPEN" | "PARTIAL" | "CLOSED_RUNNER" | "STOPPED";

export type BangerPositionInsert = {
  /** Stable idempotency + first-write-wins target, e.g. `${sessionDate}:${ticker}:${expiry}:${strike}`. */
  commit_key: string;
  session_date: string;
  ticker: string;
  discovery_gain?: number | null;
  discovery_vol?: number | null;
  discovery_dollar_vol?: number | null;
  discovery_close_strength?: number | null;
  contract_strike: number;
  contract_expiry: string;
  contract_occ: string;
  entry_premium: number;
  entry_context?: Record<string, unknown> | null;
};

export type BangerPositionRow = {
  id: number;
  commit_key: string;
  session_date: string;
  ticker: string;
  discovery_gain: number | null;
  discovery_vol: number | null;
  discovery_dollar_vol: number | null;
  discovery_close_strength: number | null;
  contract_strike: number;
  contract_expiry: string;
  contract_occ: string;
  entry_premium: number;
  last_mark: number | null;
  peak_premium: number | null;
  scaled_already: boolean;
  scale_out_action: string | null;
  scale_out_reason: string | null;
  partial_realized_premium: number | null;
  realized_pnl_pct: number | null;
  realized_pnl_usd: number | null;
  entry_context: Record<string, unknown> | null;
  status: BangerStatus;
  first_seen_at: string;
  committed_at: string | null;
  closed_at: string | null;
  updated_at: string;
};

function num(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function jsonbToObject(v: unknown): Record<string, unknown> | null {
  if (v == null) return null;
  if (typeof v === "object") return v as Record<string, unknown>;
  try {
    return JSON.parse(String(v));
  } catch {
    return null;
  }
}

export function mapBangerPositionRow(r: QueryResultRow): BangerPositionRow {
  return {
    id: Number(r.id),
    commit_key: String(r.commit_key),
    session_date: String(r.session_date).slice(0, 10),
    ticker: String(r.ticker).toUpperCase(),
    discovery_gain: num(r.discovery_gain),
    discovery_vol: num(r.discovery_vol),
    discovery_dollar_vol: num(r.discovery_dollar_vol),
    discovery_close_strength: num(r.discovery_close_strength),
    contract_strike: Number(r.contract_strike),
    contract_expiry: String(r.contract_expiry).slice(0, 10),
    contract_occ: String(r.contract_occ),
    entry_premium: Number(r.entry_premium),
    last_mark: num(r.last_mark),
    peak_premium: num(r.peak_premium),
    scaled_already: Boolean(r.scaled_already),
    scale_out_action: r.scale_out_action != null ? String(r.scale_out_action) : null,
    scale_out_reason: r.scale_out_reason != null ? String(r.scale_out_reason) : null,
    partial_realized_premium: num(r.partial_realized_premium),
    realized_pnl_pct: num(r.realized_pnl_pct),
    realized_pnl_usd: num(r.realized_pnl_usd),
    entry_context: jsonbToObject(r.entry_context),
    status: (r.status as BangerStatus) ?? "OPEN",
    first_seen_at: String(r.first_seen_at),
    committed_at: r.committed_at != null ? String(r.committed_at) : null,
    closed_at: r.closed_at != null ? String(r.closed_at) : null,
    updated_at: String(r.updated_at),
  };
}

/** Columns pinned first-write-wins on the commit_key upsert — identity + commit-time evidence. A
 *  re-running discovery scan must not re-pick the contract or re-stamp the discovery-screen snapshot. */
const BANGER_PINNED_COLUMNS = [
  "discovery_gain",
  "discovery_vol",
  "discovery_dollar_vol",
  "discovery_close_strength",
  "contract_strike",
  "contract_expiry",
  "contract_occ",
  "entry_premium",
  "entry_context",
] as const;

/**
 * Insert (or idempotently re-touch) a committed banger position. Upserts on commit_key so a re-running
 * discovery scan lands on the SAME row; every identity + commit-time column is COALESCE-pinned
 * first-write-wins. Returns the position id.
 */
export async function insertBangerPosition(pos: BangerPositionInsert): Promise<number> {
  const res = await dbQuery<{ id: string }>(
    `
    INSERT INTO banger_positions (
      commit_key, session_date, ticker, discovery_gain, discovery_vol, discovery_dollar_vol,
      discovery_close_strength, contract_strike, contract_expiry, contract_occ, entry_premium,
      entry_context, status, committed_at, updated_at
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,'OPEN',NOW(),NOW()
    )
    ON CONFLICT (commit_key) DO UPDATE SET
      ${BANGER_PINNED_COLUMNS.map((c) => `${c} = COALESCE(banger_positions.${c}, EXCLUDED.${c})`).join(",\n      ")},
      updated_at = NOW()
    RETURNING id
    `,
    [
      pos.commit_key,
      pos.session_date,
      pos.ticker.toUpperCase(),
      pos.discovery_gain ?? null,
      pos.discovery_vol ?? null,
      pos.discovery_dollar_vol ?? null,
      pos.discovery_close_strength ?? null,
      pos.contract_strike,
      pos.contract_expiry,
      pos.contract_occ,
      pos.entry_premium,
      toJsonbParam(pos.entry_context ?? null),
    ],
  );
  return Number(res.rows[0]!.id);
}

export type BangerLiveStateUpdate = {
  status: BangerStatus;
  mark?: number | null;
  scaleOutAction?: string | null;
  scaleOutReason?: string | null;
  /** Set true exactly once, when TAKE_PARTIAL fires. */
  scaledNow?: boolean;
  partialRealizedPremium?: number | null;
  realizedPnlPct?: number | null;
  realizedPnlUsd?: number | null;
};

/**
 * Latch live state on an open banger position. Status write is guarded by a monotonic CASE in SQL
 * (mirrors updateSwingLiveState) — two writers racing on a possibly-stale row snapshot can never regress
 * a terminal status (CLOSED_RUNNER/STOPPED) or move PARTIAL back to OPEN. Marks + peak always land (a
 * fresh quote is never dropped by the status guard); peak_premium ratchets monotonically up.
 */
export async function updateBangerLiveState(id: number, s: BangerLiveStateUpdate): Promise<void> {
  await dbQuery(
    `UPDATE banger_positions SET
       status = CASE
         WHEN status IN ('CLOSED_RUNNER','STOPPED') THEN status               -- terminal frozen
         WHEN status = 'PARTIAL' AND $2 = 'OPEN' THEN status                   -- PARTIAL never regresses to OPEN
         WHEN $2 NOT IN ('OPEN','PARTIAL','CLOSED_RUNNER','STOPPED') THEN status -- fail-closed on an unknown target
         ELSE $2
       END,
       last_mark = COALESCE($3, last_mark),
       peak_premium = CASE WHEN $3 IS NOT NULL THEN GREATEST(COALESCE(peak_premium, $3), $3) ELSE peak_premium END,
       scaled_already = scaled_already OR COALESCE($4, FALSE),
       scale_out_action = COALESCE($5, scale_out_action),
       scale_out_reason = COALESCE($6, scale_out_reason),
       -- Realized figures are pinned first-write-wins per phase: the partial tranche's realized premium
       -- is stamped once (WHERE-guarded) and never overwritten by a later tick; same for the terminal
       -- realized fields once the position closes.
       partial_realized_premium = COALESCE(partial_realized_premium, $7),
       realized_pnl_pct = CASE WHEN $2 IN ('CLOSED_RUNNER','STOPPED') THEN COALESCE(realized_pnl_pct, $8) ELSE realized_pnl_pct END,
       realized_pnl_usd = CASE WHEN $2 IN ('CLOSED_RUNNER','STOPPED') THEN COALESCE(realized_pnl_usd, $9) ELSE realized_pnl_usd END,
       closed_at = CASE WHEN $2 IN ('CLOSED_RUNNER','STOPPED') THEN COALESCE(closed_at, NOW()) ELSE closed_at END,
       updated_at = NOW()
     WHERE id = $1`,
    [
      id,
      s.status,
      s.mark ?? null,
      s.scaledNow ?? null,
      s.scaleOutAction ?? null,
      s.scaleOutReason ?? null,
      s.partialRealizedPremium ?? null,
      s.realizedPnlPct ?? null,
      s.realizedPnlUsd ?? null,
    ],
  );
}

/** Every live (non-terminal) banger position — the live-sync loop's working set. */
export async function fetchOpenBangerPositions(): Promise<BangerPositionRow[]> {
  const res = await dbQuery<QueryResultRow>(
    `SELECT * FROM banger_positions WHERE status NOT IN ('CLOSED_RUNNER','STOPPED') ORDER BY session_date DESC, id DESC`,
  );
  return res.rows.map(mapBangerPositionRow);
}

/** Open + recently-closed rows for the member board (bounded read, newest first). */
export async function fetchBangerBoardRows(limit = 60): Promise<BangerPositionRow[]> {
  const res = await dbQuery<QueryResultRow>(
    `SELECT * FROM banger_positions ORDER BY session_date DESC, id DESC LIMIT $1`,
    [limit],
  );
  return res.rows.map(mapBangerPositionRow);
}
