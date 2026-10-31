> **kind:** FINDING

## Vector `useVectorContractPicks`: fetch effect's own raw deps defeated its deliberately-stable refetch key, able to starve the debounced fetch entirely — FIXED

**Status:** Fixed, regression test added (`src/features/vector/lib/use-vector-contract-picks.test.ts`).

### Root cause

`useVectorContractPicks` (`src/features/vector/lib/use-vector-contract-picks.ts`) already
computes a deliberately **stable** `contextKey` via `vectorContractPickFetchKey` —
documented on that function as "same play fields + exclude list, no spot" and backed by
`vectorPickArchiveResetKey`'s own comment: *"Spot is intentionally excluded — it ticks every
second and must not wipe closed-pick history."* `sessionFlows` is folded into that key only
as `.length`, not by identity. The whole point of `contextKey` is to be the ONE signal that
decides when this hook should actually restart its 500ms debounce and 45s refresh interval —
exactly the pattern the sibling hook in the same lifecycle, `useVectorActionablePicks`, already
uses correctly for its own archive-reset effect: `useEffect(() => {...}, [ticker, contextKey])`,
never the raw `emit`.

But `useVectorContractPicks`'s own fetch effect listed `contextKey` **and** the raw `emit`,
`play` (`= emit?.play`) and `sessionFlows` directly in its dependency array:

```ts
}, [ticker, play, bias, contextKey, liveSession, emit, sessionFlows, paused, excludeOccs, refetchToken]);
```

`emit` and `play` get a brand-new object identity on every parent render where the fused
`VectorPlay`'s `grade` or `entryZone` field changes (`VectorChart.tsx`'s `emitPlay()` only
dedupes/re-emits on `headline|conviction|grade|entryZone`, independent of what
`vectorContractPickFetchKey` folds into `contextKey`: `callWall|putWall|conviction|headline|
sessionFlowsLen|bias|excludeOccs`). `sessionFlows` gets a new array identity on effectively
every live print (new flow arrives, oldest ages out — count unchanged, reference changed).
So it's possible — and, during an active tape, routine — for `emit`/`play`/`sessionFlows` to
change identity while `contextKey` stays byte-identical, and the raw dependencies fire the
effect's cleanup+re-run anyway: the pending `setTimeout(load, DEBOUNCE_MS)` is cancelled and
the `setInterval(load, REFRESH_MS)` is torn down and recreated, every single time.

The consequence is two-fold:
1. **The documented "every ~45s" refresh (see the function's own JSDoc) can never actually
   elapse** once updates arrive faster than 45s apart — which is the normal case while a name
   is live — because the interval is destroyed and rebuilt before it ever fires.
2. **Worse, the initial debounced fetch can be starved outright.** If `emit`/`sessionFlows`
   update faster than `DEBOUNCE_MS` (500ms) — plausible during a burst of flow prints — the
   pending `setTimeout` is cancelled and rescheduled every time before it ever runs, so
   `load()` never fires at all for as long as the burst continues. The PLYS contract-pick
   panel would simply sit on stale/empty picks with no error and no visible cause.

### Evidence

- Read `vector-pick-context-key.ts` and confirmed by its own doc comments that `contextKey`
  is deliberately built to exclude spot (ticks every second) and to use `sessionFlows.length`
  rather than identity — i.e. it is explicitly designed to be MORE stable than `emit`/
  `sessionFlows` themselves.
- Read `VectorChart.tsx`'s `emitPlay()` (the sole producer of `playEmit`/`emit`, wired via
  `onPlayChange={setPlayEmit}` in `VectorPageShell.tsx`): it dedupes on
  `` `${play.headline}|${play.conviction}|${play.grade}|${play.entryZone ?? ""}` ``, a
  DIFFERENT set of fields than `contextKey`'s own `callWall|putWall|conviction|headline`.
  So a `grade`/`entryZone`-only change produces a new `emit` object while leaving
  `contextKey` unchanged — the exact divergence this bug depends on.
- Confirmed the established, already-correct sibling pattern in the SAME file family:
  `useVectorActionablePicks`'s archive-reset effect (`use-vector-actionable-picks.ts`) uses
  `[ticker, contextKey]` only, never the raw `emit` — this fix brings the fetch effect in line
  with that existing convention instead of introducing a new one.
- No render harness exists in this repo (`VectorScanner.test.ts`'s own note: "no
  renderHook/@testing-library"), so the regression test asserts the fix is wired into the
  source, matching that established pattern.
- **RED (pre-fix, via `git stash` on `use-vector-contract-picks.ts` only, keeping the new
  test):** both new assertions failed — the dependency array still listed `emit`/`play`/
  `sessionFlows`, and `load()` had no `emitRef.current`/`playRef.current`/
  `sessionFlowsRef.current` reads.
- **GREEN (fix restored):** both assertions pass.
- `npx tsc --noEmit` clean.
- `npx eslint src/features/vector/lib/use-vector-contract-picks.ts` clean (0 warnings, 0
  errors — the `react-hooks/exhaustive-deps` warning for the now-intentionally-omitted
  `emit`/`play` is suppressed with an inline rationale comment, the same convention used
  elsewhere in this codebase, e.g. `VectorPageShell.tsx`'s ticker-switch effects).
- Full blast-radius re-run: every `.test.ts` file in `src/features/vector/lib/` (1316 tests
  across 10 suites) — all pass, confirming the sibling hooks/partition/context-key logic this
  hook composes with are untouched and still correct.

### Blast radius

Only `useVectorContractPicks` itself changes. Its sole consumer,
`useVectorActionablePicks` (`use-vector-actionable-picks.ts`), passes through the returned
`{ picks, loading }` unchanged — no call-site changes needed. `VectorComparePlayStrip.tsx`
and `VectorContractPicksCard.tsx` (both consumers further up the tree) are unaffected: they
only ever see the hook's return value, never its internal effect timing.

### Fix rationale

Added `emitRef`/`playRef`/`sessionFlowsRef`, updated on every render (the same ref-mirroring
pattern already used elsewhere in this feature, e.g. `VectorDailyChart.tsx`'s
`onHoverPriceRef`), and changed `load()` to read through them instead of closing over the
effect's own `emit`/`play`/`sessionFlows` parameters. The effect's dependency array now lists
only `[ticker, bias, contextKey, liveSession, paused, excludeOccs, refetchToken]` — `contextKey`
is the single signal for "restart the debounce/interval timers," while `load()` (whenever it
actually runs, on its own schedule) always sees the CURRENT desk context via the refs. This
fixes both problems at once: the timers no longer reset on noise the design already meant to
ignore, and the periodic 45s refresh still sends fresh (not stale) `technicals`/walls/
`confluenceZones`/`darkPoolLevels` on every tick, since those are read from the ref rather
than frozen at whatever render last changed `contextKey`.

Considered and rejected: removing `emit`/`play`/`sessionFlows` from the effect without adding
refs (would make the periodic `load()` calls use whatever desk context existed when the
effect last restarted — stale walls/technicals/confluence on every 45s refresh until
`contextKey` next changes, trading one staleness bug for another). Also considered leaving
`excludeOccs` out of the deps array as well, since `contextKey` already folds it in — left it
in place since it is not part of the bug (its reference only changes when its CONTENT changes,
via `setExcludeOccs`'s controlled append in `useVectorActionablePicks`) and removing it would
be unrelated scope creep.

### Deliberately left unchanged

- `vectorContractPickFetchKey`/`vectorPickArchiveResetKey` (`vector-pick-context-key.ts`) —
  already correct; the bug was the fetch effect ignoring the stability they provide, not a
  defect in the key functions themselves.
- `useVectorActionablePicks`'s own effects — already follow the correct `[ticker, contextKey]`
  pattern; re-verified, not re-fixed.
- `VectorChart.tsx`'s `emitPlay()` dedupe key — intentionally narrower than `contextKey` for
  its own purpose (deciding when the Suggested Play card itself re-renders); out of scope here.
