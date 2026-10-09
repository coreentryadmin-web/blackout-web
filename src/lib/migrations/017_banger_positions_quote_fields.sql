-- Carry the live option quote (bid/ask/OI/greeks) onto banger_positions (2026-10-09).
--
-- NOTE: the authoritative copy of this DDL is inlined in src/lib/db.ts runMigrations() (that inline
-- version is what actually runs on ECS cold-start). This file mirrors it for documentation/consistency
-- with 004-015 (016 was a one-off data correction, not a schema change — see its own header).
--
-- WHY THIS EXISTS (Ask Largo standing mandate, 2026-10-09 — the same SEV-2 shape FINDINGS 2026-08-06
-- already fixed on the swing_positions/native path, never ported to Engine B):
-- `horizonPlayFromBangerPosition` (src/lib/swing/banger-lane-merge.ts) has always hardcoded
-- bid/ask/openInterest/delta/gamma/theta/vega/iv to null/0 on every committed BANGER-origin
-- contract — not because the data is unavailable, but because banger_positions never had a column
-- to hold it. The data is not even an extra fetch: banger-live-sync's cron already calls
-- fetchOptionsUnifiedSnapshot every tick and already has the full snapshot in scope the moment it
-- builds a banger_quote_tick_log row (quote-tick-log.ts) from that same `snap` — captured for a
-- historical research log, then discarded for the live position row.
--
-- Since Engine B banger positions are the large majority of the committed Swing book (live snapshot
-- checked 2026-10-09: ~91 of ~92 committed SWING rows are BANGER-origin, 0 native), this is not a
-- one-ticker gap — it is the default member/Ask Largo experience on the Swing desk's Position panel.
--
-- Purely additive carriage, same discipline as last_mark_at/trough_premium (migrations above) and
-- the native swing `quote` field (live-plays.ts/manage-sync.ts): never read by the scale-out
-- DECISION path (deriveScaleOutAction still reads only `mark`), evidence/display only. Rows written
-- before this migration keep every new column NULL — the same honest-absence behavior the play-brief
-- already handles everywhere else (never fabricated).
ALTER TABLE banger_positions ADD COLUMN IF NOT EXISTS bid NUMERIC;
ALTER TABLE banger_positions ADD COLUMN IF NOT EXISTS ask NUMERIC;
ALTER TABLE banger_positions ADD COLUMN IF NOT EXISTS open_interest NUMERIC;
ALTER TABLE banger_positions ADD COLUMN IF NOT EXISTS quote_delta NUMERIC;
ALTER TABLE banger_positions ADD COLUMN IF NOT EXISTS quote_gamma NUMERIC;
ALTER TABLE banger_positions ADD COLUMN IF NOT EXISTS quote_theta NUMERIC;
ALTER TABLE banger_positions ADD COLUMN IF NOT EXISTS quote_vega NUMERIC;
ALTER TABLE banger_positions ADD COLUMN IF NOT EXISTS quote_iv NUMERIC;
