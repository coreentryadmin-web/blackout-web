# 2026-11-09: VectorCompareDesk's per-pane `onReplayTimeline` callback churned every render, creating a self-sustaining render/effect loop in Vector Compare mode

> **kind:** `FINDING`

**Status.** FIXED — this PR.

## Summary

`VectorCompareDesk.tsx` built each compare pane's `onReplayTimeline` prop as a fresh INLINE
closure on every single render — `(timeline) => handleReplayTimeline(seed.ticker, timeline)`,
created anew inside the `seeds.map()` JSX regardless of whether anything about that pane actually
changed. `VectorChart.tsx` deliberately lists its own `onReplayTimeline` prop in a `useEffect`
dependency array (`[sessionHistory, sessionBars, onReplayTimeline]`), and since neither
`VectorChart` nor `VectorComparePane` is wrapped in `React.memo`, every `VectorCompareDesk` render
propagates a brand-new `onReplayTimeline` reference all the way down, re-firing that effect even
when `sessionHistory`/`sessionBars` are byte-for-byte unchanged. That effect's call eventually
writes a brand-new `unionTimeline` array (via `mergeReplayTimelines`, which never reuses a
reference), and `setUnionTimeline` never bails on content equality — a new array is never
`Object.is`-equal to the old one — so the write triggers another `VectorCompareDesk` render, which
recreates the inline callback again, closing a self-sustaining loop with **no terminating
condition tied to real data**.

## Root cause

Chain:
1. `seeds.map((seed) => <VectorComparePane ... onReplayTimeline={(timeline) =>
   handleReplayTimeline(seed.ticker, timeline)} />)` — a new function object every render.
2. `VectorComparePane`/`VectorPageShell` pass it straight through unwrapped to `VectorChart`
   (confirmed via `grep -rn "onReplayTimeline=" src/features/vector/components/*.tsx` — exactly
   one originating call site, the other two are pass-throughs).
3. `VectorChart.tsx`: `useEffect(() => { if (!onReplayTimeline) return;
   onReplayTimeline(buildReplayTimeline(sessionHistory, sessionBars)); }, [sessionHistory,
   sessionBars, onReplayTimeline]);` — correctly re-runs whenever `onReplayTimeline`'s reference
   changes, which is the deliberate/intended behavior for a GENUINE prop swap, but indistinguishable
   from the spurious per-render churn here.
4. `handleReplayTimeline` → `setUnionTimeline(mergeReplayTimelines([...timelinesRef.current.values()]))`.
   `mergeReplayTimelines` (`vector-compare-replay.ts`) builds a `Set` then spreads+sorts it into a
   brand-new array EVERY call, with zero reference caching — so even when the resulting VALUES are
   identical to the last call, the array OBJECT never is.
5. `setUnionTimeline(newArrayEveryTime)` is never `Object.is`-equal to the previous state, so React
   schedules another `VectorCompareDesk` render — which recreates the inline callback from step 1,
   closing the loop.

This directly contradicts this very file's own doc comments on the adjacent `timelinesRef` pruning
effect (and the matching `FINDINGS.md` entry for `pruneStaleTickerMapEntries`), which describe
`handleReplayTimeline` as firing "whenever [a pane's] own sessionHistory/sessionBars change, i.e.
on its next bar" — the INTENDED model, which was never actually true while the per-pane callback
churned every render. Three prior audit rounds (243, 244, 245, cited in that same finding)
reasoned about this file's replay-timeline pruning behavior under that same (incorrect) mental
model without catching that the premise itself didn't hold.

## Evidence (RED → GREEN)

New test: `src/features/vector/components/VectorCompareDesk-replay-timeline-handler-stability.test.ts`.

RED (pre-fix, via `git stash` isolating only the source change): 5/5 new tests failed — the inline
closure pattern was still present, `getReplayTimelineHandler` didn't exist, no per-ticker cache,
no ref-mirror of `handleReplayTimeline`, no pruning of a handler cache.

GREEN (post-fix): 5/5 new tests pass; all 117 tests across the sibling source-scan suites that
reference `VectorCompareDesk.tsx` (`vector-tier-fixes.test.ts`, `ios-compact-controls.test.ts`,
both `vector-chart-viewport.test.ts` files) plus `vector-compare.test.ts`,
`vector-compare-replay.test.ts`, and `vector-compare-sync.test.ts` pass together; `npx tsc
--noEmit` clean.

## Fix

Cache ONE stable function per ticker instead of a fresh closure every render:
- `handleReplayTimelineRef` mirrors the latest `handleReplayTimeline` every render (no dep array,
  the same ref-mirror discipline used throughout `VectorChart.tsx` for this exact shape) —
  necessary because `handleReplayTimeline` itself still legitimately churns whenever `seeds`
  changes (adding/removing a pane), so the cached per-ticker function must never close over a
  stale instance of it.
- `getReplayTimelineHandler(ticker)` looks up (or lazily creates and caches) a stable function per
  ticker in `replayTimelineHandlersRef`, a `Map` that lives for the component's life. The returned
  function always calls `handleReplayTimelineRef.current(ticker, timeline)`, so it never goes
  stale while never changing identity.
- The JSX now reads `onReplayTimeline={getReplayTimelineHandler(seed.ticker)}` — the SAME function
  object across renders for a given ticker, breaking the identity churn `VectorChart`'s effect was
  reacting to.
- The cache is pruned on ticker departure via the existing `pruneStaleTickerMapEntries` helper,
  added to the SAME `[seeds]`-keyed effect that already prunes `timelinesRef` — mirroring the
  file's established pattern for every other ticker-keyed map (`metaByTicker`, `playByTicker`,
  `timelinesRef`) rather than leaving the handler cache to accumulate stale entries indefinitely.

## Fix rationale

Memoizing the CALLBACK (not relaxing `VectorChart`'s dependency array, and not adding equality
checks to `mergeReplayTimelines`/`setUnionTimeline`) is the minimal fix that restores the
documented intended behavior: `VectorChart`'s effect SHOULD re-fire on a genuine prop swap (e.g. a
pane's `onReplayTimeline` handler legitimately changing because the pane itself changed), and it
still will — this fix only removes the SPURIOUS churn from an unmemoized per-render closure.
Deliberately left unchanged: `mergeReplayTimelines`'s always-fresh-array behavior (reasonable on
its own; the bug was never in that function, which has no reason to know or care about render
identity) and `handleReplayTimeline`'s own `[seeds]` dependency (also correct — it needs the
current `seeds` list to prune stale map entries).

## Blast radius

One file (`VectorCompareDesk.tsx`), one call site. Confirmed via `grep -rn "onReplayTimeline=" src/features/vector/components/*.tsx`
that `VectorComparePane.tsx` and `VectorPageShell.tsx` both pass the prop straight through
unwrapped — `VectorCompareDesk.tsx` is the ONLY place this callback originates, so fixing it there
closes the entire chain. Checked every other inline per-pane callback in the same `seeds.map()`
JSX (`onRemove`, `onFocus`, `onRequestFocusExpand`) for the same shape: all three are plain
user-interaction event handlers never referenced inside a `useEffect` dependency array on the
receiving end, so their per-render churn is the normal, harmless React pattern — `onReplayTimeline`
was the only one that also fed a dependency-tracked effect with a self-amplifying side effect.
