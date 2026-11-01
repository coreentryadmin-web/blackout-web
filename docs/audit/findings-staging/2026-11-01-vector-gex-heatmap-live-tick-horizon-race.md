> **kind:** FINDING

## Vector GEX heatmap: live-tick force-refetch had no DTE-horizon staleness guard — FIXED

**Status:** FIXED (`fix/vector-gex-heatmap-live-tick-horizon-race`)

### Root cause
`VectorChart.tsx` fetches `/api/market/vector/gex-heatmap` from two call sites:

1. `fetchGexHeatmap` (poll interval, ~line 3962) — correctly checks
   `cancelled || dteHorizonRef.current !== dteHorizon` **twice**: once right after the fetch
   resolves, and again after the JSON body is parsed, before ever writing to
   `gexHeatmapGridRef.current` or repainting `gexHeatmapPrimitiveRef`.
2. A duplicate, on-demand fetch inside `connectLive`'s live SSE tick handler (~line 4398),
   fired whenever the underlying moves fast enough mid-session (`VECTOR_GEX_HEATMAP_FAST_MOVE_PCT`).
   This call had **no staleness check at all** — it built the URL from
   `dteHorizonRef.current` at request time, but never re-verified that value on response, and
   unconditionally wrote `gexHeatmapGridRef.current = grid` and repainted the primitive.

Because `VectorChart` is remounted on ticker change (`key={activeTicker}` at every render site —
confirmed by earlier rounds' audit), a ticker-switch race is not reachable in production. A
**DTE-horizon switch does not remount** the component (same instance, same shared refs), so if a
member flips the DTE horizon selector while this fast-move-triggered fetch is still in flight, the
OLD horizon's response can land *after* the switch and silently overwrite the already-correct grid
the horizon-change effect just fetched — repainting the chart with the wrong horizon's GEX walls
until the next poll tick or another fast move happens to correct it.

### Evidence (RED → GREEN)
- RED: against `origin/main`'s `VectorChart.tsx`, the live-tick force-refetch block contains
  neither a `horizonAtFetch` snapshot nor any `dteHorizonRef.current !== horizonAtFetch` check
  (verified via a direct regex match against the unmodified source — 0 occurrences).
- Added `src/features/vector/components/VectorChart-gex-heatmap-live-tick-horizon-guard.test.ts`
  (source-regex regression guard, same pattern as the file's existing sibling `*-replay-guard.test.ts`
  files — there is no local render harness for this 5800-line component). Confirmed RED against the
  unfixed source, GREEN after the fix.
- Fix applied: snapshot `dteHorizonRef.current` into `horizonAtFetch` before firing the fetch, and
  bail both right after the fetch resolves and again after the JSON body is parsed if
  `dteHorizonRef.current !== horizonAtFetch` — mirroring `fetchGexHeatmap`'s own two-check pattern
  exactly.
- `npx tsc --noEmit`: clean.
- `npx tsx --experimental-test-module-mocks --test src/features/vector/components/VectorChart-*.test.ts`:
  10/10 pass (new test + all 9 pre-existing sibling guard tests in this file, confirming no
  collateral regression).

### Blast radius
Single call site — the duplicate fetch had no other consumers. `fetchGexHeatmap` (the poll-based
sibling) was already correct and untouched.

### Fix rationale
Mirrored the exact guard shape already proven correct a few hundred lines earlier in the same file
for the same API call, rather than inventing a new pattern. Did not add a ticker-staleness check at
this call site — that dimension is already covered by the component's remount-on-ticker-change
behavior (confirmed safe by earlier audit rounds), so adding it here would be redundant defense with
no reachable bug to guard against. Did not touch `fetchGexHeatmap`, the backfill fetch in
`connectLive` (the other "two ungated fetches" previously confirmed safe), or any other part of the
SSE tick handler.
