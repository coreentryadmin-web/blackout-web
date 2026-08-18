-- Doc mirror of the migration inlined in src/lib/db.ts runMigrations() — that
-- copy is authoritative and auto-runs on cold start; this file is a readable
-- record, not itself executed.
--
-- ONE ROW PER (ticker, event, calendar day), last write wins. The Meridian warm path runs every
-- few minutes; an unkeyed insert would produce hundreds of near-identical rows per name per day
-- and a "drift" that mostly measured scan jitter. The day key collapses that to one real
-- observation, and makes a missed run harmless — the next pass overwrites the same slot rather
-- than leaving a hole in the series.

CREATE TABLE IF NOT EXISTS meridian_report_snapshots (
  id BIGSERIAL PRIMARY KEY,
  ticker TEXT NOT NULL,
  event_date DATE NOT NULL,
  snapshot_day DATE NOT NULL,
  score NUMERIC,
  verdict TEXT,
  confidence TEXT,
  pillars JSONB,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (ticker, event_date, snapshot_day)
);

CREATE INDEX IF NOT EXISTS idx_meridian_snap_lookup
  ON meridian_report_snapshots(ticker, event_date, snapshot_day DESC);
