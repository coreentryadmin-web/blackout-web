-- Helix Tier 2 (item #9): persist every velocity-spike / split-flow signal firing so
-- there's a real historical record of "did this signal actually predict continuation" —
-- today Helix computes these signals live in the browser and throws them away. This is a
-- DEDICATED per-feature table (ticker/signal_type/window_start/outcome), NOT a reuse of
-- the generic `signal_events`/`signal_outcomes` bridge (004_god_tier_features.sql) — that
-- bridge is confirmed dead in production (see src/lib/signal-accuracy.ts's comment: zero
-- writes ever, because nothing outside its own dead route called it). This repo's own
-- history shows generic cross-feature bridge tables silently rot; nighthawk_play_outcomes
-- and spx_play_outcomes are the proven pattern this mirrors instead.
--
-- NOTE: the authoritative copy of this DDL is inlined in src/lib/db.ts runMigrations()
-- (that inline version is what actually runs on ECS cold-start). This file mirrors it for
-- documentation/consistency with 004-007.
CREATE TABLE IF NOT EXISTS helix_signal_outcomes (
  id BIGSERIAL PRIMARY KEY,
  signal_type TEXT NOT NULL CHECK (signal_type IN ('velocity_spike', 'split_flow')),
  ticker TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  fired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  direction TEXT,
  context JSONB,
  price_at_fire NUMERIC,
  price_5m NUMERIC,
  price_15m NUMERIC,
  price_1h NUMERIC,
  outcome TEXT NOT NULL DEFAULT 'pending' CHECK (outcome IN ('pending', 'continued', 'reversed', 'flat')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (signal_type, ticker, window_start)
);
CREATE INDEX IF NOT EXISTS idx_helix_signal_outcomes_pending
  ON helix_signal_outcomes(fired_at) WHERE outcome = 'pending';
CREATE INDEX IF NOT EXISTS idx_helix_signal_outcomes_ticker
  ON helix_signal_outcomes(ticker, fired_at DESC);
