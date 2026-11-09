> **kind:** FINDING

## VectorChart's live SSE tick handler read `onFreshness`/`onSpotChange` directly from its closure instead of through a ref mirror, unlike every sibling callback it reads — FIXED

| | |
|---|---|
| **Area** | Vector desk — `src/features/vector/components/VectorChart.tsx` (live SSE tick handler inside `connectLive`) |
| **Severity** | P3 — correctness/display regression: a chart whose caller intends to stop pushing "live" spot/freshness updates (via `liveSession` flipping false) can keep doing so until a ticker switch or replay toggle forces a reconnect |
| **Status** | FIXED |

### Root cause

`VectorChart`'s live spot/freshness stream is a single, long-lived `EventSource` created once
inside `connectLive` (a `useCallback`) and invoked only from the chart's mount effect (`[]`
deps), `exitReplay`, and the SSE error-retry path. Nothing in the file watches `connectLive`'s own
identity to tear down and recreate the connection — so once the `onmessage` handler is built, it
keeps running, unchanged, for the life of the connection regardless of how many times the
surrounding component re-renders.

Seven callbacks read inside that same long-lived handler already account for this and are
mirrored through a ref, each with its own comment explaining why, e.g.:

```ts
// Alerts: the member's rules + the engine's per-rule state + the prior spot (for flip-cross), all
// in refs so the []-dep tick handler reads the latest without re-subscribing the SSE stream.
const onAlertsFiredRef = useRef(onAlertsFired);
```

(`onPlayChangeRef`, `onTechnicalsChangeRef`, `onExpectedMoveChangeRef`, `onPriceScaleRenderRef`,
`onCompareCrosshairRef`, `onCompareVisibleRangeRef` all carry the identical pattern/comment
shape.) `onFreshness` and `onSpotChange` were the two callbacks read from the SAME handler that
escaped this treatment — called directly as `onFreshness?.(snap.t)` / `onSpotChange?.(curSpot)`,
closing over whatever value those props held at the moment the connection was established.

This is reachable, not just stylistic, because both call sites (`VectorPageShell.tsx`) pass a
VALUE that flips based on `liveSession`, not merely a re-created function with equivalent
behavior:

```tsx
onFreshness={liveSession ? setStreamUpdatedAt : undefined}
onSpotChange={liveSession ? handleSpot : undefined}       // (or setLiveSpot, second usage site)
```

`VectorChart` is mounted with `key={activeTicker}` at its call sites, so it only remounts on a
ticker switch — `liveSession` can flip from `true` to `false` (or back) mid-mount with no
remount and no reconnect. Before this fix, if the SSE connection was established while
`liveSession` was `true`, the running handler kept calling the STALE pre-flip
`onFreshness`/`onSpotChange` — continuing to push "live" updates into the parent
(`setStreamUpdatedAt`/`handleSpot`/`setLiveSpot`, which `VectorOdteMatrixRail` treats as its
primary live-spot source) even after the parent's intent (via the now-`undefined` prop value)
was to stop, until the member switched tickers or toggled replay mode.

`onFreshness` was also listed in `connectLive`'s own `useCallback` dependency array, which reads
as "this stays fresh" but is inert: since nothing re-invokes `connectLive` merely because its
identity changed, that listing never actually refreshed the already-running handler's closure —
a textbook case of a dependency array providing a false sense of correctness for a value that is
only ever read from a `[]`-rooted long-lived callback.

### Evidence

Confirmed RED→GREEN (`git stash` the component change, keep the new test) in
`VectorChart-onfreshness-onspotchange-ref-mirror.test.ts` + the updated
`VectorChart-replay-spot-callback.test.ts`:

- **Before the fix**: all 6 assertions fail — the ref mirrors don't exist, the tick handler still
  calls the bare `onFreshness?.(snap.t)` / `onSpotChange?.(curSpot)`, and `connectLive`'s deps
  array still lists the raw `onFreshness` prop.
- **After the fix**: 6/6 pass. `npx tsc --noEmit` clean. Full `src/features/vector/components/*.test.ts`
  suite run alongside it: 104/104 pass, no regressions from the two call-site edits or the
  dependency-array trim.

### Blast radius

Single file, single long-lived handler: `createVectorEventSource` (the SSE helper this handler
is built around) has exactly one call site in the repo (`VectorChart.tsx` itself) — no duplicate
copy of this tick-handler shape exists elsewhere to carry the same gap. The fix only touches the
two call sites that read `onFreshness`/`onSpotChange` inside the handler and the ref
declarations/sync effect; every other callback already using this pattern (and every other line
of the handler) is untouched.

### Fix rationale

Mirror both callbacks through `onFreshnessRef`/`onSpotChangeRef`, synced every render via a bare
`useEffect(() => { ...; })` with no dependency array — the exact same shape the seven sibling
refs already use — and read `.current` at both call sites inside the tick handler instead of the
closed-over prop. Removed `onFreshness` from `connectLive`'s dependency array: it no longer needs
to be read there directly, and its presence was never functionally meaningful (nothing watches
`connectLive`'s identity to reconnect on it changing), so leaving it in the array after the fix
would be a stale, misleading remnant of the exact false-sense-of-freshness problem this finding
documents. Deliberately left unchanged: the SSE connection lifecycle itself (mount-once,
reconnect-on-ticker-remount/replay-exit/error-retry) — fixing the DEEPER question of whether
`connectLive` should also re-run when `liveSession` flips true after being false at mount is a
separate, larger architectural question out of scope for this minimal, evidence-driven fix.

### Regression tests added

`src/features/vector/components/VectorChart-onfreshness-onspotchange-ref-mirror.test.ts` (new):
- declares `onFreshnessRef`/`onSpotChangeRef` mirrors
- both refs are synced every render via a dependency-less `useEffect`
- the tick handler reads `onFreshnessRef.current`/`onSpotChangeRef.current`, never the bare props
- `connectLive`'s dependency array no longer lists the raw `onFreshness` prop

`src/features/vector/components/VectorChart-replay-spot-callback.test.ts` (updated): the existing
2026-08-27 replay-freeze regression guard now matches the ref-based call
(`onSpotChangeRef.current?.(curSpot)`) while still asserting it stays gated behind `!inReplay`
together with the heatmap spot marker.
