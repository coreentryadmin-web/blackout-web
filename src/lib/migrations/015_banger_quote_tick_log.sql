-- Prospective NBBO quote-tick log for Banger (Engine B) live-sync (2026-09-27).
--
-- WHY THIS EXISTS (docs/audit/BANGER-EXIT-QUOTE-TICK-VALIDATION-2026-09-27.md): a real, historical
-- reconstruction attempt at validating an alternative Banger exit rule against Polygon's archived
-- `/v3/quotes` NBBO tape found a demonstrated, structural gap -- Polygon's archived historical quote
-- tape does not always reproduce what its own real-time snapshot service reported at the exact
-- instant `banger-live-sync` actually polled it (AVAV id=39: a real trade printed at exactly
-- production's recorded stop mark while the archived quote tape's own minimum mid, fetched over the
-- position's ENTIRE lifetime, never reached that level). There is no way to retroactively recover the
-- exact bid/ask production's real poll saw -- it was never persisted anywhere.
--
-- This table closes that gap GOING FORWARD: `banger-live-sync`'s cron already fetches a full options
-- unified snapshot (bid/ask/last/resolved mark) for every open position on every tick -- this table
-- persists that SAME data (zero additional Polygon calls), so a future exit-rule validation can replay
-- ANY exit configuration against production's own real, historically-faithful polling tape instead of
-- an archived third-party reconstruction that has been shown to disagree with it.
--
-- PURELY ADDITIVE, NEVER ON THE DECISION PATH: a write here is fire-and-forget (see
-- src/lib/banger/quote-tick-log.ts's own header) -- a failure to log a tick must never affect the real
-- exit-management decision, which reads the live snapshot directly, not this table. No exit logic,
-- gating, or member-facing output depends on this table's contents.
--
-- NOTE: the authoritative copy of this DDL is inlined in src/lib/db.ts runMigrations() (that inline
-- version is what actually runs on ECS cold-start). This file mirrors it for documentation/consistency
-- with 009 and its siblings.
CREATE TABLE IF NOT EXISTS banger_quote_tick_log (
  id BIGSERIAL PRIMARY KEY,
  -- The contract this tick belongs to -- joined against banger_positions.contract_occ by a future
  -- replay, not a foreign key (a tick can arrive after its position row closes; never block on that).
  contract_occ TEXT NOT NULL,
  polled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  bid NUMERIC,
  ask NUMERIC,
  last_trade NUMERIC,
  -- The doc-priority mark BEFORE the backstop-quote divergence guard (mid(bid,ask) ?? last ?? dayClose).
  raw_mark NUMERIC,
  -- The mark AFTER reliableMarkFromSnapshot's guard -- what live-sync.ts actually acts on.
  reliable_mark NUMERIC
);

-- Replay/export scan: every tick for one contract, in order.
CREATE INDEX IF NOT EXISTS idx_banger_quote_tick_log_occ_time
  ON banger_quote_tick_log(contract_occ, polled_at);

-- Retention scan (a cron can prune rows older than N days without touching the occ index above).
CREATE INDEX IF NOT EXISTS idx_banger_quote_tick_log_polled_at ON banger_quote_tick_log(polled_at);
