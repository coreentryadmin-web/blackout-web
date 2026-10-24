-- ONE-OFF DATA CORRECTION (not schema) — banger_positions id=1510 (CRI, O:CRI261016C00035000).
-- Applied via POST /api/admin/run-migration {"filename": "016_cri_banger_peak_correction.sql"}
-- (per that route's own doc comment: "Applies a named SQL migration file... out-of-band SQL
-- files... without restarting the app or touching runMigrations() in db.ts" — this is exactly
-- that use case, not a schema change, so it is deliberately NOT mirrored into db.ts runMigrations()
-- the way 004-015 are).
--
-- WHY THIS EXISTS (standing Ask Largo deep-dive, 2026-10-08, same session as #5697):
-- #5697 (this morning, 06:58 PT) fixed reliableMarkFromQuote's thin-one-lot-ask guard so a bid=0/
-- ask=5.60(size=1) quote is no longer read as a reliable $2.80 mark for this contract. But
-- peak_premium is a one-way GREATEST() ratchet (updateBangerLiveState, positions-db.ts) with NO
-- correction path in the code — the already-corrupted 2.80 survived that fix untouched. On the
-- VERY NEXT live-sync tick after an honest mark (0.55, matching entry) came back in, the stale
-- peak drove deriveScaleOutAction's retrace-from-peak check to read 0.55/2.80=19.6% (well under
-- SCALE_OUT_RULES.trail_from_peak=50%) and fire EXIT_RUNNER — closing the position
-- (closed_at=2026-10-08T14:20:47Z) with a FABRICATED realized_pnl_pct=50 / realized_pnl_usd=27.5
-- that never happened economically, and firing a real Discord trade-alert off it (live-sync.ts's
-- unconditional notifyBangerFromScaleOutAction on every status transition, fire-and-forget).
--
-- EVIDENCE (GET /api/admin/banger/quote-tick-export?occ=O:CRI261016C00035000, every tick this
-- contract has ever logged, 2026-10-06 commit through today): every REAL reliable_mark in this
-- contract's whole life ranged 0.23-0.55 — it NEVER reached SCALE_OUT_RULES.scale_at_mult*entry
-- (0.55*2.0=1.10, the TAKE_PARTIAL trigger) and never fell to hard_stop_mult*entry (0.55*0.4=0.22,
-- the STOP_OUT trigger — the real low was 0.23, one cent above it). Absent the single fabricated
-- 2026-10-08 13:30-14:15 UTC tick, this position would still be genuinely OPEN today, never
-- scaled, with peak_premium=entry_premium=0.55 (this contract never traded above its own entry
-- price in its real life) and trough_premium=0.225 (already correct in the DB — the bug only ever
-- ratcheted the GREATEST/peak side, never the LEAST/trough side).
--
-- CORRECTION: reopen the position to its true, honest state — undo the fabricated TAKE_PARTIAL
-- (scaled_already) and EXIT_RUNNER (status/closed_at/realized_*) transitions, reset peak_premium
-- to the real historical max, and let the (now #5697-fixed) banger-live-sync cron resume managing
-- it normally from here (next real tick: entry=0.55, peak=0.55, mark≈0.55 → HOLD, same as any
-- other flat position — no special-casing needed going forward).
--
-- SAFETY: guarded on the EXACT corrupted values (id, ticker, contract_occ, peak_premium=2.8,
-- status='CLOSED_RUNNER', scale_out_action='EXIT_RUNNER') — a no-op if already applied, if the
-- row doesn't exist, or if production state has since diverged from what was captured live. See
-- the sibling 016_cri_banger_peak_correction.test.ts for an executable check that this WHERE
-- clause can only ever match this one row.
UPDATE banger_positions
SET
  status = 'OPEN',
  peak_premium = 0.55,
  scaled_already = FALSE,
  scale_out_action = NULL,
  scale_out_reason = NULL,
  partial_realized_premium = NULL,
  realized_pnl_pct = NULL,
  realized_pnl_usd = NULL,
  closed_at = NULL,
  updated_at = NOW()
WHERE id = 1510
  AND ticker = 'CRI'
  AND contract_occ = 'O:CRI261016C00035000'
  AND peak_premium = 2.8
  AND status = 'CLOSED_RUNNER'
  AND scale_out_action = 'EXIT_RUNNER';
