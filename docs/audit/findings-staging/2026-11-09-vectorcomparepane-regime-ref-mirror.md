# 2026-11-09: VectorChart's `onRegimeChange` had the same stale-closure gap already fixed for `onFreshness`/`onSpotChange`, reachable via VectorComparePane's own churning callback

> **kind:** `FINDING`

**Status.** FIXED — this PR.

## Summary

`VectorChart.tsx`'s live SSE tick handler (`connectLive`, invoked only from a mount-only `[]`-dep
effect) called `onRegimeChange` directly from its closure inside `emitRegime`, instead of through
a ref mirror like every sibling callback that same long-lived handler reads. This is the identical
bug class two prior PRs (#7814, #7815) fixed for `onFreshness`/`onSpotChange`/`onProximityChange`/
`onMagnetChange`/`onConfluenceChange`/`onWallIntegrityChange` — `onRegimeChange` escaped both
passes because its one real churning call site sits one hop away from `VectorChart` itself, inside
`VectorComparePane.tsx` (round 507's own flagged priority lead for this round: "a callback prop
whose OWN identity churns due to its own internal state, passed down to and called from a
long-lived handler elsewhere that was never designed to re-subscribe").

## Root cause

`VectorComparePane.handleRegime` is `useCallback((r) => { setRegime(r); pushMeta(r, spot); },
[pushMeta, spot])` — it closes over the pane's own `spot` state, which updates on every live tick
(via the already-fixed `onSpotChange` path), so `handleRegime` gets a brand-new identity on every
tick. `VectorPageShell.handleRegime` wraps it 1:1 (`[onCompareRegimeChange]`), so it churns too,
and it is wired into `VectorChart` as `onRegimeChange={handleRegime}` **unconditionally** — unlike
`onFreshness`/`onSpotChange`, which are gated `liveSession ? cb : undefined` at the same call site.

Inside `VectorChart.tsx`, `emitRegime` read `onRegimeChange` directly from its closure and listed
it in its own `useCallback` deps, and `connectLive` listed `emitRegime` in ITS deps — but
`connectLive` is only ever invoked from the mount effect, the replay-exit path, and the SSE
error-retry path; nothing watches `connectLive`'s own identity to re-invoke it. So the live tick
handler kept calling the FIRST `emitRegime` captured at mount, forever, which closed over the FIRST
`VectorPageShell.handleRegime` forever, which closed over the FIRST `VectorComparePane.handleRegime`
forever, which closed over `spot` **as it was at mount** (the seed's initial close price) forever.

Every live regime-change event (a gamma-posture flip) therefore called
`pushMeta(freshRegime, staleMountTimeSpot)`, writing the frozen mount-time spot into
`VectorCompareDesk`'s `metaByTicker[ticker].spot` on every single regime flip for the lifetime of
the mount — never the live spot a fresh render would have supplied. (The regime value itself was
unaffected — `setRegime(r)`/`setRegime` are stable `useState` setters called with the fresh `r`
argument, so the posture chip in the compare footer reads correctly; only the paired `spot` field
on the same meta object was wrong.)

## Evidence (RED → GREEN)

New test: `src/features/vector/components/VectorChart-onregimechange-ref-mirror.test.ts`.

RED (pre-fix, via `git stash` isolating only the source change): 4/4 new tests failed —
`onRegimeChangeRef` didn't exist, the ref-sync effect didn't mirror it, `emitRegime` called the
bare `onRegimeChange(regime)` directly, and `onRegimeChange` was still listed in `emitRegime`'s own
dependency array.

GREEN (post-fix): 4/4 new tests pass; all 19 tests across every `VectorChart-*.test.ts` sibling
file pass together (including the round-506 `onfreshness-onspotchange-ref-mirror` test, updated to
allow the new `onRegimeChangeRef` line sharing its existing bare-`useEffect` block); `npx tsc
--noEmit` clean.

## Fix

Added `onRegimeChangeRef = useRef(onRegimeChange)`, synced inside the SAME bare (no-deps)
`useEffect` that already re-syncs `onFreshnessRef`/`onSpotChangeRef` on every render — the
established pattern for every other long-lived-handler callback in this file. `emitRegime` now
reads `onRegimeChangeRef.current` into a local and calls that, and no longer lists `onRegimeChange`
in its own `useCallback` dependency array (consistent with how `emitPlay` omits `onPlayChangeRef`'s
underlying prop from its own deps).

## Fix rationale / what was deliberately left unchanged

- Followed the exact precedent (`onFreshnessRef`/`onSpotChangeRef`, PR #7814) rather than inventing
  a new pattern — same bare-`useEffect` sync block, same `const cb = ref.current; if (!cb) return;`
  read shape used by `emitPlay`/`onExpectedMoveChangeRef`/`onTechnicalsChangeRef`.
- Did **not** touch `onProximityChange`/`onMagnetChange`/`onConfluenceChange`/`onWallIntegrityChange`
  inside `VectorChart.tsx` — all four are wired to plain `useState` setters at both real call sites
  (`VectorPageShell.tsx` lines 883/769 area), which are referentially stable, so they never churn in
  practice; adding refs for them would be defensive churn with no reachable bug behind it.
  `onRegimeChange` was the one case with a genuinely churning real-world caller.
  Confirmed via `grep -rn "onRegimeChange=" src/features/vector/components/*.tsx` — exactly two call
  sites, one stable (`setRegime`, the standalone `/vector` page), one churning (`handleRegime`, the
  `chartOnly` embed used by Compare mode).
- Did **not** change `VectorComparePane.handleRegime`/`handleSpot` themselves (their mutual
  `[pushMeta, spot]`/`[pushMeta, regime]` dependency shape is intentional — each needs the CURRENT
  sibling state at call time) — the bug was specifically that the long-lived SSE handler never saw
  a FRESH instance of either closure after mount, which the ref mirror now guarantees regardless of
  how often the upstream callback's identity churns.

## Blast radius

One file (`VectorChart.tsx`), one callback (`onRegimeChange`). The only consumer-visible symptom
reachable today is a stale `spot` field written into `VectorCompareDesk`'s `metaByTicker` state on
every regime flip in Compare mode — not currently rendered by any UI (the compare footer only reads
`.regime.posture`, confirmed via `grep -rn "VectorComparePaneMeta" src/`), so this closes a latent
correctness gap in exported state ahead of any future consumer, the same "fix it before something
reads the wrong value" discipline the round-506/507 PRs in this same file applied.
