-- Doc mirror of the migration inlined in src/lib/db.ts runMigrations() — that
-- copy is authoritative and auto-runs on cold start; this file is a readable
-- record, not itself executed.

CREATE TABLE IF NOT EXISTS email_events (
  id BIGSERIAL PRIMARY KEY,
  resend_email_id TEXT,
  event_type TEXT NOT NULL,
  recipient TEXT,
  subject TEXT,
  template_tag TEXT,
  occurred_at TIMESTAMPTZ NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_events_resend_id ON email_events(resend_email_id);
CREATE INDEX IF NOT EXISTS idx_email_events_type_time ON email_events(event_type, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_events_recipient ON email_events(LOWER(recipient));
CREATE INDEX IF NOT EXISTS idx_email_events_template_tag ON email_events(template_tag, occurred_at DESC);
