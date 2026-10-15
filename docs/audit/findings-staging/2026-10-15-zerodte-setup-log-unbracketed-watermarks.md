## zerodte_setup_log peak_premium/trough_premium could land outside [entry_premium, ...) — same SEV-2 shape FINDINGS 2026-08-06 already fixed on swing_positions, never ported here — THIRD table found with this bug this session — FIXED

> **kind:** `FINDING`

| **Status** | FIXED |
|---|---|

**Root cause.** `peak_premium`/`trough_premium` are supposed to be running high/low-water marks of
a contract's premium *since entry* — the entry fill itself IS an observed mark of that contract, so
neither watermark should ever land on the wrong side of `entry_premium`. Neither of
`zerodte_setup_log`'s two write paths — the shared single-row `ZERODTE_SETUP_LOG_UPSERT_SQL`
(used by the WS-01 atomic commit path) nor `upsertZeroDteSetupLog`'s batched multi-row INSERT (the
2026-08-01 perf-audit path) — ever included `peak_premium`/`trough_premium` in their column lists,
so both columns were left `NULL` at commit. `updateZeroDteLiveState`'s ratchet then seeds them from
the FIRST OBSERVED MARK instead of entry:

```sql
peak_premium = CASE WHEN status = 'CLOSED' THEN peak_premium
  WHEN $4 IS NOT NULL THEN GREATEST(COALESCE(peak_premium, $4), $4) ELSE peak_premium END,
trough_premium = CASE WHEN status = 'CLOSED' THEN trough_premium
  WHEN $4 IS NOT NULL THEN LEAST(COALESCE(trough_premium, $4), $4) ELSE trough_premium END,
```

`COALESCE(peak_premium, $4)` resolves to `$4` (the mark) when `peak_premium` is `NULL`, so
`GREATEST($4, $4) = $4` — whatever the first tick after commit happens to observe, not
`entry_premium`. This is the SAME shape as the `banger_positions` fix shipped earlier this same
session (#6027) and FINDINGS 2026-08-06's original `swing_positions` fix — a **third table** found
carrying the identical, previously-documented bug class.

**Note:** `scan.ts`'s own refresh-cycle code already defends the SERVED value against this
(`latchPremiumBounds(r.peak_premium ?? r.entry_premium, r.trough_premium ?? r.entry_premium, mark)`)
— but that's a **null-only** fallback, not a bracket-enforcing widen: when `peak_premium` is
non-null but numerically below `entry_premium` (exactly the bug's shape), the `??` never triggers
and the understated raw DB value passes straight through to the API response and to
`derivePlayStatus`.

**Evidence.** Live, 2026-10-15 (`GET /api/market/zerodte/board`, 30-row ledger): 3 real violations —
CRWV (trough 1.80 vs entry 1.77), FLEX (peak 2.38 vs entry 2.40), APLD (peak 0.56 vs entry 0.59).
Smaller magnitudes than the `banger_positions` instance (0DTE positions move tick-to-tick within a
session rather than across an overnight/weekend gap), but the same arithmetically-impossible shape.

Git-stash RED→GREEN on the three new regression tests (`src/lib/db.test.ts`): stashing just
`src/lib/db.ts` (not the test file) and re-running `npx tsx --experimental-test-module-mocks --test
src/lib/db.test.ts` reproduces `38 pass / 3 fail`; popping the stash restores `41 pass / 0 fail`.

**Behavioral impact.** Same analysis as the `banger_positions` companion fix: `derivePlayStatus`'s
exit-decision logic reads peak/trough through `latchPremiumBounds`'s widening, which widens further
using the CURRENT mark but never retroactively corrects a stale DB seed below entry when no fresher
mark has arrived — so a position whose true peak (== entry, if it never traded above entry) is
understated in the stored column can, in principle, compute a slightly-too-easy-to-clear trailing/
ratchet floor. Given the magnitudes here (1-3 cents on $0.56-$2.40 contracts), this is unlikely to
have flipped any live 0DTE decision to date, but the data-layer fix removes the latent risk going
forward regardless of magnitude.

**Blast radius.** `updateZeroDteLiveState`'s per-tick ratchet and `derivePlayStatus`/
`latchPremiumBounds` were deliberately left untouched — mirrors exactly how the `banger_positions`
and original `swing_positions` fixes were scoped (repair the upstream seed + backfill, not the
downstream consumer, which already has its own null-fallback and is out of scope for this pass).

**Fix rationale.** Mirrors the `banger_positions` fix exactly:
- Both `zerodte_setup_log` write paths (`ZERODTE_SETUP_LOG_UPSERT_SQL` and `upsertZeroDteSetupLog`'s
  batched INSERT) now seed `peak_premium`/`trough_premium` from `entry_premium` (`$13`/`${b+13}`,
  reused — no new parameter) directly in their VALUES lists. Neither column is added to either
  path's `ON CONFLICT DO UPDATE SET` clause, so a re-running scan never rewinds an already-ratcheted
  extreme (verified by a dedicated test).
- A new idempotent, boot-time backfill UPDATE in `ensureSchema` (`db.ts`) repairs every row written
  before this fix, widening only (GREATEST/LEAST), guarded to a no-op once converged — byte-for-byte
  the same shape as the existing `swing_positions`/`banger_positions` backfills in the same function.
- A row with no `entry_premium` (an iron condor's credit structure carries no single entry
  premium — see `scan.ts`'s own comment on this population) is left alone by both the seed and the
  backfill, same honest-absence behavior as before.

**Evidence of no regression.** `npx tsc --noEmit`: clean. Targeted suite (`db.test.ts`): `41 pass /
0 fail`. Full `npm test` (Node 20, `scripts/run-tests.mjs`): see companion run-log entry for the
exact count.
