# 2026-11-09: Admin API Command Center's `load()` depended on its own fetched state, turning the intended 8s/120s poll cadence into a continuous live-provider-probe loop

> **kind:** `FINDING`

**Status.** FIXED — this PR.

## Summary

`AdminApiDashboard.tsx` (`/admin` → API Command Center tab) runs its own manual fetch+interval
polling loop — unlike its sibling admin dashboards, which were already migrated onto SWR. Its
`load()` callback read component state (`data`) directly to decide whether to show the full-page
loading spinner (`else if (!data) setLoading(true)`), and listed `data` in its own `useCallback`
dependency array. `setData` runs on EVERY successful poll (the 8s telemetry tick and the 120s
"probe" tick alike) and always hands back a freshly `JSON.parse`d object, so `data`'s reference
changes on **every single successful load**, not just the first one — which meant `load` itself
got a brand-new function identity after every load, not just on first mount.

The effect that wires up the actual polling intervals depends on `[load]`:

```ts
useEffect(() => {
  load(true);
  const telemetryId = setInterval(() => load(false), 8_000);
  const probeId = setInterval(() => load(true), 120_000);
  return () => { clearInterval(telemetryId); clearInterval(probeId); };
}, [load]);
```

Because `load`'s identity changed on every successful poll, this effect's cleanup/re-run fired on
every successful poll too — tearing down both intervals and immediately calling `load(true)`
**synchronously, again**, inside the effect body. `load(true)` is the EXPENSIVE path: it sends
`?probe=1`, which (`src/lib/admin-api-dashboard.ts`) makes real round-trip connectivity checks
against Polygon, Unusual Whales, the BLACKOUT engine, and Postgres, and (`.../apis/dashboard/
route.ts`) writes an `api_probe_providers` row to the admin audit log on every call. Instead of the
intended "cheap 8s telemetry poll, expensive 120s live-provider probe" cadence, the probe fired on
effectively **every** successful poll — a self-sustaining loop bounded only by round-trip latency,
not by the 120-second schedule the code and its own comments describe.

## Root cause

A classic unstable-`useCallback`-dependency trap: `load`'s only use of `data` was a one-bit
"has anything ever loaded yet" check, but including the full `data` object in its dependency array
tied `load`'s identity to a value that mutates on every call `load` itself makes — a feedback
loop. Every sibling admin dashboard in this file avoids the shape: `AdminCronDashboard`'s `load`
depends on SWR's stable `refresh` (never on the data it fetched); `AdminOperationsDashboard`,
`AdminXMarketingPanel`, `AdminNightHawkDashboard`, `AdminXIntelQueuePanel`'s `load`s take no
dependency on their own fetched state either. `AdminApiDashboard.tsx` — the one file in this admin
surface still running a hand-rolled fetch+interval loop instead of SWR — was the one outlier.

This was not caught earlier because the existing hardening on this file
(`admin-api-dashboard-request-guard.ts`, #6926/#6927-shaped) targets a different, real but
*separate* bug — out-of-order responses from overlapping `load()` calls clobbering fresher state —
and says nothing about `load()`'s own referential identity.

## Blast radius

Checked every other `useCallback`/`useMemo` with a `[data]`-shaped dependency in the admin
surface and beyond (`AdminCronDashboard.tsx`, `ContractDrilldownDrawer.tsx`,
`GexHeatmap.tsx`) — all of those are plain derivations (`useMemo` computing a chart/stat from
`data`) or depend on a stable SWR `mutate` handle, never a `useCallback` whose own result feeds an
effect that re-arms `setInterval`s off `[load]`. `AdminApiDashboard.tsx`'s `load()` was the only
instance of this specific shape (unstable poll-driver identity → effect restart → forced re-fire)
found in the codebase.

## Fix

Added `hasDataRef` (a `useRef<boolean>`) that is set to `true` the moment any load ever succeeds,
and changed `load()` to read `hasDataRef.current` instead of `data` state for the first-load
spinner decision. `load`'s dependency array is now `[]` — it is referentially stable for the life
of the component, so the polling-setup effect below only (re)runs on mount, exactly as its own
comments already claimed it would.

## Evidence

RED→GREEN via `git stash`/`pop` on `src/components/admin/AdminApiDashboard.tsx` against a new
regression test, `src/components/admin/AdminApiDashboard.test.ts`:

- **RED** (pre-fix source stashed back in): both assertions fail — `load`'s captured deps array
  is `["data"]`, and its body reads `data` state directly.
- **GREEN** (fix restored): both assertions pass — `load`'s deps array is `[]`, and its body
  reads `hasDataRef.current`.

This is a source-level regression test rather than a rendered-behavior one because this repo
carries no DOM/React-renderer test infrastructure (no jsdom, no `@testing-library/react`, no
`react-test-renderer` — checked `package.json`/`node_modules` before writing it); the repo's own
established fallback for a hook-wiring invariant that can't be driven through a real render is a
direct assertion against the component source (e.g. `AccountMembershipPanel.test.tsx`'s
`assert.doesNotMatch(html, /href="\/upgrade"/)` source/output check, and `largo-tool-labels.test.ts`'s
completeness check against the live source) — the same approach is used here.

`npx tsc --noEmit` clean on Node 20 after the fix.

## Files

- `src/components/admin/AdminApiDashboard.tsx` — the fix.
- `src/components/admin/AdminApiDashboard.test.ts` — new regression test (RED→GREEN proven via
  `git stash`/`pop`).
