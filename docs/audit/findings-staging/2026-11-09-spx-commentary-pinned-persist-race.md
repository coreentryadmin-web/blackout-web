# 2026-11-09: SpxCommentaryRail could persist a STALE pinned bias to sessionStorage if the play-lifecycle effect fired in the same React commit as the brain-tick effect's bias update

> **kind:** `FINDING`

**Status.** FIXED — this PR.

## Summary

`SpxCommentaryRail.tsx` (the Largo live-commentary rail on the SPX desk) runs two independent
`useEffect`s that both call the shared `persist()` helper to write the pinned bias card +
event feed to sessionStorage: the "brain tick" effect (`[desk, live]` deps — recomputes the
pinned bias on every ~2s desk poll) and the "play lifecycle" effect (`[play, live]` deps — one
line per armed/fired/closed transition). The play-lifecycle effect persisted the closure-captured
`pinned` **state** variable, not a ref — the exact stale-closure shape the file's own `shiftsRef`
mirror (declared immediately above, with the comment "Mirror of `shifts` so persist() calls from
other effects never write a stale closure") exists to prevent, but that discipline was never
extended to `pinned` itself.

## Root cause

Both effect bodies are fresh closures created on every render, but React only *invokes* a given
effect's closure when its own dependency array changed since the last run, and does not
retroactively rewrite an already-created closure when a sibling effect calls `setState` moments
earlier in the same commit. Effects run in declaration order within one flush, so the sequence
that reaches the bug is:

1. `desk` ticks (brain-tick effect's deps change) and, in the same React commit, `play` also
   updates (play-lifecycle effect's deps change — plausible since `play` comes from its own SWR
   revalidation, independent of the desk poll, with nothing preventing the two landing together).
2. The brain-tick effect runs first (declared first) and the bias has genuinely changed: it calls
   `setPinned(nextPinned)` to pin the fresh bias, then calls `persist(nextPinned, ...)` — this
   particular call was already correct, since `nextPinned` is a local variable computed fresh in
   that same effect run, not the stale closure.
3. The play-lifecycle effect runs next, in the **same** commit. `setPinned`'s update from step 2
   has not yet flushed into a new render, so this effect's own closure still has the `pinned`
   variable exactly as it was at the start of this render — the **pre-update** value. It calls
   `persist(pinned, next)` with that stale bias, overwriting the correct write step 2 just made in
   sessionStorage with the old one.

Narrow (requires both effects' deps to change in the very same commit) and self-correcting (the
next ~2s desk poll re-pins and re-persists correctly), but a real, reachable staleness in a
session-persisted UI surface — what the time bar's event dots render and what a same-tab reload
restores — not hypothetical. Pure UI/display persistence; no trading decision, gate, or dispatch
logic is involved.

## Evidence (RED → GREEN)

New regression test `SpxCommentaryRail-pinned-persist-race.test.ts` — this component has no
`server-only` import but the repo carries no DOM/React-renderer test infra (no jsdom, no
`@testing-library/react` — same situation `AdminApiDashboard.test.ts` documents), so it asserts on
the component source directly: (1) `pinnedRef` exists, (2) every `setPinned(...)` call site is
paired with a preceding `pinnedRef.current` update to the same value, (3) the play-lifecycle
effect's `persist()` call reads `pinnedRef.current`, never the bare `pinned` state, and (4) the
brain-tick effect's `persist()` fallback also reads `pinnedRef.current`, not `pinned`.

RED (pre-fix, via `git stash` isolating only the source change): 4/4 new assertions fail against
the pre-fix source.

GREEN (post-fix): 4/4 pass; sibling `spx-commentary.test.ts` (10/10) unaffected; `npx tsc --noEmit`
(Node 20) clean.

## Fix

Added `pinnedRef`, a ref mirror of the `pinned` state updated synchronously everywhere
`setPinned` is called (hydration seed + brain-tick effect), mirroring the exact pattern this same
file already uses for `shiftsRef`. Both `persist()` call sites now read `pinnedRef.current`
instead of the closure-captured `pinned` state variable. No behavior change to what is
*rendered* (the component still reads `pinned` state for display, which is always eventually
correct); only the sessionStorage write path is affected.

## Blast radius

Grepped the repo for the same "closure state read inside a sibling-deps effect's `persist`/cache
write" shape in other SPX/Largo rail components (`SpxPulseRail.tsx`, `SpxTradeAlerts`-adjacent
hooks). `SpxPulseRail.tsx` was already checked and confirmed correct in an earlier round (its own
ref-mirror usage for `prevSnapRef`/`seenRef`/`wallTrackerRef`/etc. is consistent); no second
instance of this exact bug found elsewhere this round.
