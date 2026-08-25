# 2026-08-25 — Night Hawk 0DTE recall/quality: unified G-3 floor — FIXED

> **kind:** FINDING

## Symptom (live RTH 2026-08-25 ~10:19 ET)

- Board: 24 setups, 6 ledger rows, 5 OPEN — **all BREAKOUT-only**, no FLOW commits.
- Admin funnel: 34 detected tickers, **90 score_floor blocks**, 6 commits; top gates score_floor (90), opening_window (66), min_aggr_share (27), min_gross (26).
- OPEN commits included death-band scores: MSTR 54, LUNR 53, ASST 59 (BREAKOUT floor was **50**).
- Strong setups blocked elsewhere: QQQ 69 FLOW blocked by confluence_floor (early window needs 2); PURR 81+ blocked by cortex_veto:gex-walls.

## Root cause

WS-20 lowered `ZERODTE_SCORE_FLOOR_BREAKOUT` / `PIN` to **50** so multiplicative BREAKOUT/PIN scores could commit. Engine calibration (F-2) shows the **55–64 band ran 18.8% WR / −24.5% avg** — the 50 floor re-opened that bucket for BREAKOUT-only rails while score_floor still blocked 90 candidates above 50.

## Fix

1. Restore BREAKOUT/PIN G-3 default floor to **65** (env overrides unchanged).
2. Bump `BREAKOUT_SCORE_BASE` 15→20 so genuine 7%+ strong-close continuations clear 65 without lowering the bar.
3. Align `tiers.ts` `scoreFloorForOrigin` with `gates.ts` (FLOW present → strict 65).

| **Status** | FIXED in `fix/nighthawk-0dte-recall-quality-3d11` |
