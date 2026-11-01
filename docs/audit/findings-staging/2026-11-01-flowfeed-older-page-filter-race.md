> **kind:** FINDING

## FlowFeed `loadOlderFlows` had no generation guard — a stale older-page fetch could splice the wrong filter's rows into the tape — FIXED

| | |
|---|---|
| **Area** | Helix — `src/features/helix/components/FlowFeed.tsx` |
| **Severity** | P3 (data-correctness glitch in a member-facing tape, not a crash/outage) |
| **Status** | FIXED (PR, this branch) |

### Root cause

`FlowFeed.tsx` loads data three ways: `loadFlows` (full reload on filter change), `refreshHead`
(periodic head refresh), and `loadOlderFlows` (pagination — fetch an older page and append it).
`loadFlows` and `refreshHead` both guard themselves with a shared `loadGenerationRef` counter:
each captures `++loadGenerationRef.current` before its fetch and bails if the ref moved on by the
time the fetch resolves. **`loadOlderFlows` had no such guard at all** — it fetched, then
unconditionally ran:

```ts
setAlerts((prev) => appendFlowTapePage(prev, d.flows));
setHasMorePages(Boolean(d.has_more));
setNextBefore(d.next_before ?? null);
hasOlderPagesRef.current = true;
```

Reachable sequence: a member scrolls to the bottom of the tape (wired to `onLoadOlder`, and also
driven by the auto-backfill effect), starting an older-page fetch under the CURRENT filter. Before
it resolves, they change the ticker/DTE/min-premium filter. `loadFlows` fires for the new filter,
resets `alerts` to the fresh results. If the older-page fetch (started under the OLD filter) then
resolves, it:
- splices the OLD filter's rows into the NEW filter's `alerts` via the functional `setAlerts`
  updater (no identity check on what it's appending to), and
- overwrites `hasMorePages`/`nextBefore` with the OLD filter's pagination cursor, corrupting
  "load more" for the filter actually on screen.

No error, no visible symptom beyond wrong/duplicate rows appearing and pagination silently
breaking — exactly the "stale-fetch-race-without-generation-guard" shape this sweep looks for,
just on the one data-loading function in this file that was missing it.

### Why not fix it by reusing `loadGenerationRef`?

That ref is ALSO bumped by `refreshHead`'s own routine 30s poll (`FLOW_POLL_MS`), which fires with
no filter change at all whenever the SSE connection isn't live. Guarding `loadOlderFlows` against
that shared counter would make it discard a perfectly valid older-page fetch any time a routine
poll tick happened to land mid-fetch — a false positive on the common case, worse in practice than
the rare real race it was meant to catch.

### Fix

Added a second, narrower ref, `filterGenerationRef`, bumped only inside `loadFlows` — which itself
only ever runs when `flowFetchParams` (the filter) changes identity (its sole caller is the
`useEffect(() => { setLoading(true); loadFlows(); }, [loadFlows])` effect). `loadOlderFlows` now
routes its fetch through a small, exported, pure guard — `applyIfGenerationUnchanged` — that
captures `filterGenerationRef.current` before the fetch and only applies the result if it's
unchanged on resolve. Same shape as the existing `AdminApiEventDetail.tsx` `loadEventDetailIfCurrent`
helper (round 121), so the race is unit-testable without rendering the component.

### Evidence (RED → GREEN)

New test file `src/features/helix/components/FlowFeed-older-page-filter-race.test.ts`, 3 cases.
Temporarily stripped the guard (`apply(data)` unconditionally, simulating the pre-fix behavior):

```
not ok 3 - ...each check their OWN start generation, not the other's
  actual: [ 'B', 'A' ]   # stale A applied after current B — the bug, reproduced
not ok 1 - ...resolves AFTER the generation changed is NOT applied
```

Restored the fix: all 3 pass. Full `FlowFeed*.test.ts` suite (19 tests) and the whole
`src/features/helix/components/*.test.ts(x)` directory (62 tests) pass; `tsc --noEmit` clean.

### Blast radius

Single call site (`loadOlderFlows`); `loadFlows`/`refreshHead`'s own existing `loadGenerationRef`
guard is untouched and unaffected — `filterGenerationRef` is a new, independent counter.
