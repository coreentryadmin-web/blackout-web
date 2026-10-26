## Ask Largo / Night Hawk Swings: `GET /api/market/swing/record`'s embedded `grade.entry_premium`/`grade.exit_mark` were 2dp-flattened at the API boundary, so recomputing `grade.realized_pnl_pct` from the two DISPLAYED premiums no longer reproduced the DISPLAYED percentage sitting next to them

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | FIXED (PR #TBD) |
| **Found by** | Live-production audit agent, Ask Largo × Night Hawk Swings standing ownership mandate, 2026-10-26 |
| **Scope** | `src/app/api/market/swing/record/route.ts` (the `roundFloats()` call) |

### Root cause

`records[].legs[].grade` is the frozen multi-truth grade a roll-chain leg was closed with —
`roll-plan.ts`'s `gradeParentFromMark` writes `grade_json.entry_premium`, `grade_json.exit_mark`,
and `grade_json.realized_pnl_pct` all from the SAME unrounded raw `entry`/`mark` values
(`realized = ((mark - entry) / entry) * 100`), full precision, no rounding at write time.
`record.ts`'s `buildSwingRecord` passes this object through **untouched** (`grade: r.grade_json`,
per the field's own doc comment) — it deliberately rounds the chain's OWN `realizedPnlPct` field
(line ~137, `round2`) for composite-math self-consistency, but never touches the nested
`grade_json` blob at all.

The route's only rounding pass is the generic `roundFloats(responseObj)` call at the HTTP
boundary — called with no second (`dp`) or third (`keyDp`) argument, so every fractional number in
the whole payload, including `grade.entry_premium`/`grade.exit_mark`, was independently flattened
to the 2dp default. The sibling `/api/market/nighthawk/horizons` route already hit and fixed this
exact class of bug for its own premium fields (`entryPremium`/`peakPremium`/`troughPremium`/
`mid`/greeks), adding a `keyDp` override specifically because "the plain 2dp default destroys
precision for sub-$1 contracts" — but the override was never carried over to `/record`, and
`/record`'s `grade` sub-object uses different (snake_case) key names than `/horizons` ever used, so
even a naive copy of that route's override map would have missed it.

For a sub-$1-premium leg, rounding `entry_premium` and `exit_mark` independently to 2dp loses just
enough precision that recomputing `(exit_mark - entry_premium) / entry_premium * 100` from the two
DISPLAYED numbers no longer reproduces the DISPLAYED `realized_pnl_pct` sitting right next to them
in the same `grade` object — a self-contradictory payload for any consumer (future Largo tool, dev,
or member) reading the grade sub-object directly. `horizon-outcomes.ts` (the cross-lane Largo
grading reader) reads `realized_pnl_pct` directly rather than this `grade` sub-object, so Largo's
headline win/loss narration was never corrupted by this — this is specifically the disclosed
"basis" evidence failing to reproduce the disclosed result, a precision violation under the Largo
product contract's "precision" point.

### Evidence

Live `GET /api/market/swing/record?days=90` (2026-10-26T12:18Z): `rootPositionId` 29 (EWZ),
`legs[0].grade = {entry_premium:0.58, exit_mark:3.13, realized_pnl_pct:438.79}`. Recomputing
`(3.13-0.58)/0.58*100 = 439.66%`, a 0.87-percentage-point gap from the displayed 438.79%. The audit
agent scanned all 65 graded legs carrying a `grade` blob: 24/65 showed a recompute gap > 0.05pp (top
5: EWZ 0.865pp, KRE 0.337pp, FHN 0.329pp, RKLB 0.291pp, NN 0.260pp), concentrated in — but not
exclusive to — sub-$1-premium legs.

Reproduced locally with a regression test
(`src/app/api/market/swing/record/route.test.ts`): a fixture leg with `entry_premium:0.581`,
`exit_mark:3.13`, and `realized_pnl_pct` computed from those same raw unrounded values (~438.7263%)
reproduced a served `grade.entry_premium:0.58` whose recompute (`439.6552%`) missed the served
`grade.realized_pnl_pct:438.73` by 0.925pp — confirmed RED via `git stash` (route.ts fix stashed,
test kept in place) before applying the fix, then GREEN after.

### Fix

Added a `keyDp` override to the route's `roundFloats()` call:
`{ entry_premium: 4, exit_mark: 4, entryPremium: 4, peakPremium: 4, troughPremium: 4 }` — mirroring
the horizons route's existing fix for the identical class of bug. `entry_premium`/`exit_mark`
(snake_case) are the embedded `grade_json`'s own keys and are the ones that actually needed the
override; `entryPremium`/`peakPremium`/`troughPremium` (camelCase, `closedDeck`'s fields) are
included for parity with the horizons route and because `roundFloats`'s `keyDp` matches on object
key name regardless of where in the tree it sits — those three are already `round2()`'d at the
source in `closed-plays.ts` (per its own 2026-10-21 fix comment), so the override is a no-op there,
included only so one shared list covers both the `grade` sub-object and `closedDeck` regardless of
casing, same as the fix hint's own rationale.

Deliberately left unchanged: `realized_pnl_pct` itself stays at the 2dp default — once
`entry_premium`/`exit_mark` carry 4dp of precision, recomputing from the two displayed numbers
lands within ~0.004pp of the already-2dp-rounded displayed percentage (far under any meaningful
threshold), so no override was needed there. The chain's own top-level `legs[].realizedPnlPct`
field (camelCase, already `round2()`'d in `record.ts` for composite-math self-consistency) is
unaffected by this change — the bug was entirely in the untouched `grade_json` passthrough.

### Regression test

`src/app/api/market/swing/record/route.test.ts`: *"a sub-$1-premium leg's served
grade.entry_premium/exit_mark reproduce its own grade.realized_pnl_pct (2026-10-26, Ask Largo
standing mandate)"* — fixture leg with `entry_premium:0.581`/`exit_mark:3.13` (raw, matching the
live EWZ repro's magnitude), asserts the served `grade.entry_premium`/`grade.exit_mark` recompute to
within 0.05pp of the served `grade.realized_pnl_pct`.

### Verification

- `npx tsx --experimental-test-module-mocks --test src/app/api/market/swing/record/route.test.ts` —
  RED pre-fix (3 pass / 1 fail, `git stash` of `route.ts` with the test kept in place, gap measured
  0.925pp), GREEN post-fix (4 pass / 0 fail).
- Full suite (`npm test`, Node 20) — pass, 0 fail.
- `npx tsc --noEmit` (Node 20) — clean, exit 0.
