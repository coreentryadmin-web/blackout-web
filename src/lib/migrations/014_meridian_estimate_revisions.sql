-- Doc mirror of the migration inlined in src/lib/db.ts runMigrations() — that
-- copy is authoritative and auto-runs on cold start; this file is a readable
-- record, not itself executed.
--
-- ONE ROW PER detected estimate revision, kept (not overwritten). `diffEstimateRevisionTimeline`
-- (Redis snapshot diff, meridian-benzinga-analytics.ts) only emits a revision in the single
-- ~20-min cached build that happens to run while the delta is fresh — the act of diffing also
-- advances the Redis snapshot, so the next build compares equal and stays silent forever after.
-- A member who loads the page outside that one build's window sees an empty "timeline" despite
-- real revisions having happened (measured 2026-08-18: 4 entries at 14:52 UTC, 0 at 14:57 UTC —
-- see FINDINGS.md "Estimate-revision timeline is momentary, not cumulative"). This table makes
-- each emitted entry durable so it can be read back on any later build within the lookback
-- window, not just the one that detected it. UNIQUE on the same fields that define the entry so
-- a second build that races the diff (or re-observes the same Benzinga row before the Redis
-- snapshot has propagated) writes the identical row harmlessly.

CREATE TABLE IF NOT EXISTS meridian_estimate_revisions (
  id BIGSERIAL PRIMARY KEY,
  ticker TEXT NOT NULL,
  event_date DATE NOT NULL,
  change_kind TEXT NOT NULL,
  revised_at TIMESTAMPTZ NOT NULL,
  company_name TEXT,
  eps_delta NUMERIC,
  revenue_delta_pct NUMERIC,
  estimated_eps NUMERIC,
  estimated_revenue NUMERIC,
  headline TEXT NOT NULL,
  inserted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (ticker, event_date, change_kind, revised_at)
);

CREATE INDEX IF NOT EXISTS idx_meridian_est_revisions_recent
  ON meridian_estimate_revisions(revised_at DESC);
