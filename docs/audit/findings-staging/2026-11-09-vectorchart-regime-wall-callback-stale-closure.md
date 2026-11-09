> **kind:** FINDING

## VectorChart's live SSE tick handler read five regime/wall callbacks directly from closures instead of through ref mirrors, same shape as the already-fixed `onFreshness`/`onSpotChange` gap — FIXED

| | |
|---|---|
| **Area** | Vector desk — `src/features/vector/components/VectorChart.tsx` (live SSE tick handler inside `connectLive`) |
| **Severity** | P3 — correctness/data-integrity: a consumer that later reads the affected field would see it silently frozen at chart-mount time while a sibling field in the same object kept updating live |
| **Status** | FIXED |

### Root cause

`VectorChart`'s live spot/wall stream is a single, long-lived `EventSource` created once inside
`connectLive` (a `useCallback`) and invoked only from the chart's mount effect (`[]` deps),
`exitReplay`, and the SSE error-retry path. Nothing in the file watches `connectLive`'s own
identity to tear down and recreate the connection, so once the `onmessage` handler is built it
keeps running unchanged for the life of the connection, regardless of how many times the
surrounding component re-renders — exactly the mechanism documented and fixed for `onFreshness`/
`onSpotChange` in the immediately-preceding finding (`2026-11-09-vector-chart-onfreshness-
onspotchange-stale-closure.md`).

That fix closed two of the direct-prop-read call sites inside the handler. It did not close the
remaining five, which the handler reaches one hop further down, through five `useCallback`
"emit" helpers it calls on every live tick:

```ts
emitRegime();
emitProximity();
emitMagnet();
emitConfluence();
paintConfluenceBand();
emitWallIntegrity();
emitPlay();
```

Each of `emitRegime`/`emitProximity`/`emitMagnet`/`emitConfluence`/`emitWallIntegrity` closed
directly over its own prop (`onRegimeChange`/`onProximityChange`/`onMagnetChange`/
`onConfluenceChange`/`onWallIntegrityChange` respectively) and listed it in its own `useCallback`
dependency array — which reads as "stays fresh" but, per the same mechanism, never actually
refreshes the already-running handler's closure, because nothing re-invokes `connectLive` merely
because one of these emit* functions' identity changed. (`emitPlay`, the sixth sibling called from
the same spot, already avoided this — it reads `onPlayChangeRef.current` rather than the raw
`onPlayChange` prop, which is what the fix below now matches for the other five.)

### Evidence this is reachable in production, not just theoretical

`VectorComparePane.tsx` (Compare mode, 2+ panes side by side) defines:

```ts
const handleRegime = useCallback(
  (r: VectorRegime) => {
    setRegime(r);
    pushMeta(r, spot);
  },
  [pushMeta, spot]
);
```

`spot` is React state that updates on every live tick (via the sibling `handleSpot`), so
`handleRegime`'s identity churns constantly during a live Compare session. This flows
`VectorComparePane.handleRegime` → `VectorPageShell.handleRegime` (`[onCompareRegimeChange]`) →
`VectorChart`'s `onRegimeChange` prop → `emitRegime`. Before this fix, the long-lived tick
handler's frozen `emitRegime` closure kept calling the mount-time-frozen `onRegimeChange` forever —
which in turn called `pushMeta(regime, spot)` with `spot` frozen to whatever it was when the chart
first mounted (not the live current spot), while `regime` (passed as a plain function argument at
call time, never closed over) kept updating correctly. The result: `VectorComparePaneMeta` objects
whose `regime` and `spot` fields silently describe two different instants, even though the object
is meant to be a single coherent snapshot.

The currently-displayed symptom is subtle to the point of invisible today: `VectorCompareDesk.tsx`'s
compare-summary footer only reads `meta.regime.posture` (the long-γ/short-γ chip) — `meta.spot` is
computed and stored but not currently rendered anywhere, so there is no live visual regression to
point at. The bug is real and now fixed regardless — a future consumer of `meta.spot` would
otherwise silently get wrong data with no error, no warning, and no straightforward way to notice
without specifically comparing it against the live tape.

### Fix

Added `onRegimeChangeRef`/`onProximityChangeRef`/`onMagnetChangeRef`/`onConfluenceChangeRef`/
`onWallIntegrityChangeRef`, synced every render via one dependency-less `useEffect` (identical
pattern to every other long-lived-handler ref mirror already in the file — `onPriceScaleRenderRef`,
`onTechnicalsChangeRef`, `onExpectedMoveChangeRef`, `onPlayChangeRef`, `onAlertsFiredRef`, and now
`onFreshnessRef`/`onSpotChangeRef`). Each of the five emit* functions now reads `.current` instead
of the raw prop, and the raw prop was dropped from each emit* function's own dependency array (it
is no longer referenced directly in the body) — matching `emitPlay`'s existing, already-correct
`onPlayChangeRef` pattern exactly.

### Blast radius

Single file, single long-lived handler. `createVectorEventSource` (the SSE helper this handler is
built around) has exactly one call site in the repo (`VectorChart.tsx` itself — confirmed via
repo-wide grep; the other matches are the helper's own definition in `src/lib/api.ts`, its route
handler, and its own unit test) — no duplicate copy of this tick-handler shape exists elsewhere to
carry the same gap. The other emit* sibling called from the same spot (`emitPlay`, and the two
`onFreshness`/`onSpotChange` call sites from the preceding finding) were already correct or already
fixed; `paintConfluenceBand`/`gatherConfluenceLevels` (also called from the same handler) take no
prop callback directly, so they were never exposed to this gap.

### Evidence

Confirmed RED→GREEN (`git stash` the component change, keep the new test) in
`VectorChart-emit-callback-ref-mirror.test.ts`:

- **Before the fix**: all 3 assertions fail — the five ref mirrors don't exist and each emit*
  function still closes over its raw prop directly, listed in its own dependency array.
- **After the fix**: 3/3 pass. `npx tsc --noEmit` clean. Full
  `src/features/vector/components/*.test.ts` suite run alongside it: 102/102 pass, no regressions.
