> **kind:** FINDING

## Swing discovery: `fetchPositioningHits` origin-fetch failure was swallowed silently — FIXED

**Date:** 2026-09-19
**Component:** `src/lib/swing/discovery.ts` (`runSwingDiscoveryScan`, V2 Tier-0 POSITIONING origin)
**Severity:** P3 (observability gap — no production behavior changed, but a real outage was
invisible in CloudWatch)

### Root cause

`runSwingDiscoveryScan` fetches the V2 Tier-0 POSITIONING origin two ways, preferring
`deps.fetchPositioningHits` (direction-aware) and falling back to `deps.fetchPositioningTickers`
(tickers only) when the richer accessor is absent:

```ts
if (engineV2 && deps.fetchPositioningHits) {
  try {
    const hits = await deps.fetchPositioningHits();
    ...
  } catch {
    originFetchErrors.push("POSITIONING");   // <-- no log
  }
} else if (engineV2 && deps.fetchPositioningTickers) {
  const r = await fetchTier0OriginTickers("POSITIONING", deps.fetchPositioningTickers);
  ...
}
```

Every *other* Tier-0 V2 origin fetch (the `fetchPositioningTickers` fallback, plus CATALYST,
BANGER, VECTOR) routes through the shared `fetchTier0OriginTickers` helper
(`src/lib/swing/v2/tier0-origin-fetch.ts`), which logs `console.warn("[swing-discovery] Tier-0
origin <kind> fetch failed:", err)` on every throw before returning the honest
`{tickers: [], fetchError: true}` shape. The **preferred** `fetchPositioningHits` path — the one
production actually wires (it carries `direction`, used for the Q5 direction-disagreement drop) —
had its own bare `catch {}` that recorded the failure into `originFetchErrors` (so
`recall.tier0OriginFetchErrors` was still correct) but never logged anything. A real POSITIONING
origin outage would silently vanish from CloudWatch and be distinguishable from "the origin
legitimately returned zero names this scan" only by someone reading the scan's own JSON result —
nobody tails that per-scan.

This is the same class of bug as the same-cycle `scan.ts` FLOW-fetch logging fix (PR #5249):
a catch block sets a degraded/error flag but doesn't log, inconsistent with its own siblings in
the same file.

### Evidence

RED→GREEN regression test added to `src/lib/swing/discovery.test.ts`
(`runSwingDiscoveryScan: logs (not just records) when the preferred fetchPositioningHits origin
throws`): spies on `console.warn`, forces `fetchPositioningHits` to throw, asserts a POSITIONING
warning was logged. Confirmed RED (fails) on `discovery.ts` pre-fix via `git stash`, GREEN
(passes) with the fix. Full `npx tsc --noEmit` clean; `discovery.test.ts` 28/28 (29/29 with the
new test) pass on Node 20.

### Fix

Added `console.warn("[swing-discovery] Tier-0 origin POSITIONING fetch failed:", err)` to the
`fetchPositioningHits` catch block, matching `fetchTier0OriginTickers`'s exact log shape/format so
a future CloudWatch filter on `[swing-discovery] Tier-0 origin` catches this path too. No
behavior change — `originFetchErrors`/`recall.tier0OriginFetchErrors` were already correct;
this only adds the missing log line.

### Blast radius

Single call site — `fetchPositioningHits` is only read in `runSwingDiscoveryScan`. No other
consumer duplicates this catch shape.

| **Status** | FIXED |
