> **kind:** FINDING

## Swing/banger live-marks lane never got #4790's zombie-OCC guard — 14 rows still mark:null in production (correction/follow-up to finding #103 / PR #4790) — FIXED

**Status:** FIXED

### Symptom
A cycle agent reported `GET /api/market/zerodte/marks` (and `npm run healthcheck:0dte` Stage D)
still RED after #4790 (merged 2026-09-11 06:59 PT) — ~14 rows with `status:"TRIM"`/`"OPEN"`,
`mark:null`, `source:"none"`, `stale:true`, tracking OCCs that expired 2026-08-21..09-04.

### Independently re-confirmed live (this session, 2026-09-11 ~19:43 UTC)
1. Confirmed #4790's commit (`8fb83d8b6`) is an ancestor of a production `ecr-push-production.yml`
   run (`ac91e5ee`, completed `success` 2026-09-11T17:22:59Z) — the fix WAS deployed well before
   this check, ruling out "not yet shipped."
2. Fetched `GET /api/market/zerodte/marks` live (temp Clerk premium session) and found the exact
   same class of defect, same live tickers the cycle agent reported: OKTA, BLSH, ASST, MSTX, ETH,
   GBTC, ETHU, BITX, FBTC, BITO, ETHA, CRM, MSTR, IBIT, CRCG — all `status:"TRIM"`, `mark:null`,
   `source:"none"`, `stale:true`, OCC expiries 2026-08-21..09-04 (weeks in the past).

### Root cause
`toActivePlay()` in `src/lib/zerodte/live-marks.ts` (the function #4790 fixed) is the ZERODTE
LEDGER row→play converter. It is called from `getActivePlays()`/`boundActivePlays()` for
`zerodte_setup_log` rows only.

`src/lib/zerodte/live-marks.ts`'s `getZeroDteLiveMarksFrame()`/`runZeroDteMarkTick()` merge THOSE
rows with a **second, entirely separate** source: `fetchActiveSwingPlaysForMarks()` in
`src/lib/swing/live-marks-active.ts`, which reads OPEN `swing_positions` and (if enabled)
`banger_positions` rows and converts them to the same `ActiveZeroDtePlay` shape via its OWN
row-builders — `swingRowToActivePlay()` / `bangerRowToActivePlay()`. **These builders never called
`toActivePlay()` and had no expiry check of their own at all** — only a status allow-list
(`LIVE_SWING = {OPEN,HOLD,TRIM}` / `LIVE_BANGER = {OPEN,PARTIAL}`). So a swing/banger position whose
option contract had already expired but was never flagged CLOSED sat in the live-marks lane forever,
polling a dead OCC every ~1s tick with `mark:null`, exactly the "zombie row" #4790 fixed — just on a
lane #4790 never reached.

The 14 live tickers confirm this precisely: several (ETH, GBTC, ETHU, BITX, FBTC, BITO, ETHA, IBIT,
MSTR, CRCG) are crypto/leveraged-crypto proxy tickers characteristic of Swing's watchlist, not
same-day 0DTE names — i.e. genuinely a different table (`swing_positions`/`banger_positions`), not
the same `zerodte_setup_log` row from finding #103 recurring.

### Why the SAME guard shape (`occExpiry != session_date`) does not transfer directly
0DTE's `session_date` IS the contract's own (same-day) expiry by construction, so #4790's guard
(`occExpiry !== r.session_date`) is correct there. Swing/banger positions are NOT same-day —
`row.session_date` is the position's ENTRY/tracked date, legitimately weeks before a real, still-
live multi-week contract's expiry. Applying #4790's literal check here would have EXCLUDED every
healthy open swing position, not just zombies. The only invariant that holds for a still-trackable
swing/banger row is "the contract has not yet expired as of TODAY" — so the fix compares the OCC's
own embedded expiry against `todayEt()`, not against the row's tracked date.

### Fix
- Exported `occExpiryYmd()` from `src/lib/zerodte/live-marks.ts` (previously private/local; #4790's
  own comment said "kept local", corrected here since a second call site now needs the identical
  parse and must not re-derive it a different way).
- Added `occAlreadyExpired(occ, today)` in `src/lib/swing/live-marks-active.ts` and call it from both
  `swingRowToActivePlay()` and `bangerRowToActivePlay()`, threading `todayEt()` through from
  `fetchActiveSwingPlaysForMarks()`.
- Exported `swingRowToActivePlay`/`bangerRowToActivePlay` for direct unit testing.

### Evidence
RED (5/7 fail — `swingRowToActivePlay`/`bangerRowToActivePlay` not exported/no guard) with the fix
`git stash`ed and only the new tests present; GREEN (7/7) with the fix restored. New tests cover:
expired-OCC exclusion (both swing and banger), a healthy multi-week-out position still tracked, and
a same-day-expiry edge case (expires TODAY → still tracked, not yet past its own day).
Full `src/lib/swing/*.test.ts` + `src/lib/zerodte/*.test.ts` + `npx tsc --noEmit`: see PR CI.

### Blast radius
Both `swingRowToActivePlay` (Swing Command open positions) and `bangerRowToActivePlay` (Banger
ledger, gated on `isBangerEngineEnabled()`) shared the identical gap — both fixed in one PR since
they're the same root cause at the same two call sites in one file.

### What a DB-level investigation would still need to confirm (not fixable from this sandbox)
This fix stops a zombie row from being TRACKED/POLLED forever — it does not explain why the
upstream close/expiry-sweep never flipped these swing/banger rows to CLOSED in the first place (the
same open question #4790 left for the 0DTE side). Raw Postgres is blocked in this sandbox (per
CLAUDE.md); confirming the upstream miss needs either an ECS exec session or a debug endpoint to
inspect `swing_positions`/`banger_positions` rows directly (their `status`, `closed_at`, and any
end-of-day/expiry-sweep cron's own run history for these specific commit_keys).
