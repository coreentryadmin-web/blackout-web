> **kind:** FINDING

## Vector Compare — stale gamma-posture chip survives a preset swap (`VectorCompareDesk.tsx`)

| | |
|---|---|
| **Area** | Vector Compare (`/vector?compare=...`) |
| **File** | `src/features/vector/components/VectorCompareDesk.tsx` |
| **Status** | Fixed |

### Root cause

`VectorCompareDesk` keeps two sibling per-ticker state maps that both need pruning whenever the
active compare set changes: `playByTicker` (play-desk snapshot) and `metaByTicker` (regime
posture + spot — the long-γ/short-γ chip rendered in the "Compare summary" footer, lines 672-687
pre-fix).

`playByTicker` has a dedicated `useEffect` keyed on `seeds` that deletes any entry whose ticker is
no longer active — added specifically so a stale snapshot from a removed ticker can never persist.
`metaByTicker` is the *older* of the two sibling maps, predating that effect, and was only ever
pruned inside `removeTicker`'s own explicit `delete copy[ticker]` (one line, triggered only by the
pane's own ✕ button).

That targeted delete does not run on `applyPreset`, which replaces the whole `seeds` array in one
`setSeeds(ok)` call (switching from one preset to another, e.g. "Big Tech" → "Indices"). So when a
ticker leaves the compare grid via a preset swap and is later re-added — either by another preset
swap or by `loadTicker` (the "add symbol" command-bar control) — `metaByTicker[ticker]` is still
the map's *old* entry from the ticker's previous mount. The footer renders it immediately on the
next paint, before the freshly-mounted `VectorComparePane`'s own live regime fetch calls `onMeta`
to overwrite it with a fresh value. The member briefly (and, if the fresh fetch is slow or the
pane errors before completing, for longer) sees a real-looking but **outdated** gamma-posture
label — "▲ long γ" / "▼ short γ" — for a ticker whose actual current regime may have flipped since
it was last in the grid. On a trading product this is exactly the kind of UI the operator's
standing Vector/Night Hawk correctness mandates exist to catch: a value that looks authoritative
but is stale.

### Evidence

`git log --follow -p` on `VectorCompareDesk.tsx` shows `metaByTicker` was introduced before
`playByTicker`; the `playByTicker` cleanup effect (`useEffect` deleting keys not in the active
ticker set) was added in a later commit alongside `playByTicker` itself, and was never backported
to the older `metaByTicker`. Grepping the file for `setMetaByTicker` confirms exactly two call
sites: `handleMeta` (sets fresh data) and `removeTicker`'s one-ticker `delete` — no general
cleanup tied to `seeds` changing as a whole.

Regression test (`src/features/vector/lib/vector-compare.test.ts`, new `pruneStaleTickerEntries`
suite) proves RED→GREEN: before the fix, the shared pruning helper did not exist at all (4 test
failures, `TypeError: ... pruneStaleTickerEntries) is not a function`); after the fix, all 4 new
tests plus the full existing 15-test file pass (19/19).

### Blast radius

Only `metaByTicker` was missing the cleanup — `playByTicker` already had it. No other per-ticker
state map in this component (`loadingTickers` is a plain `Set` rebuilt per operation; `exclude` is
derived via `useMemo` from `seeds` directly, so it can't go stale this way).

### Fix rationale

Extracted the existing `playByTicker` pruning logic into a shared, pure, unit-tested helper
(`pruneStaleTickerEntries` in `src/features/vector/lib/vector-compare.ts`) and added the same
`useEffect` pattern for `metaByTicker`, keyed on `seeds` exactly like `playByTicker`'s. This both
fixes the gap and removes the duplication that let the two maps drift apart in the first place —
any future third per-ticker map gets the same guarantee for free by reusing the helper.
`removeTicker`'s existing single-ticker `delete` on `metaByTicker` was left in place (now
redundant with the new effect, but harmless) rather than removed, to keep the diff minimal and not
risk a behavior change on that path.

Deliberately NOT changed: `VectorComparePane`'s own `onMeta` firing cadence, or anything in the
excluded `vector-pulse.ts`/`vector-coaching.ts`/`vector-replay.ts`/`vector-compare-replay.ts`
files — this fix is confined to `VectorCompareDesk.tsx`'s own state management and the new shared
helper in `vector-compare.ts`.
