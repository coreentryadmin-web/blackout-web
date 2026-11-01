> **kind:** FINDING

## Vector pivot contract-pick bias fabricated a direction from a non-finite gamma flip — FIXED

**Status:** FIXED (PR, `fix/vector-pivot-bias-nonfinite-flip`)

### Root cause

`src/features/vector/lib/vector-pick-effective-bias.ts`'s `effectivePickBias` — the function that
re-derives a committed LONG/SHORT ranking bias for a `pivot`-setup Vector play once spot has
crossed the gamma flip (so the PLYS/contract-pick panel isn't permanently empty for a pivot card,
whose own `bias` field stays `"neutral"` by design) — guarded its `gammaFlip` input with only:

```ts
if (flip == null || !(spot != null && spot > 0)) return null;
```

`flip == null` only rejects `null`/`undefined`. It does **not** reject `NaN` — `NaN !== null` and
`NaN !== undefined`, so a non-finite flip sails straight through the guard and into:

```ts
const dist = Math.abs(spot - flip) / flip;      // NaN - anything is NaN, so dist is NaN
if (dist < PIVOT_PICK_COMMIT_EPS) return null;  // NaN < x is always false — never short-circuits
return spot > flip ? "long" : "short";          // spot > NaN is always false -> "short"
```

The function doesn't throw and doesn't return `null` ("undetermined") — it silently returns
`"short"` for **every** spot value whenever `gammaFlip` happens to be `NaN` (or `Infinity`,
`-Infinity`), fabricating a confident directional bias from a value that was never actually
determined. That bias feeds contract-pick ranking directly (`vector-play-candidates.ts`'s
`rankBias`, `use-vector-contract-picks.ts`'s `bias`, `vector-pick-sweep-core.ts`'s committed
`bias`), so a bad flip read would have silently biased which contracts get ranked/committed as
"short" for a pivot setup, with nothing in the payload distinguishing it from a real read.

**This is the exact "guard present on one sibling field, missing on another" shape the standing
audit mandate is tracking** (most recently #7184, `helix-flow-deep-link.ts`): the very next
function in this same file, `pivotPickWaitingCopy`, already guards the identical `gammaFlip`
field correctly —

```ts
const lvl =
  gammaFlip != null && Number.isFinite(gammaFlip)
    ? gammaFlip.toLocaleString(...)
    : "the gamma flip";
```

— proving the author knew `gammaFlip` needed a finiteness check for this exact field, two lines
away, and the sibling function (`effectivePickBias`) simply didn't carry it. The rest of this
codebase's `gammaFlip`-adjacent code agrees with the stricter check too:
`vector-play-engine.ts`'s own internal `num()` helper (used to derive `flip` for the engine's
internal computations) is `typeof n === "number" && Number.isFinite(n) ? n : null` — finiteness,
not just non-null, is already the established bar for this exact value everywhere else it's
handled.

### Blast radius

One function, `effectivePickBias`, called from four sites, all of which inherit the fix for free
(no other call site needed a change):
- `src/app/api/market/vector/contract-picks/live/route.ts` (already sanitizes via its own local
  `numOrNull`, so unaffected in practice, but now doubly defended)
- `src/features/vector/lib/use-vector-contract-picks.ts` (`emit?.gammaFlip`, live WS-sourced)
- `src/features/vector/lib/vector-play-candidates.ts` (`ctx.gammaFlip`, ranking)
- `src/lib/vector/vector-pick-sweep-core.ts` (`state.gammaFlip`, committed leader bias)

### Fix rationale

Added `!Number.isFinite(flip)` to the existing early-return guard, matching the sibling function
in the same file and the engine's own internal `num()` convention. Deliberately left the
positivity check (`spot > 0`) as-is — `spot` is validated by `evaluateVectorPickLiveStatus`'s own
upstream callers already, and `flip` itself needs no `> 0` floor beyond finiteness since the
division is the only place it's used and a finite non-zero divisor is already guaranteed by every
real call site; adding an unused positivity requirement on `flip` would be scope creep beyond the
one real defect (the missing finiteness check) this fix targets.

### Evidence

RED→GREEN regression test added to `vector-pick-effective-bias.test.ts`:
`effectivePickBias(pivotPlay(), 353, NaN)` returned `"short"` before the fix (confirmed via a
failing `npx tsx --experimental-test-module-mocks --test` run) and `null` after. Full
`src/features/vector` test suite (1444 tests, 11 suites) and `tsc --noEmit` both clean post-fix.
