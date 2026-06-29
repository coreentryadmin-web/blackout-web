-- Drop scaffold tables confirmed to have zero INSERT code references in src/ and zero rows in prod.
-- These were from an earlier SPX engine design that was never wired to writers.
--
-- NOTE: spx_signal_log is LIVE — written by maybeLogSpxPlay() on BUY/SELL/TRIM and read by
-- admin rollups + /api/market/spx/signals. Do NOT drop it here.

DROP TABLE IF EXISTS spx_pulse_snapshots;
DROP TABLE IF EXISTS spx_watch_setups;
