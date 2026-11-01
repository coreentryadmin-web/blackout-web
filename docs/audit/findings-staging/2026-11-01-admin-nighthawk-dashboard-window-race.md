> **kind:** FINDING

## Admin Night Hawk dashboard: switching the window-range tab could render a stale window's numbers — FIXED

| | |
|---|---|
| **Area** | `src/components/admin/AdminNightHawkDashboard.tsx` (admin Night Hawk analytics dashboard) |
| **Severity** | P3 (admin-only tool; visible-but-cosmetic data mismatch, no data corruption) |
| **Status** | Fixed |

### Root cause

`AdminNightHawkDashboard`'s `load()` fires from three independent, un-coordinated
triggers that can all be in flight at the same time:

1. A 30s auto-refresh poll (`setInterval(() => void load(false), 30_000)`).
2. Clicking a window-range tab (7d / 30d / 90d) — `load` is a `useCallback` keyed on
   `windowDays`, so changing the window gives `load` a new identity, which re-runs the
   mount effect (`useEffect(() => { void load(true); ... }, [load])`) and fires a brand
   new `load(true)` call.
3. "Run now" (`runNow()`), which calls `load(false)` again after kicking off the edition
   pipeline.

`load()` had no way to tell, once its three parallel fetches (`metricsRes`/`previewRes`/
`wsRes`) resolved, whether a *newer* `load()` call had already started (and possibly
already finished) in the meantime. It called `setData(...)` / `setPreview(...)` /
`setWsStatus(...)` / `setError(...)` unconditionally on every resolution.

Concretely: an admin on the "7d" tab clicks "30d". The "7d" `load()` call may already be
in flight. The new "30d" `load()` call starts a second, independent `load()`. If the "7d"
fetch (now representing a window the UI no longer shows as selected) resolves *after* the
"30d" fetch — plausible under ordinary network jitter, and certain if the 30s poll's own
in-flight call happens to be for the window the admin just switched away from — its
response lands last and overwrites the screen: `data.window_days` reverts to `7` while the
"30d" tab still renders highlighted, and every ring/table on the page (win rate, avg
return, funnel, conviction/score/sector/edition breakdowns) silently shows the *previous*
window's numbers under the *new* window's label. Nothing errors; the mismatch is only
visible by noticing the header disagrees with the selected tab.

This is the same bug shape already fixed at three other admin surfaces in this codebase —
`AdminApiEventDetail.tsx` (#6926), `UserManagement.tsx`'s search box
(`user-management-request-guard.ts`), and `AdminApiDashboard.tsx`
(`admin-api-dashboard-request-guard.ts`) — none of which this component reused, because
each is a separately-triggered race keyed on a different identity (selected event id,
search term, "which `load()` call fired most recently").

### Evidence

Reproduced the exact race outside the component with a minimal harness modeling the old,
unguarded `load()` (`naiveLoad` applying `setData`-equivalent unconditionally on
resolution): two overlapping calls, the older ("7d") one resolving *after* the newer
("30d") one — the older response clobbers the newer one every time
(`applied: ['30d metrics', '7d metrics']`, i.e. "7d" wins the race despite being stale).

The new regression test (`admin-nighthawk-dashboard-request-guard.test.ts`) pins the fix:
`runGuardedNighthawkLoad` drops the superseded "7d" response and keeps the "30d" one
applied, while still applying whichever request is genuinely the *latest* regardless of
resolution order (covered by a second and third test case, mirroring the sibling guard
files' test shape).

`tsc --noEmit` clean; `npx tsx --experimental-test-module-mocks --test
src/components/admin/admin-nighthawk-dashboard-request-guard.test.ts
src/components/admin/UserManagement.test.ts` — 9/9 pass.

### Blast radius

Single call site: `AdminNightHawkDashboard.tsx`'s own `load()`. No other component reads
`admin-nighthawk-dashboard-request-guard.ts`. `runNow()` calls `load(false)` through the
same guarded path, so it inherits the fix automatically — no separate change needed there.

### Fix rationale

Added a `loadGenerationRef` counter (bumped once per `load()` call, same pattern as
`FlowFeed.tsx`'s `loadGenerationRef`/`applyIfGenerationUnchanged` and the three sibling
admin dashboards' own per-component guard files) and a new pure, dependency-free helper
`runGuardedNighthawkLoad` (mirroring `runGuardedDashboardLoad` /
`runGuardedUsersFetch`'s exact shape) that only applies a response if no newer `load()`
call has started since it was issued. `setError`/`setLoading(false)` in the `catch`/
`finally` blocks are guarded the same way, so a superseded request's failure (or its
`finally`) can no longer clear the loading spinner or paint an error over a newer, already-
successful render. Deliberately kept as a new per-component file rather than generalizing
the three near-identical existing guard files into one shared helper — that refactor is
independent of this fix and risks touching call sites outside this round's scope.
