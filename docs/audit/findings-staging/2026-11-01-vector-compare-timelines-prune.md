> **kind:** FINDING

# VectorCompareDesk `timelinesRef` was not proactively pruned when a ticker left the compare set

| Field | Value |
|---|---|
| **Area** | Vector → Compare desk (`src/features/vector/components/VectorCompareDesk.tsx`) |
| **Severity** | P3 (cosmetic/self-healing-during-RTH; affects the linked-replay scrubber's range, not live data) |
| **Status** | Fixed |

## Root cause

`timelinesRef` (a `Map<string, number[]>`, one entry per compare pane) backs `unionTimeline`,
which drives the linked-replay scrubber's step count and jump-to-open/close bounds.
`handleReplayTimeline` already pruned stale keys out of the ref — but only as a side effect of
the *next* call to `handleReplayTimeline` for some *other* ticker (each pane calls it whenever its
own `sessionHistory`/`sessionBars` change, i.e. on its next bar). Removing a pane via `removeTicker`
or swapping the whole `seeds` array via `applyPreset` did not itself prune the ref — unlike its two
sibling per-ticker records, `metaByTicker` and `playByTicker`, which already get a proactive,
`seeds`-keyed `useEffect` cleanup via `pruneStaleTickerEntries` (added for exactly this reason,
per that function's own doc comment).

During live RTH, with other panes still ticking every few seconds, this self-healed quickly and
was easy to miss. But off-hours (replay data static, nothing ticking), or if the removed pane was
the only one still producing updates, the departed ticker's last-known timeline could sit in
`timelinesRef.current` indefinitely — inflating `unionTimeline` with steps that belong to a pane
no longer on screen, which widens the linked-replay scrubber's range and its open/close jump
targets beyond what the currently-visible panes actually cover.

This exact gap had been flagged by three prior audit rounds (243, 244, 245) as low-priority and
left unresolved each time; this round fixes it rather than re-flagging it a fourth time.

## Evidence

Added `pruneStaleTickerMapEntries` (`src/features/vector/lib/vector-compare.ts`) — the `Map`
analogue of the already-shipped `pruneStaleTickerEntries` (same same-reference-when-unchanged
contract) — plus 4 new tests in `vector-compare.test.ts`. RED→GREEN proof via `git stash` of the
two production files (keeping the new tests):

- **Before the fix**: the 4 new tests fail —
  `TypeError: pruneStaleTickerMapEntries is not a function` (19/23 pre-existing tests in the same
  file pass unaffected).
- **After the fix**: 23/23 tests pass.

`npx tsc --noEmit` clean. `eslint` on all 3 touched files: 0 errors, 0 warnings. Also re-ran the
3 other test files that reference `VectorCompareDesk.tsx` by source-scan
(`ios-compact-controls.test.ts`, `vector-chart-viewport.test.ts`, `vector-tier-fixes.test.ts`,
75 tests total) — all pass unaffected.

## Blast radius

`pruneStaleTickerMapEntries` is new and used only by `VectorCompareDesk.tsx`'s `timelinesRef`
(`handleReplayTimeline` and the new proactive `useEffect`). No other file reads `timelinesRef` or
imports the new export.

## Fix rationale

Mirrored the exact pattern already shipped for `metaByTicker`/`playByTicker` in the same file: a
`useEffect` keyed on `[seeds]` that prunes the moment the active ticker set changes, rather than
waiting on an unrelated pane's next tick. `handleReplayTimeline`'s own inline prune loop was
refactored to call the same shared helper instead of duplicating the logic, so the two call sites
(the per-tick path and the new proactive path) can't drift apart the same way `metaByTicker` and
`playByTicker` once did before `pruneStaleTickerEntries` was extracted to share between them.

Deliberately left unchanged: `handleReplayTimeline`'s own set-then-prune ordering (still sets the
calling ticker's fresh timeline before pruning, so a pane that is itself mid-removal in the same
tick never has its own just-reported timeline dropped), and `mergeReplayTimelines` itself (owned by
`vector-compare-replay.ts`, out of scope for this round's exclusion list — not touched, only
called with the already-correct pruned values).
