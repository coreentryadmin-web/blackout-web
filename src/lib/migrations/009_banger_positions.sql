-- ENGINE B — whole-market weekly "banger" discovery + live scale-out tracking (2026-08-04).
--
-- WHY a NEW table instead of reusing swing_positions: swing_positions models a MULTI-SESSION swing
-- thesis (structural stop/target in underlying terms, roll chains, calibration ladders). Engine B is a
-- SEPARATE horizon — a cheap OTM weekly call on a whole-market breakout mover, managed by the
-- MECHANICAL scale-out rule (src/lib/zerodte/scale-out.ts: partial at 2x, trail runner at 50% of peak,
-- hard stop at 0.4x) rather than an underlying-terms thesis or a roll ladder. Modeled AFTER
-- swing_positions' idempotency/status-ladder safety patterns (see that table's DDL comment in
-- src/lib/db.ts runMigrations for the three invariants this mirrors), not a reuse of the table itself.
--
-- NOTE: the authoritative copy of this DDL is inlined in src/lib/db.ts runMigrations() (that inline
-- version is what actually runs on ECS cold-start). This file mirrors it for documentation/consistency
-- with 004-008.
CREATE TABLE IF NOT EXISTS banger_positions (
  id BIGSERIAL PRIMARY KEY,
  -- Idempotency + first-write-wins target: session_date:ticker:expiry:strike so a re-running discovery
  -- scan upserts the SAME row instead of duplicating a commit.
  commit_key TEXT NOT NULL,
  session_date DATE NOT NULL,
  ticker TEXT NOT NULL,
  -- Screen provenance (gain/vol/dollar-vol/close-strength at discovery time) — commit-time evidence,
  -- COALESCE-pinned first-write-wins like swing_positions' entry_context.
  discovery_gain NUMERIC,
  discovery_vol NUMERIC,
  discovery_dollar_vol NUMERIC,
  discovery_close_strength NUMERIC,
  -- The OTM weekly call actually picked.
  contract_strike NUMERIC NOT NULL,
  contract_expiry DATE NOT NULL,
  contract_occ TEXT NOT NULL,
  -- Premium latches (contract mark since commit) — running peak, mirrors swing_positions.
  entry_premium NUMERIC NOT NULL,
  last_mark NUMERIC,
  peak_premium NUMERIC,
  -- Scale-out state machine (src/lib/zerodte/scale-out.ts deriveScaleOutAction).
  scaled_already BOOLEAN NOT NULL DEFAULT FALSE,
  scale_out_action TEXT,
  scale_out_reason TEXT,
  -- Realized P&L bookkeeping — the partial tranche's realized premium/pct is frozen the moment
  -- TAKE_PARTIAL fires; the terminal realized fields are frozen once the position reaches CLOSED_RUNNER
  -- or STOPPED and never re-litigated after (mirrors swing_positions' frozen realized_pnl_pct).
  partial_realized_premium NUMERIC,
  realized_pnl_pct NUMERIC,
  realized_pnl_usd NUMERIC,
  -- Commit-time context blob (screen config, session snapshot, etc.) — COALESCE-pinned first-write-wins.
  entry_context JSONB,
  -- Monotonic lifecycle: OPEN -> PARTIAL (2x tranche taken) -> {CLOSED_RUNNER, STOPPED} terminal.
  status TEXT NOT NULL DEFAULT 'OPEN',
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  committed_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_banger_positions_commit_key ON banger_positions(commit_key);

-- Schema-level status guard (same last-line-of-defense pattern as swing_positions_status_ck) — a value
-- off the ladder is rejected at write time regardless of which accessor wrote it.
DO $$ BEGIN
  ALTER TABLE banger_positions ADD CONSTRAINT banger_positions_status_ck
    CHECK (status IN ('OPEN', 'PARTIAL', 'CLOSED_RUNNER', 'STOPPED'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Open-book scan: the live-sync loop's working set.
CREATE INDEX IF NOT EXISTS idx_banger_positions_open
  ON banger_positions(status, session_date DESC)
  WHERE status NOT IN ('CLOSED_RUNNER', 'STOPPED');

CREATE INDEX IF NOT EXISTS idx_banger_positions_session ON banger_positions(session_date DESC);
