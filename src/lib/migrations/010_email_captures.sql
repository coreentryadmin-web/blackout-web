-- Exit-intent email capture (2026-08-07) — see docs/marketing/SEO-GROWTH.md finding #7.
--
-- One row per email (case-insensitive unique index) — a repeat capture from the same
-- visitor across sessions is a no-op on the DB write, though the API route still sends
-- the lead-magnet email again on every submission (harmless for a static one-off email).
--
-- NOTE: the authoritative copy of this DDL is inlined in src/lib/db.ts runMigrations()
-- (that inline version is what actually runs on ECS cold-start). This file mirrors it
-- for documentation/consistency with 004-009.
CREATE TABLE IF NOT EXISTS email_captures (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL,
  source_path TEXT,
  utm_source TEXT,
  utm_campaign TEXT,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  lead_magnet_sent_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_email_captures_email ON email_captures(LOWER(email));
CREATE INDEX IF NOT EXISTS idx_email_captures_captured_at ON email_captures(captured_at DESC);
