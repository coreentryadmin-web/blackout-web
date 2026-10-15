## banger_positions peak_premium/trough_premium can land outside [entry_premium, ...) at commit — arithmetically impossible watermarks, same shape FINDINGS 2026-08-06 already fixed on swing_positions, never ported here — FIXED

> **kind:** `FINDING`

| **Status** | FIXED |
|---|---|

**Root cause.** `peak_premium`/`trough_premium` are supposed to be running high/low-water marks of
a contract's premium *since entry* — the entry fill itself IS an observed mark of that contract, so
neither watermark should ever be able to land on the wrong side of `entry_premium`. `insertBangerPosition`
(`src/lib/banger/positions-db.ts`) left both columns `NULL` at commit, and `updateBangerLiveState`'s
ratchet seeded them from the FIRST OBSERVED MARK instead of entry:

```sql
peak_premium = CASE WHEN $3 IS NOT NULL THEN GREATEST(COALESCE(peak_premium, $3), $3) ELSE peak_premium END,
trough_premium = CASE WHEN $3 IS NOT NULL THEN LEAST(COALESCE(trough_premium, $3), $3) ELSE trough_premium END,
```

`COALESCE(peak_premium, $3)` resolves to `$3` (the mark) when `peak_premium` is `NULL`, so
`GREATEST($3, $3) = $3` — whatever the FIRST tick after commit happens to observe, not
`entry_premium`. A contract that gapped against its new position before the first live-sync tick
ever sampled it therefore seeds `peak_premium` **below** its own entry (or `trough_premium`
**above** it) — a state that should be impossible for a watermark that is supposed to bracket the
contract's whole observed life.

This is the **exact same shape** as FINDINGS 2026-08-06 (SEV-2, "unbracketed watermarks"), which
fixed `swing_positions` two ways: `insertSwingPosition` seeds both columns from `entry_premium` at
INSERT (`db.ts`), and a boot-time, idempotent, converge-only backfill UPDATE repairs any row that
still violates the bracket. `banger_positions` — Engine B, folded into the SAME Swing lane board via
`banger-lane-merge.ts` and read by Ask Largo's play-brief — never got either half of that fix,
despite carrying the identical `GREATEST`/`LEAST`-ratchet shape on its own `updateBangerLiveState`.

**Evidence.** Live, 2026-10-15 (`GET /api/market/nighthawk/horizons?view=swings`, SWING lane,
committed rows, 53 total): scanning every row's `(entryPremium, peakPremium, troughPremium, contract.mid)`
tuple found **9 real, currently-live violations** —

- `peakPremium < entryPremium` (7 rows, all BANGER-origin BREAKOUT archetype, committed 2026-10-13
  ~20:15 UTC, right at the prior session's close): SLS (entry 0.60 / peak 0.575), METU (1.87 /
  1.725), SNXX (0.80 / 0.525), MUU (1.36 / 1.15), ALAB (11.35 / 8.75), CBRS (4.20 / 3.40), WDC
  (11.00 / 10.425).
- `troughPremium > entryPremium` (2 rows, same origin/archetype): ORKA (entry 0.85 / trough 1.50),
  SOXS positionId 1771 (entry 1.23 / trough 1.825).

Git-stash RED→GREEN on the two new regression tests (`src/lib/banger/positions-db.test.ts`'s
`insertBangerPosition: SEEDS peak_premium/trough_premium from entry_premium ($11) at commit` and
`src/lib/db.test.ts`'s `ensureSchema: the banger_positions watermark backfill only ever WIDENS the
bracket, and converges to a no-op`): stashing just `src/lib/banger/positions-db.ts` and `src/lib/db.ts`
(not the two test files) and re-running `npx tsx --experimental-test-module-mocks --test
src/lib/banger/positions-db.test.ts src/lib/db.test.ts` reproduces `48 pass / 2 fail` (both new
tests fail — the INSERT never mentions `peak_premium`/`trough_premium` and the backfill UPDATE does
not exist in `ensureSchema`); popping the stash restores `50 pass / 0 fail`.

**Behavioral impact, precisely scoped.** Checked `deriveScaleOutAction`/`computeScaleOutTriggerInfo`
(`src/lib/zerodte/scale-out.ts`, the shared pure state machine both the live banger manager and the
backtest call): pre-scale, `peakPremium` is used ONLY to test whether the contract ever reached
`entry * scale_at_mult` (2x) — an understated peak that is still below `entry * 2.0` (as every
affected row here is) changes nothing about that verdict, since the correctly-bracketed peak
(`entry_premium`) would ALSO be below 2x. Post-scale, the trailing-stop check
(`lastMark <= peakPremium * trail_from_peak`) DOES use the raw value directly — an understated peak
there computes a lower, too-easy-to-clear trailing-stop level, biasing the runner to stay open
*past* where the stated policy says it should exit. None of the 9 affected rows here have scaled yet
(`manageReason` reads "below the 2× partial and above the hard stop" on every one), so TODAY's
member-facing decisions are unaffected by this specific set of violations — the bug is live and
reproducible in the DATA (what Ask Largo's play-brief and the Position card display as "Peak"/
"Trough" is currently wrong on 9 real rows), and would bite the DECISION path the first time any
affected position reaches its 2x partial and then retraces.

**Blast radius.** Both `updateBangerLiveState`'s live ratchet and `deriveScaleOutAction`/
`computeScaleOutTriggerInfo` were deliberately left untouched — this fix repairs the two upstream
seeding points (INSERT + boot backfill), not the downstream consumers, mirroring exactly how
`swing_positions`' own fix was scoped in 2026-08-06 (that fix also left `updateSwingLiveState`'s
per-tick ratchet unbracketed, relying on the same converge-on-boot discipline). No other table or
consumer shares this exact bug shape; `swing_positions` itself was independently checked and is
already covered by its own two existing backfills (2026-08-06 entry-bracket, 2026-09-11 exit-bracket).

**Fix rationale.** Two coordinated, minimal changes mirroring the swing_positions precedent exactly:
- `insertBangerPosition` now seeds `peak_premium`/`trough_premium` from `entry_premium` (`$11`,
  reused — no new parameter) directly in the INSERT's VALUES list. Neither column is added to
  `BANGER_PINNED_COLUMNS`, so a re-running discovery scan hitting the same `commit_key` never
  rewinds an already-ratcheted extreme (verified by a dedicated test) — same discipline
  `db-swing-ledger.test.ts` already asserts for `SWING_POSITION_PINNED_COLUMNS`.
- A new idempotent, boot-time backfill UPDATE in `ensureSchema` (`db.ts`) repairs every row written
  before this fix, widening only (`GREATEST`/`LEAST`), guarded so a fully-converged table matches
  zero rows — safe and cheap to re-run on every boot, byte-for-byte the same shape as the existing
  `swing_positions` backfill a few hundred lines up in the same function.
- Deliberately NOT changed: `updateBangerLiveState`'s per-tick ratchet SQL (keeps bracketing solely
  via INSERT-time seed + boot backfill, exactly mirroring how `swing_positions` handles this same
  bug class) and the scale-out decision functions (out of scope — the data-layer fix is sufficient;
  see "Behavioral impact" above for why no decision-path change was warranted on today's evidence).

**Evidence of no regression.** `npx tsc --noEmit`: clean. Targeted suite (`src/lib/banger/positions-db.test.ts`
`src/lib/db.test.ts`): `50 pass / 0 fail`. Full `npm test` (Node 20, `scripts/run-tests.mjs`): see
companion run-log entry for the exact count.
