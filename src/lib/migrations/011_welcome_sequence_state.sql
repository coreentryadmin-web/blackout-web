-- 5-email member welcome drip (2026-08-07) — see docs/marketing/SEO-GROWTH.md,
-- Content & Copy section ("5-email welcome sequence").
--
-- One row per Clerk user (unique on user_id). steps_sent tracks progress (0-5);
-- next_send_at is the next due timestamp, NULL once completed_at is set. The cron
-- (src/app/api/cron/welcome-sequence/route.ts) queries the partial index below for
-- rows past due, sends the next step, and advances both fields — or, on the final
-- step, sets completed_at and leaves next_send_at NULL so the row drops out of the
-- index entirely rather than being re-scanned forever.
--
-- NOTE: the authoritative copy of this DDL is inlined in src/lib/db.ts runMigrations()
-- (that inline version is what actually runs on ECS cold-start). This file mirrors it
-- for documentation/consistency with 004-010.
CREATE TABLE IF NOT EXISTS welcome_sequence_state (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  email TEXT NOT NULL,
  first_name TEXT,
  steps_sent INT NOT NULL DEFAULT 0,
  next_send_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_welcome_sequence_user ON welcome_sequence_state(user_id);
CREATE INDEX IF NOT EXISTS idx_welcome_sequence_due
  ON welcome_sequence_state(next_send_at)
  WHERE completed_at IS NULL;
