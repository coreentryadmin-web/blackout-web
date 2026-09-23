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
import { dbQuery, isoDateString, isoTimestampString, toJsonbParam } from "@/lib/db";

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
  /** When a real quote last landed on this row. NULL = a mark was never observed at all — mirrors
   *  swing_positions.last_mark_at (see FINDINGS 2026-09-11: this column didn't exist before that fix,
   *  so every banger-origin position served markAsOf=null forever regardless of true freshness). */
  last_mark_at: string | null;
  peak_premium: number | null;
  /** Running MINIMUM mark since entry (MAE — max adverse excursion), latched the same
   *  GREATEST/LEAST way swing_positions.trough_premium is (see FINDINGS 2026-09-21). Was
   *  absent from this table entirely until that fix — banger_positions only ever tracked
   *  peak_premium, so every banger-origin swing position (BANGER-origin rows merged into the
   *  Swing lane by banger-lane-merge.ts) could never show a Position-card "Trough" or a
   *  closed-play "Drawdown before outcome" line even when the DB genuinely had the data,
   *  because the column to hold it never existed upstream. */
  trough_premium: number | null;
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
    session_date: isoDateString(r.session_date),
    ticker: String(r.ticker).toUpperCase(),
    discovery_gain: num(r.discovery_gain),
    discovery_vol: num(r.discovery_vol),
    discovery_dollar_vol: num(r.discovery_dollar_vol),
    discovery_close_strength: num(r.discovery_close_strength),
    contract_strike: Number(r.contract_strike),
    contract_expiry: isoDateString(r.contract_expiry),
    contract_occ: String(r.contract_occ),
    entry_premium: Number(r.entry_premium),
    last_mark: num(r.last_mark),
    last_mark_at: isoTimestampString(r.last_mark_at),
    peak_premium: num(r.peak_premium),
    trough_premium: num(r.trough_premium),
    scaled_already: Boolean(r.scaled_already),
    scale_out_action: r.scale_out_action != null ? String(r.scale_out_action) : null,
    scale_out_reason: r.scale_out_reason != null ? String(r.scale_out_reason) : null,
    partial_realized_premium: num(r.partial_realized_premium),
    realized_pnl_pct: num(r.realized_pnl_pct),
    realized_pnl_usd: num(r.realized_pnl_usd),
    entry_context: jsonbToObject(r.entry_context),
    status: (r.status as BangerStatus) ?? "OPEN",
    first_seen_at: isoTimestampString(r.first_seen_at) ?? "",
    committed_at: isoTimestampString(r.committed_at),
    closed_at: isoTimestampString(r.closed_at),
    updated_at: isoTimestampString(r.updated_at) ?? "",
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
       -- Same stamp discipline as updateSwingLiveState's last_mark_at: only advance it on a tick
       -- that actually delivered a fresh mark ($3 IS NOT NULL), never on a status-only/scale-out-only
       -- write — otherwise "last touched" would masquerade as "last quoted" (FINDINGS 2026-09-11).
       last_mark_at = CASE WHEN $3 IS NOT NULL THEN NOW() ELSE last_mark_at END,
       peak_premium = CASE WHEN $3 IS NOT NULL THEN GREATEST(COALESCE(peak_premium, $3), $3) ELSE peak_premium END,
       -- FINDINGS 2026-09-21 (Ask Largo/swing audit): peak_premium ratcheted up on every mark but
       -- there was no LEAST-latched counterpart, so banger_positions could never answer "how far
       -- underwater did this position get" — mirrors updateSwingLiveState's identical
       -- peak/trough pair in db.ts.
       trough_premium = CASE WHEN $3 IS NOT NULL THEN LEAST(COALESCE(trough_premium, $3), $3) ELSE trough_premium END,
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
/**
 * TRUE open-position count, independent of any page limit.
 *
 * `fetchBangerBoardRows` takes the most recent N rows of ALL statuses and the caller filters them
 * in JS, so counting the filtered result answers "how many of the last N rows are open" — not "how
 * many positions are open". Those diverge the moment closed rows outnumber the page size, and the
 * divergence is invisible: the number looks like a count because it is one, just of the wrong set.
 *
 * Measured 2026-08-10: Largo reported "40 open positions" in one answer and "20 open positions" in
 * another ~60 seconds later, because it was reading a page-limited tally through a field named
 * `open_count`.
 */
export async function fetchBangerOpenCount(): Promise<number> {
  const res = await dbQuery<{ n: string }>(
    `SELECT count(*)::text AS n FROM banger_positions WHERE status IN ('OPEN','PARTIAL')`,
  );
  const n = Number(res.rows[0]?.n ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export async function fetchBangerBoardRows(limit = 60): Promise<BangerPositionRow[]> {
  const res = await dbQuery<QueryResultRow>(
    `SELECT * FROM banger_positions ORDER BY session_date DESC, id DESC LIMIT $1`,
    [limit],
  );
  return res.rows.map(mapBangerPositionRow);
}

/**
 * Open-book rows only — use for live marks, horizon merge, book-context concentration, and
 * identity resolution (not page-limited all-status scans).
 *
 * `limit` is OPTIONAL and, when omitted, the query carries NO `LIMIT` clause at all — every
 * real OPEN/PARTIAL row is returned. Unlike `fetchBangerBoardRows`'s closed history (unbounded
 * lifetime, genuinely needs paging), the open set is a fixed-in-time snapshot of currently-live
 * positions — the exact same "must never page out from under a live holding" principle
 * `fetchBangerClosedBoardRows`'s own doc comment already states for this side of the split.
 *
 * FIX (Ask Largo standing mandate, live-verified 2026-09-23): every call site previously passed
 * a hardcoded `limit=80`, which silently truncated the real open book the moment true open
 * positions exceeded 80 — measured live at 168 real open banger_positions rows (`ORDER BY
 * session_date DESC, id DESC` means the OLDEST ~88 positions, the ones open longest, were the
 * ones dropped). This is the exact same page-limited-truncation shape already fixed once for
 * `fetchBangerBoardRows` (FINDINGS.md, "GET /api/banger/board hardcodes limit=60... an
 * older-but-still-OPEN position ages out of the shared window and silently vanishes from the
 * board, even though it is a real, live holding") — this function's own OPEN-only filter meant
 * it looked immune to that class of bug, but a hardcoded LIMIT truncates just as surely as a
 * mixed-status page does once the open count grows past it. Confirmed impact: the Swing Command
 * board (`horizons/route.ts`), live marks (`live-marks-active.ts`), book-context concentration
 * (`play-brief-context.ts`), identity resolution (`play-brief-resolve.ts`), and the Banger board
 * itself (`banger/board/route.ts`) all silently dropped ~85-88 real, currently-open member
 * positions — the Swing lane board reported 85 committed positions where 171 (3 native + 168
 * banger) actually exist.
 */
export async function fetchBangerOpenBookRows(limit?: number): Promise<BangerPositionRow[]> {
  const res =
    limit != null
      ? await dbQuery<QueryResultRow>(
          `SELECT * FROM banger_positions
           WHERE status IN ('OPEN','PARTIAL')
           ORDER BY session_date DESC, id DESC
           LIMIT $1`,
          [limit],
        )
      : await dbQuery<QueryResultRow>(
          `SELECT * FROM banger_positions
           WHERE status IN ('OPEN','PARTIAL')
           ORDER BY session_date DESC, id DESC`,
        );
  return res.rows.map(mapBangerPositionRow);
}

/**
 * Closed rows only, newest first — the member board's "recently closed" section. Unlike open
 * positions (unbounded lifetime, must never be paged out from under a live holding), the closed
 * history genuinely grows without bound and paging it is correct — this is the SAME truncation
 * `fetchBangerBoardRows` used to apply to BOTH statuses at once, kept here for the side where it's
 * actually the right call.
 *
 * FIX (Ask Largo standing mandate, live-verified 2026-09-23): this used to sort by `session_date
 * DESC, id DESC` — ENTRY-time recency, not CLOSE-time recency — despite this doc comment's own
 * claim of "newest first" meaning most recently closed. Those diverge hard: PR #5468 (this same
 * session) fixed 41 banger_positions rows stuck OPEN/PARTIAL with an already-expired contract
 * (oldest 40 days past expiry, session_date back in July). Once deployed, the live-sync cron's
 * first RTH tick genuinely closed them (`fetchBangerOpenCount()` confirmed 168 -> 123, a real DB
 * write) — but NONE appeared in this route's 60-row window, because every one of them has an OLD
 * session_date and the old sort put September's freshly-OPENED (but not yet closed) entries ahead
 * of July's freshly-CLOSED ones. A member reading "recently closed" saw only this week's entries
 * and never learned a month-old zombie position had finally resolved. Sorting by `closed_at`
 * (which `updateBangerLiveState` always stamps via `COALESCE(closed_at, NOW())` the moment a row
 * transitions to CLOSED_RUNNER/STOPPED — see that function) fixes this directly; `id DESC` stays
 * as the tiebreak for two rows closing in the same instant.
 */
export async function fetchBangerClosedBoardRows(limit = 60): Promise<BangerPositionRow[]> {
  const res = await dbQuery<QueryResultRow>(
    `SELECT * FROM banger_positions
     WHERE status IN ('CLOSED_RUNNER','STOPPED')
     ORDER BY closed_at DESC, id DESC
     LIMIT $1`,
    [limit],
  );
  return res.rows.map(mapBangerPositionRow);
}
