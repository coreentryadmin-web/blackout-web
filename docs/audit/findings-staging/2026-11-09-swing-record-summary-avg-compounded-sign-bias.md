> **kind:** FINDING

## Swing `avg_compounded_return_pct` sign-bias rounding tie — `record.ts`'s `buildSwingRecordSummary` — FIXED

| **Status** | FIXED (this PR) |

### Root cause

Earlier TODAY (commit `f68772f0b`, PR #7706) `record.ts`'s module-level `round2` helper was fixed
from a plain `Math.round(n*100)/100` to a sign-safe
`(Math.sign(n) * Math.round(Math.abs(n) * 100)) / 100`, specifically because plain rounding ties
toward `+Infinity` (`Math.round(-12.5) === -12`, not `-13`), so a losing (negative) value sitting
exactly on a 2dp tie understates its own magnitude relative to its winning mirror image. That fix
only touched `round2`'s own definition and its PRE-EXISTING call sites inside `buildSwingRecord`
(`realizedPnlPct`/`worstLegPnlPct`/`sumPnlPct`/`compoundedReturnPct`, lines ~151/184/185/189).

It never touched `buildSwingRecordSummary` (a separate function, further down the same file),
whose lane-wide `avg_compounded_return_pct` aggregate is computed with its **own, independent**
plain `Math.round` expression that never calls `round2` at all:

```ts
const avgCompounded = compounded.length > 0
  ? Math.round((compounded.reduce((a, b) => a + b, 0) / compounded.length) * 10) / 10
  : null;
```

(grep-confirmed: zero call sites of `round2` inside `buildSwingRecordSummary`.) This field is
bidirectional — the live response right now serves `summary.avg_compounded_return_pct: -6.2`
(90-day window, 66 resolved chains, confirmed negative) — and `avgCompounded` divides a sum of
already-2dp-precision `compoundedReturnPct` values by an arbitrary, daily-changing chain count,
which **can** genuinely land on an exact 1dp tie for the right data: e.g. a sum of exactly `-12.50`
over 2 chains gives a true average of `-6.25`, where plain `Math.round(-62.5)/10` gives the
sign-biased `-6.2` (ties toward `+Infinity`: `Math.round(-62.5) === -62`) instead of the correct,
magnitude-preserving `-6.3`. This is a smaller-magnitude-when-negative bug, same class and same
mechanism as the `round2` bug fixed in the same file earlier today, just in a different function
that formula never reached.

### Blast radius

Single call site — `avg_compounded_return_pct` is only computed in `buildSwingRecordSummary`,
served by `GET /api/market/swing/record`'s `summary` object to members and Largo. No other
plain-`Math.round` expression on a potentially-negative field exists in this function:
`win_rate_pct` (`Math.round((wins / decided) * 1000) / 10`) divides two non-negative counts
(`wins`, `decided`), so it can never be negative and the sign-bias formula would be a no-op there
— left untouched, per this PR's scope (fix what's actually bidirectional in this one function,
not every `Math.round` call).

### Fix rationale

Generalized `round2` into a parameterized `roundSignSafe(n, dp)` (same exact formula shape,
`(Math.sign(n) * Math.round(Math.abs(n) * factor)) / factor`), with `round2` now defined as
`roundSignSafe(n, 2)` — a small, local, additive change (no other call site's behavior changes;
`round2` is byte-for-byte the same function for every existing caller). `buildSwingRecordSummary`
now computes `avgCompounded` via `roundSignSafe(sum/count, 1)` instead of hand-rolling a second,
easy-to-drift copy of the sign-safe formula at a different precision. Reuse over duplication, per
the repo's standing preference, and it keeps both decimal precisions used in this file — 2dp for
per-chain fields, 1dp for the lane-wide average — visibly the same algorithm rather than two
near-identical formulas that could silently diverge under a future edit.

### Evidence

New regression test in `record.test.ts`
(`"buildSwingRecordSummary: avg_compounded_return_pct at an exact 1dp tie rounds by MAGNITUDE, not
toward 0"`) constructs two single-leg resolved chains with `compoundedReturnPct` of exactly `-5.00`
and `-7.50` (both already exact at `round2`'s 2dp, so `round2` itself introduces no further
rounding ambiguity) — summing to exactly `-12.50` over 2 chains, a true average of `-6.25`, landing
exactly on the 1dp tie this bug concerns.

RED→GREEN, isolating just the source fix (the test file was unchanged throughout):
- Backed up the fixed `record.ts`, then reverted ONLY the `avgCompounded` line back to the
  pre-fix plain `Math.round((sum/count)*10)/10` (the `round2`/`roundSignSafe` definitions were
  left in place, since they are the earlier same-day fix, not this one).
- Re-ran `record.test.ts`: the new test failed exactly as predicted —
  `AssertionError: Expected values to be strictly equal: -6.2 !== -6.3` (`actual: -6.2`,
  `expected: -6.3`) — confirming the pre-fix code really does produce the sign-biased, understated
  result.
- Restored the fixed `avgCompounded` line; re-ran `record.test.ts`: **17/17 pass**, including the
  new test and every pre-existing test in the file (the breakevens/`selectSwingRecordRootIds`/
  served-rounding tests from earlier fixes this session, all untouched by this change).
- `src/app/api/market/swing/record/route.test.ts` (the route that calls
  `buildSwingRecordSummary` in production): 5/5 pass, unaffected.
- `npx tsc --noEmit`: clean, no errors.
- Full `npm test` (Node 20, `scripts/run-tests.mjs`): run as part of this PR's verification; see
  PR description for the result.

Mirror-image check included in the same test: the identical-magnitude WINNING pair (`+5`, `+7.5`,
same tie shape) rounds to `+6.3`, confirming the fix removes the asymmetry rather than merely
changing the number — `Math.abs(losingAvg) === Math.abs(winningAvg)` now holds, which did not hold
pre-fix (`6.2 !== 6.3`).
