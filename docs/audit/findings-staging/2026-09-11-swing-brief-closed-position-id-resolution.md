> **kind:** FINDING

## Ask Largo swing brief — a separately-supplied positionId could silently resolve to an unrelated live WATCH row instead of the CLOSED position asked for — FIXED

| | |
|---|---|
| **Status** | FIXED |
| **Lane** | Night Hawk Swings / Ask Largo play-brief resolution (`src/lib/swing/play-brief-resolve.ts`) |
| **Severity** | P2 — wrong-identity answer (LARGO-PRODUCT-CONTRACT.md C4: "wrong identity is worse than missing") on a real, documented, first-class API input shape |
| **Found by** | Live forensic pass, `GET /api/market/swing/play-brief?playId=SWING:INTC&ticker=INTC&positionId=30` (a real graded/rolled root position), 2026-09-11 |

### What was broken

`resolveSwingPlayForBrief` accepts a position ID two ways: embedded in `playId` (`SWING:TICKER:ID`,
the frontend hook's `useSwingPlayBrief.ts` convention) or as a **separate `?positionId=` query
parameter** — the shape the route's own docstring documents (`GET
/api/market/swing/play-brief?playId=SWING:NRG&ticker=NRG`) and the shape Largo's tool-calling
layer plausibly uses (a nearby comment already notes Largo's calling convention differs from the
frontend's: "Largo tool omits `?ticker=`").

The function correctly merges both input shapes into one resolved `positionId` variable early on:

```ts
const positionId =
  input.positionId != null && Number.isFinite(input.positionId)
    ? input.positionId
    : parsed.positionId;
```

But its two "does the caller want a specific closed position?" guards never used that merged
value — they read `parsed.positionId` instead, which is parsed **only from the `playId` string**:

```ts
if (parsed.positionId != null) {          // always null when positionId arrives as a query param
  const closed = await loadClosedPlay(ticker, parsed.positionId);
  ...
}
```

So a caller supplying `positionId` as a separate parameter — for a ticker that also currently has
an unrelated **live WATCH/discovery candidate** — skipped both closed-play lookups entirely and
fell through to `pickLanePlayForBrief`, which matched and returned that live, unrelated row
instead. The response was a fully-formed, plausible-looking brief (a live WAIT/entry verdict,
fresh chart reads, everything) for a completely different setup than the one the caller asked
about by position ID — the exact "wrong identity is worse than missing" failure mode this file's
own comments already document fixing twice before, on other axes (C4 label conflation, C3
freshness/absence).

### Root cause

`positionId` (the correctly-merged variable) was introduced after the two closed-play guards were
first written; the guards were never updated to use it, so they silently kept reading the
narrower, playId-only `parsed.positionId`.

### Fix

Both guards (the early check before the open/lane lookups, and the later fallback check after
`pickLanePlayForBrief` finds nothing) now read `positionId` instead of `parsed.positionId`, and
pass it to `loadClosedPlay`. `parsed.positionId` is no longer read anywhere except to compute the
merged `positionId` itself.

### Evidence

New test in `src/lib/swing/play-brief-resolve.test.ts`: constructs a CLOSED, graded position
(id 30) alongside a WATCH-lane row for the *same ticker*, then calls
`resolveSwingPlayForBrief({ playId: "SWING:INTC", ticker: "INTC", positionId: 30 })` — the
playId-embedded form deliberately omitted, matching the route's own documented call shape.
RED before the fix (`git stash` on `play-brief-resolve.ts` alone): resolved to the WATCH row
(`status: "WATCH"`). GREEN after: resolves to the CLOSED position (`status: "CLOSED"`).

Full `src/lib/swing/*.test.ts` (923 tests) + `npx tsc --noEmit`: clean. Full `npm test` run
in progress at time of write-up.

### Blast radius

Two call sites inside one function (`resolveSwingPlayForBrief`), both fixed identically. No other
reader of `parsed.positionId` exists outside this function. `loadOpenTerminalPlay` (the OPEN-row
resolver called earlier in the same function) was already using the correctly-merged `positionId`
variable and needed no change — only the two CLOSED-play guards had the bug.

### Why this and not something bigger

Considered whether `pickLanePlayForBrief` itself should also exclude a ticker for which the
caller supplied a position ID that turns out not to resolve to anything OPEN or CLOSED (i.e.
never fall back to an unrelated live row at all when a specific ID was requested and simply
doesn't exist) — deferred: that changes behavior for a genuinely stale/deleted position ID (no
matching row anywhere), where falling back to *something* useful for the ticker is arguably
better than a bare 404, and is a judgment call outside this fix's narrow scope (the bug here is
that a *resolvable* closed position was never even looked up, not that the fallback-when-truly-
absent behavior is wrong).
