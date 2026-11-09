# 2026-11-09: Night Hawk Swings `sectorLeadershipFacts.deltaPct` rounded independently of its two displayed operands, disagreeing with the subtraction a member or Largo-tool consumer actually performs

> **kind:** `FINDING`

**Status.** FIXED — this PR.

## Summary

`GET /api/market/nighthawk/horizons?view=swings` serves each SWING play's `sectorLeadershipFacts`
object (`{ benchmarkEtf, benchmarkLabel, kind, nameReturnPct, groupReturnPct, deltaPct }`), sourced
from `industryGroupRsFacts()` (`src/lib/swing/industry-group-rs.ts`), which computes
`deltaPct: nameRet - groupRet` at full floating-point precision with no rounding. The object is
carried unmodified through `swing-ingest.ts` -> `dossier.ts` -> `serving-ingest.ts` ->
`serving-lane.ts` -> `src/features/nighthawk/command-deck/adapters.ts` (plain passthrough at every
hop, confirmed by grep — no rounding/reconcile call touches any of these three keys anywhere in
that chain). The API route then serializes the whole board payload via
`roundFloats(payload, 2, { mid:4, entryPremium:4, peakPremium:4, troughPremium:4, gamma:4, theta:4,
vega:4, iv:4 })` — the `keyDp` override map has no entry for `nameReturnPct`/`groupReturnPct`/
`deltaPct`, so all three independently fall through to the generic 2dp branch. Because each is
rounded from its OWN unrounded value rather than `deltaPct` being derived from the two
already-rounded display values, `deltaPct` frequently does not equal
`round(nameReturnPct,2) - round(groupReturnPct,2)` — the exact rounding-composition bug class this
file's `reconcileStrikeTotal`/`reconcileCellStrikeTotals`/`reconcileTrancheFractions` already have
three dedicated fixes for, just not yet covering this fourth shape.

Found by a monitoring workflow and unanimously confirmed by 3 independent verify passes (0/3
refuted) against a live production payload.

**Explicitly distinct from, and does not touch,** the narrative-text fix that landed earlier the
same day in `#7730` (commit `470d38e01`) — `whyThisSetupSection` in
`src/lib/swing/play-brief-intel.ts` has its own LOCAL rounding of these same two upstream fields,
at 1dp, for the human-readable "Industry read" sentence in the Ask Largo play-brief narrative.
That fix scopes itself entirely to that one text-rendering function and never touches
`round-floats.ts` or any API route. This finding is the raw JSON field served directly by the
horizons route (and read by any direct API/Largo-tool consumer, not just the narrative text) — a
wholly separate, still-broken code path at the time this PR was opened. Verified the file is
untouched by this PR (see Blast radius below).

## Live evidence

Of ~12 `sectorLeadershipFacts` occurrences in one live `GET
/api/market/nighthawk/horizons?view=swings` payload, 5-7 occurrences mismatched by 0.01pp, e.g.:

- `nameReturnPct: -12.16, groupReturnPct: -10.95, deltaPct: -1.22` — but
  `-12.16 - (-10.95) = -1.21`, not `-1.22`. Repeated 3-4x across `board.lanes.SWING.committed[]`,
  `sections.RESEARCH[]`, `sections.SCALING_OUT[]` — multiple surface points serving the same
  underlying dossier object.
- `nameReturnPct: -8.25, groupReturnPct: 2.29, deltaPct: -10.53` (true `-10.54`).
- `nameReturnPct: -14.42, groupReturnPct: -14.45, deltaPct: 0.02` (true `0.03`).
- `nameReturnPct: -1.16, groupReturnPct: -10.95, deltaPct: 9.78` (true `9.79`).

## Root cause

`roundFloats()` (`src/lib/round-floats.ts`) rounds every number in a payload independently by its
own key, with no awareness that `nameReturnPct`/`groupReturnPct`/`deltaPct` are related. Since
`deltaPct` is computed upstream at full precision (`industry-group-rs.ts` line 336:
`deltaPct: nameRet - groupRet`) and never re-derived at the response boundary, each of the three
numbers independently accumulates up to half a rounding step of drift at 2dp — enough that the
three together are no longer self-consistent by the time they reach the wire.

## Fix

Added a fourth reconcile helper, `reconcileSectorLeadershipDelta`, in `src/lib/round-floats.ts`,
following the same rounding-composition-fix pattern as its three siblings (derive the displayed
delta from the two ALREADY-ROUNDED display values, rounded again with the same sign-safe
round-by-magnitude formula the main walker uses, to absorb float noise — never leave it
independently rounded from the raw delta).

**Wiring differs deliberately from its three siblings, and that difference is the point of this
fix.** `reconcileStrikeTotal`/`reconcileCellStrikeTotals`/`reconcileTrancheFractions` are each
invoked explicitly at the one or two call sites that need them — appropriate there because they
either need extra caller context (`reconcileCellStrikeTotals` needs `nearTermExpiries`) or match on
key names (`total`, `strike_totals`) generic enough that auto-detecting them on any object anywhere
in any payload would be a real false-positive risk. `{ nameReturnPct, groupReturnPct, deltaPct }`
has neither problem: the three key names are specific to this one feature (repo-wide grep: no other
shape uses this combination), and the fix is a pure function of the object's own three fields with
no extra context needed. So this one is detected and applied directly inside `roundFloats`'s
generic object-walk branch, firing for ANY object shaped this way anywhere in ANY payload passed
through `roundFloats` — not just the horizons route. This is a deliberate, narrow generalization,
not scope creep: the live evidence itself shows the identical object served at three different
surface points in one payload (`committed[]`/`RESEARCH[]`/`SCALING_OUT[]`), which is exactly the
shape of bug a single per-route opt-in would have left two-thirds unfixed.

## Evidence (RED -> GREEN)

Isolated the source-only change: carried the new test file forward, reverted `round-floats.ts` to
its pre-fix content (`git show <parent>:src/lib/round-floats.ts`, since this worktree's git stash
stack is shared across concurrent sessions — avoided bare `git stash`), ran the regression suite,
restored the fix, re-ran.

- **RED** (pre-fix source, new tests present):
  `npx tsx --experimental-test-module-mocks --test src/lib/round-floats.test.ts` ->
  **37 pass / 7 fail** — exactly the 7 new tests exercising the fix (the rest of the 44-test file,
  including all pre-existing tests, passed untouched). One failure's exact error:
  `(0 , import_round_floats.reconcileSectorLeadershipDelta) is not a function` — the import itself
  proves the new export doesn't exist pre-fix, not merely a wrong assertion.
- **GREEN** (fix restored): same command -> **44 pass / 0 fail**.

New tests added to `src/lib/round-floats.test.ts`: pin all four mismatches from the live evidence
set exactly (`reconcileSectorLeadershipDelta` reproduces each one), prove the helper leaves an
already-self-consistent triple untouched (same object reference) and passes through a
missing/non-finite operand without guessing, and prove the auto-wiring inside `roundFloats` fires
for a bare object, for the real raw-float upstream shape end to end, and — the generality
requirement — for the shape nested inside arrays and nested objects across three parallel surface
points simultaneously (`board.lanes.SWING.committed[]`/`sections.RESEARCH[]`/
`sections.SCALING_OUT[]`), matching the real route's own fan-out of one underlying dossier object.
Also confirms the walker does NOT fabricate a `deltaPct` onto an object merely missing one of the
three required keys.

## Blast radius

- `src/lib/round-floats.ts`: added `reconcileSectorLeadershipDelta` + the shape-detection branch
  inside `roundFloats`'s object walk. No other branch of `walk()` changed.
- Every current consumer of `roundFloats()` that could ever carry a `sectorLeadershipFacts`-shaped
  object benefits automatically — today that is the Night Hawk Swings horizons route, at all three
  surface points it serves the object. No other call site needed to change.
- **`src/lib/swing/play-brief-intel.ts` (`whyThisSetupSection`, the `#7730`/`470d38e01` narrative
  fix) was checked and deliberately left untouched** — confirmed via `git diff` on this PR's branch
  showing zero changes to that file, and via direct inspection of its current source (its own
  "BUG FIX #2 (Ask Largo standing mandate, 2026-11-09)" comment at lines ~333-358), which already
  implements its own correct, independent sign-safe rounding at 1dp for the narrative sentence.
  That is a different bug (a sign-tie boundary mismatch in a text-rendering function) in a
  different code path (narrative generation, not the raw API field) and is out of scope here.
- `reconcileStrikeTotal`/`reconcileCellStrikeTotals`/`reconcileTrancheFractions` and every existing
  call site that explicitly invokes them are unmodified.
- Full regression suite (`npm test`, Node 20.20.2): **18552 pass / 0 fail / 3 skipped** (18555
  total) — no other test in the repo regressed from this change, including the
  "no keyDp -> byte-identical to the pre-override implementation" invariant test (its fixtures
  never carry this three-key shape, so it is unaffected) and every `roundFloats`-consuming route
  test (zerodte board/record, gex-matrix-deltas, swing record, nighthawk horizons, play-brief,
  play-brief-intel, etc. — ran targeted first, then the full suite).
- `npx tsc --noEmit`: clean.

## Why not caught earlier

The three existing reconcile helpers already establish this bug class is a known, recurring
failure mode of `roundFloats()` — but each was added reactively, after a specific audit tool or
live incident found one specific shape. `sectorLeadershipFacts` is a comparatively new field
(Ask Largo standing mandate, follow-up to `#5446`) and nothing had yet checked whether its own
three-field composition suffered the identical class of bug its siblings were built to fix.
