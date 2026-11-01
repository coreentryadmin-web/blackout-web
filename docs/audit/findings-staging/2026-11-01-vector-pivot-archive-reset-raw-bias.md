# 2026-11-01 Vector pick archive-reset key used a pivot play's raw (always-neutral) bias, so a committed direction flip never reset stale picks

> **kind:** FINDING

| Field | Value |
| --- | --- |
| **Status** | FIXED |
| **Severity** | P2 — member-visible, real trade-decision surface (Vector PLYS panel / closed-picks strip for pivot setups) |
| **Surface** | `src/features/vector/lib/use-vector-actionable-picks.ts` |

## Root cause

`useVectorActionablePicks` drives the Vector PLYS panel's full pick lifecycle: rank a pool, live-
monitor it, archive any pick the live monitor marks `dont_buy`, and exclude its OCC from the next
rank. It resets that archived/excluded state (`excludeOccs`, `archivedClosed`) whenever a stable
`contextKey` (`vectorPickArchiveResetKey`) changes:

```ts
const play = emit?.play ?? null;
const bias = play?.bias ?? null;                              // raw field
const contextKey = vectorPickArchiveResetKey(emit, sessionFlows.length, bias);
useEffect(() => {
  setExcludeOccs([]);
  setArchivedClosed([]);
  archivedOccsRef.current.clear();
}, [ticker, contextKey]);
```

A committed `pivot` play's raw `play.bias` field stays `"neutral"` by design — the play card shows
"long above / short below" and only commits to a real direction once spot clears the gamma flip by
`PIVOT_PICK_COMMIT_EPS` (`vector-pick-effective-bias.ts`'s `effectivePickBias`). That function's own
header already documents this exact trap, and it has already been found and fixed TWICE elsewhere
in this same feature for the identical raw-vs-effective confusion:

- `contract-picks/live/route.ts` (2026-08-29, `fix/vector-pivot-pick-bias-live-status`) — the
  live-status invalidation check read raw `play.bias` instead of the committed direction.
- `vector-pick-sweep.ts` / `vector-pick-sweep-core.ts` ("The server-side Vector pick sweep skipped
  every committed pivot play entirely" — `pickContextFromFullState` gated on raw `play.bias ===
  "neutral"`, silently skipping every committed pivot ticker).

The sibling CLIENT hook in the exact same lifecycle, `useVectorContractPicks`, already gets this
right — it computes `effectivePickBias(play, emit?.spot, emit?.gammaFlip) ?? play.bias` to decide
*what to fetch*. But `useVectorActionablePicks`'s own archive-reset key kept using the raw field,
so for a pivot play specifically, `bias` in its `contextKey` is **always `"neutral"`, regardless of
which side spot has actually committed to.**

Crucially, nothing else in `contextKey` reliably changes on a bias flip either:
`vectorPickArchiveResetKey`'s fields are `callWall|putWall|conviction|headline|sessionFlowsLen|
bias` — and for a pivot play the headline text is the static `"... pivot at the {flip} gamma flip
— long above / short below"` (`vector-play-engine.ts`'s `pivot` case), not direction-specific;
`callWall`/`putWall` reflect dealer wall levels, not spot's position relative to the flip. So when
spot crosses the flip and the committed direction flips from long to short (or back), `contextKey`
can stay byte-identical, and the archive-reset `useEffect` never fires.

## Evidence

Pure-function reproduction (`use-vector-actionable-picks.test.ts`), using the real
`effectivePickBias`/`vectorPickArchiveResetKey` the hook composes: a pivot play with the same
headline/walls/conviction, spot at 6560 (0.9% above a 6500 flip, committed long) vs spot at 6440
(0.9% below, committed short):

- A key built from `play.bias` directly (`"neutral"` both sides) is **identical** on both sides of
  the flip — `vectorPickArchiveResetKey(longCommit, 5, "neutral") ===
  vectorPickArchiveResetKey(shortCommit, 5, "neutral")`.
- A key built from `effectivePickBias(...)` (`"long"` vs `"short"`) correctly **differs**.

Confirmed RED→GREEN via `git stash` on the source file alone (test kept): pre-fix, the second test
(`archive-reset bias is derived via effectivePickBias`) fails because the hook's `bias` line has no
`effectivePickBias(` call; post-fix it passes.

## Blast radius

Single file: `use-vector-actionable-picks.ts`. Its consumers (`VectorComparePlayStrip.tsx`,
`VectorContractPicksCard.tsx` and whatever renders the PLYS panel) only see the hook's returned
`{ active, closed, loading }` and are unaffected by this change in shape — only in correctness: once
the archive-reset effect actually fires on a real direction flip, `mergeArchivedClosedPicks` no
longer carries the OLD direction's archived "Don't buy" cards forward into the NEW direction's
closed-picks list, and `excludeOccs` no longer accumulates stale OCCs from the direction that is no
longer live.

`useVectorContractPicks`'s own `bias`/fetch-effect logic is untouched — it already computed the
effective bias correctly; only its sibling hook's separate, independently-computed `bias` was wrong.
`vectorPickArchiveResetKey`/`vectorContractPickFetchKey` themselves are untouched and were already
correct (per the 2026-08-?? "useVectorContractPicks" FINDINGS entry's own "deliberately left
unchanged" note) — the bug was in this one caller passing the wrong bias value in, the same shape as
both prior fixes in this feature.

## Fix

Mirrored the already-correct computation from `useVectorContractPicks`:
`const bias = play ? effectivePickBias(play, emit?.spot, emit?.gammaFlip) ?? play.bias : null;`.
No change to `vectorPickArchiveResetKey`, `effectivePickBias`, or any other exported function —
only the value this one caller feeds into the key.

## Verify

- `npx tsx --experimental-test-module-mocks --test src/features/vector/lib/use-vector-actionable-picks.test.ts`
  — 2/2 green (new regression test included; RED→GREEN proven via `git stash` on the source file)
- `npx tsx --experimental-test-module-mocks --test src/features/vector/lib/use-vector-actionable-picks.test.ts src/features/vector/lib/use-vector-contract-picks.test.ts src/features/vector/lib/vector-pick-context-key.test.ts src/features/vector/lib/vector-pick-effective-bias.test.ts src/features/vector/lib/vector-pick-partition.test.ts src/features/vector/lib/vector-pick-live-status.test.ts`
  — 42/42 green
- Full `src/features/vector/lib/*.test.ts` sweep — 1349/1349 green, no regressions
- `npx tsc --noEmit` clean; `npx eslint src/features/vector/lib/use-vector-actionable-picks.ts src/features/vector/lib/use-vector-actionable-picks.test.ts` clean
