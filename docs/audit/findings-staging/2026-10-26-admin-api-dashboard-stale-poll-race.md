> **kind:** `FINDING`

## AdminApiDashboard could revert the screen to stale data right after "Rescan codebase"/"Probe providers" — a stale-out-of-order-fetch race — FIXED

| | |
|---|---|
| **Severity** | P3 (admin-only tooling, never member-facing; a manual refresh action's result can be visibly overwritten moments later by an in-flight periodic poll, misleading the admin about whether the rescan/probe actually ran) |
| **Surface** | `src/components/admin/AdminApiDashboard.tsx` — `load()`, called from four independent sources |
| **Status** | FIXED |

### Root cause

`load(withProbe)` is the single fetch-and-apply path for the API Command Center's dashboard
payload, and it is invoked from FOUR independent, overlapping triggers:

1. An 8s telemetry poll: `setInterval(() => load(false), 8_000)`
2. A 120s probe poll: `setInterval(() => load(true), 120_000)`
3. The manual "Probe providers" button: `onClick={() => load(true)}`
4. "Rescan codebase": `rescan()` POSTs `/api/admin/apis/rescan` then calls `load(false)` itself

Before the fix, `load` applied whatever `fetch` resolved most recently with no check on which
call started last:

```tsx
// before fix
const load = useCallback(async (withProbe = false) => {
  if (withProbe) setProbing(true);
  else if (!data) setLoading(true);
  setError(null);
  try {
    const qs = withProbe ? "?probe=1" : "";
    const res = await fetch(`/api/admin/apis/dashboard${qs}`, { cache: "no-store" });
    if (!res.ok) throw new Error(...);
    setData(await res.json());   // <-- applied unconditionally, regardless of whether a
                                  //     NEWER load() call has since superseded this one
  } catch (e) { ... } finally { setLoading(false); setProbing(false); }
}, [data]);
```

Concretely: an 8s poll's `load(false)` can already be in flight when the admin clicks "Rescan
codebase". `rescan()` POSTs the rescan, then calls its own `load(false)`. If the POST + its own
`load()` happen to resolve faster than the poll's call that was already running (normal network
jitter, or the poll's request simply landing a beat before the rescan's), the OLDER poll response
— carrying pre-rescan data — lands AFTER the rescan's fresher payload and silently overwrites it.
The admin who just clicked "Rescan codebase" sees the screen revert to the stale pre-rescan
counts/registry rows a moment later, with nothing indicating that happened — indistinguishable from
"the rescan didn't actually do anything," which is exactly the kind of false signal this admin
surface exists to prevent.

This is the identical bug shape already fixed twice in the same admin surface this round:
`AdminApiEventDetail.tsx` (#6926, selected-event-id key) and `UserManagement.tsx` (#6927, free-text
search key) — a component applies whichever `fetch` response resolves last with no "is this still
the latest request" guard. This instance is keyed by "which of four trigger sources fired `load()`
most recently" rather than a changing search/filter value, and was explicitly flagged as "noted but
not fixed" in #6927's own write-up as a narrower, separate concern worth a closer look.

### Evidence (RED → GREEN)

New file `src/components/admin/admin-api-dashboard-request-guard.ts` exports
`runGuardedDashboardLoad(requestId, getLatestRequestId, doFetch, applyResult)`, a framework-free
async helper that only calls `applyResult` once `doFetch()` resolves AND `requestId` is still the
latest value `getLatestRequestId()` reports — i.e. no newer `load()` call has started since this
one was issued.

New test file `src/components/admin/admin-api-dashboard-request-guard.test.ts` (3 tests) reproduces
the exact race with deferred promises:
- A poll's `load()` call starts first but is slow; a manual rescan/probe `load()` call starts
  second and resolves FIRST; the poll's response then arrives AFTER the rescan's — only
  `"post-rescan dashboard payload"` is ever applied (`assert.deepEqual(applied, [...])`).
- A lone, un-superseded call is still applied normally (no change in the common case).
- A response that resolves LAST but is still the latest call (nothing superseded it) is still
  applied — the guard drops only genuinely SUPERSEDED calls, not merely "didn't resolve first."

RED→GREEN proved directly (temporarily replaced the guard body with the naive "always apply"
version, confirmed 2 of 3 tests fail with the stale `"stale payload"`/`"stale pre-rescan dashboard
payload"` leaking into the applied list, restored the real guard, confirmed `tests 3 / pass 3 / fail
0`).

`npx tsc --noEmit` clean; `npx eslint src/components/admin/AdminApiDashboard.tsx
src/components/admin/admin-api-dashboard-request-guard.ts
src/components/admin/admin-api-dashboard-request-guard.test.ts` — 0 errors. Pre-existing sibling
test `admin-api-dashboard-probe-filter.test.ts` still passes alongside the new one.

### Blast radius

Only `load()`'s own `fetch`/`setData` path shared this race — `rescan()`'s own `fetch` (the POST
itself) is a one-shot action gated by `rescanning`, not re-fired on a changing key, and it already
delegates its post-rescan refresh through the now-guarded `load(false)`, so no second fix site was
needed there. `useAdminHealth(8_000)` (a separate SWR hook, keyed by URL) was left untouched — SWR
already dedupes/sequences by key and doesn't share this component's bespoke `useState`-based
fetch-and-apply path.

### Fix rationale

Extracted the ordering check into a small, pure, DOM/React-free function
(`runGuardedDashboardLoad`) rather than inlining an `if` after the `await` in `load` directly,
matching the exact pattern `AdminApiEventDetail.tsx` (#6926) and
`user-management-request-guard.ts` (#6927) establish for this bug class in this same admin
surface — this repo's "use client" components are tested via source-text assertions only (no React
Testing Library/jsdom in `package.json`), so the async-ordering logic needs to live somewhere
testable with real deferred promises, outside the component. `load` now bumps a `useRef`-held
counter (`loadRequestIdRef`) before each call and passes a closure reading that same ref as
`getLatestRequestId`; both the `catch` block's `setError` and the `finally` block's
`setLoading(false)`/`setProbing(false)` are likewise gated on `loadRequestIdRef.current ===
requestId` so a superseded call's own failure or settle-handling can't clobber state that a newer,
already-applied call already set.
