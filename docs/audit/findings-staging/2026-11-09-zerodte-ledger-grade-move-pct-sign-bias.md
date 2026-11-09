# 0DTE honesty-ledger computeLedgerGrade had the same sign-bias rounding tie

> **kind:** `FINDING`

## Status

FIXED

## Root cause

`src/lib/zerodte/board.ts`'s `computeLedgerGrade` — the whole-market scanner's underlying-move
honesty ledger, whose own header comment says "the honesty of the ledger depends on it" — rounded
the signed move with:

```ts
const move_pct = Math.round(signed * 100) / 100;
```

`Math.round()` on a signed value ties toward `+Infinity` (`Math.round(-312.5) === -312` but
`Math.round(312.5) === 313`), so a LONG setup and a SHORT setup graded off the **identical**
underlying move at an exact rounding-tie boundary get different magnitudes for `move_pct`, even
though `signed` is already direction-adjusted specifically so the two should be mirror images.

This is the same bug class already fixed at `fmt-money.ts`'s `fmtPct`, `round-floats.ts`,
`gamma-desk.ts`'s `topGexWalls`, `spx-desk-merge.ts`'s `recalcGexWallDistances`,
`debrief.ts`'s `round2`, and `trade-excursion-graphic.ts`'s `formatExcursionPct` — an
independent, un-migrated instance none of those earlier fixes reached, found by a direct
repo-wide grep for the bare `Math.round(\w+ * 100) / 100` shape rather than by following a live
call site outward from an already-known defect.

`move_pct` is persisted via the real (sole) caller, `scanZeroDteBoard` in `scan.ts:2616`, into
`zerodte_setup_log` through `gradeZeroDteSetupRow` — a durable row in the whole-market scanner's
own hit-rate ledger, not a display-only value. `direction_hit` (the true/false/null hit-rate
verdict) is unaffected by this bug — it is derived from `move_pct`'s **sign**, which the fix does
not change — but any aggregate built from `move_pct`'s **magnitude** (average winning/losing move
size, per-setup move distributions) inherited a small, systematic downward bias on the negative
side.

## Evidence (RED → GREEN)

`$160 → $165` is a floating-point-exact 3.125% move (`5/160 = 0.03125` is exact in binary), so it
reproduces the tie with no floating-point noise:

```
computeLedgerGrade("long",  160, 165) -> move_pct: 3.13   (pre-fix: same, unaffected)
computeLedgerGrade("short", 160, 165) -> move_pct: -3.12  (pre-fix, WRONG — should be -3.13)
```

New test `"ledger grade: mirror-image long/short setups at a rounding-tie boundary grade the same
magnitude"` added to `src/lib/zerodte/board.test.ts`. Confirmed RED pre-fix (`git stash` of just
`board.ts`): `short.move_pct` was `-3.12`, failing the assertion against `-3.13`. Confirmed GREEN
post-fix: `board.test.ts` 150/150 pass (1 new + every pre-existing test, including the three
existing `computeLedgerGrade` tests covering the flat-close and rounding-band-breakeven cases).
`npx tsc --noEmit` clean.

Also ran the sibling `scan.test.ts` (the real caller) for regression: 44/46 pass; the 2 failures
(`G-11 batch earnings` and `healthy halt feed` tests) are pre-existing and unrelated — confirmed
identical on unmodified `main` via `git stash`, nothing to do with `computeLedgerGrade` or
`move_pct`.

## Blast radius

`computeLedgerGrade` has exactly one real call site (`scan.ts:2616`); its only other references
are in its own test file and two comments in `src/lib/bie/alert-outcome-sync.ts` / `src/lib/db.ts`
documenting the existing ungradeable-row behavior (untouched by this fix). No duplicate
implementation found elsewhere via grep.

## Fix rationale

Same fix as every prior sibling: round the magnitude, then reapply sign
(`Math.sign(signed) * (Math.round(Math.abs(signed) * 100) / 100)`). Verified this does not
change any existing test's expectation — the one existing tie-boundary test
(`justOutsideBand`, `signed` exactly `+0.005`) already rounds the same way under both the old and
new code, since the old bug only misbehaves on *negative* ties. `direction_hit`'s logic
(`move_pct > 0 ? true : move_pct < 0 ? false : null`) is untouched; it already read off the
rounded value, not the raw one (fixed separately in PR #7086).
