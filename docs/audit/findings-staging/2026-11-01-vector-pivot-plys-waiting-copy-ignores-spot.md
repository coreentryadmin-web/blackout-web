# 2026-11-01 Vector PLYS card: pivot "waiting for commit" copy never read `spot`, so it never stopped showing once price already committed past the flip

> **kind:** FINDING

| Field | Value |
| --- | --- |
| **Status** | FIXED |
| **Severity** | P2 member-facing correctness — misleading state after a real trigger has already fired |

## Root cause

`VectorContractPicksCard.tsx` renders the PLYS (contract picks) rail. When there are zero active
and zero closed picks, it has three possible empty states: loading, "no contract cleared our
setup-quality bar for this play right now" (a directional play exists, nothing qualified), and a
pivot-specific "waiting for commit" message (`pivotPickWaitingCopy`, from
`vector-pick-effective-bias.ts`): *"Spot is on X — contract picks rank once price commits above
or below the flip."*

The branch choosing between the second and third state used to be:

```ts
if (play && play.bias !== "neutral") {
  return <... "No contract ... cleared our setup-quality bar" ...>;
}
const pivotWait = play ? pivotPickWaitingCopy(play, gammaFlip) : null;
if (play && pivotWait) {
  return <... pivot waiting copy ...>;
}
```

A "pivot" play (`vector-play-engine.ts`'s own comment: *"pivot stays neutral in bias but still
earns a PLYS rail"*) keeps `play.bias === "neutral"` for its **entire lifetime** — including
after spot has already committed past the gamma flip (`vector-play-engine.ts:117`). The real
commit state lives in `effectivePickBias(play, spot, gammaFlip)` (`vector-pick-effective-bias.ts`),
which needs **both** `spot` and `gammaFlip` to resolve a side once `|spot - flip| / flip` clears
`PIVOT_PICK_COMMIT_EPS`.

`pivotPickWaitingCopy`, however, only ever took `(play, gammaFlip)` — structurally unable to see
`spot` at all — and `VectorContractPicksCard`'s own `spot` prop (documented: *"Spot + flip for
pivot plays — ranks PLYS once spot commits past the flip"*, wired from both real call sites) was
destructured and never read anywhere in the component. So for a pivot play with zero qualifying
contracts, the card could never distinguish "genuinely still sitting on the flip, waiting to
commit" from "already committed to a side, but no contract in the chain cleared the quality bar"
— it always rendered the waiting copy, permanently, even once price had clearly crossed.

## Why this wasn't caught earlier

The bug is invisible to a type-checker or a lint pass: `spot` is a real, correctly-typed prop that
is simply never referenced in the function body — no unused-variable warning fires because it is
consumed by the destructuring default (`spot = null`) and nothing downstream complains about an
unread parameter. It is also invisible to every existing test, because the established pattern for
this component (`VectorContractPicksCard.test.ts`) is source-text assertions, and no prior test
asserted *which* bias (raw vs. effective) the empty-state branch reads. The same root-cause family
— a raw, always-"neutral"-for-pivots `bias` read instead of the effective, spot/gammaFlip-aware
one — has now been found and fixed three times this session at other call sites
(`contract-picks/live/route.ts`, `vector-pick-sweep.ts`/`vector-pick-sweep-core.ts`,
`use-vector-actionable-picks.ts` in PR #7263); this is a fourth, independent instance, in the
component that renders the member-visible copy itself, not in a hook or a server route.

## Evidence

- Confirmed `spot` is declared (`spot?: number | null`), destructured (`spot = null`), and then
  never referenced again anywhere in `VectorContractPicksCard.tsx` (`grep -n "\bspot\b"` — only
  the two declaration lines match).
- Confirmed both real call sites pass a real, live `spot` value that the component then drops:
  `VectorPageShell.tsx` (`spot={playEmit?.spot ?? liveSpot}`) and `VectorComparePlayStrip.tsx`
  (`spot={playEmit?.spot ?? null}`).
- Confirmed `pivotPickWaitingCopy`'s old two-argument signature `(play, gammaFlip)` structurally
  could not know whether spot had committed — it only ever checked
  `play.setup !== "pivot" || play.bias !== "neutral"`, which is permanently false (i.e. the guard
  never fires) for the whole life of a pivot play, since pivot plays never leave `bias: "neutral"`
  by construction.
- RED→GREEN via `git stash` on the two touched source files: the new
  `pivotPickWaitingCopy: returns null once spot has already committed past the flip` test and the
  new `VectorContractPicksCard: quality-bar-empty check uses effective bias, not raw play.bias`
  source-text test both fail pre-fix (the former returns the waiting-copy string instead of
  `null` for a clearly-committed spot/flip pair; the latter can't find
  `effectivePickBias(play, spot, gammaFlip)` in the source) and both pass post-fix; `git stash pop`
  restored the fix cleanly.
- Full `src/features/vector/lib/vector-pick-effective-bias.test.ts` +
  `src/features/vector/components/VectorContractPicksCard.test.ts`: 9/9 pass. Full
  `src/features/vector/**/*.test.ts` suite (1456 tests, 11 suites): 1456/1456 pass. `tsc --noEmit`
  clean. Node 20.20.2.

## Blast radius

One function (`pivotPickWaitingCopy`) with exactly one real call site
(`VectorContractPicksCard.tsx`), which itself has exactly two call sites
(`VectorPageShell.tsx`'s desktop action rail / iOS Plays segment, and
`VectorComparePlayStrip.tsx`'s Compare-desk focused-ticker rail) — both already pass `spot`
through correctly to the card, so no caller-side change was needed beyond the card forwarding it
one level deeper into `pivotPickWaitingCopy` and into the new `effectivePickBias` check.

## Fix rationale

Two changes, same shape as the three prior fixes this session:

1. `pivotPickWaitingCopy(play, gammaFlip)` → `pivotPickWaitingCopy(play, spot, gammaFlip)`, and
   internally it now returns `null` (no longer waiting) once
   `effectivePickBias(play, spot, gammaFlip) != null` — i.e. once a side has actually resolved.
2. `VectorContractPicksCard`'s empty-state branch now resolves `effBias =
   effectivePickBias(play, spot, gammaFlip)` once and gates the "no contract cleared the bar"
   message on `effBias` truthiness instead of raw `play.bias !== "neutral"`, so a committed pivot
   play with zero qualifying contracts now correctly shows that message instead of falling through
   to the (now also spot-aware) `pivotWait` branch.

Did not change `effectivePickBias` itself (already correct, already covered by its own tests) or
either call site's props (both already pass `spot` correctly) — the defect was purely in this one
component failing to use a prop it already had.
