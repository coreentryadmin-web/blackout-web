# GEX Full-Chain Escalation Truncated at a Flat 12-Page Guard (NFLX/GOOGL live-caught)

> **kind:** FINDING

## Summary
`fetchHeatmapBandUnfiltered()` in `src/lib/providers/polygon-options-gex.ts` — the "full chain, no
strike filter" fetch used when a banded GEX pull returns a thin ladder (`shouldEscalateToFullChain`)
— was capped at a hardcoded `HEATMAP_UNFILTERED_PAGE_GUARD = 12`. Live CloudWatch logs from this
session (`/ecs/blackout-production`, ~18:15–18:45 UTC 2026-09-05) show both **NFLX** and **GOOGL**
hitting this guard and truncating: `"hit 12-page guard with next_url still set — chain incomplete,
walls/OI/IV understated."` Net GEX, call/put walls, and OI for both names were understated by
whatever OI/strikes sat past page 12 of the unfiltered snapshot.

## Root Cause
This is the third live occurrence of the exact same bug class this file already documents fixing
twice: "chasing the live chain size with a static number." The two prior fixes —
`fetchPolygonOiByExpiry` (2026-07-03, AAPL) and the OI-by-expiry term-structure loop (later,
SPX) — were both migrated to share the properly floored, env-overridable `HEATMAP_PAGE_GUARD`
(`resolveHeatmapPageGuard`, `Math.max(40, envValue || 200)`). `fetchHeatmapBandUnfiltered` was never
migrated.

Its own doc comment explains the wrong assumption baked into the flat 12: it was written for "only
tiny low-priced chains (NIO-class)." But `shouldEscalateToFullChain` was later fixed (the ASTS
finding) to escalate on ANY thin banded ladder regardless of spot price, not just low-priced names —
so this fetch now also runs for megacap chains with hundreds of strikes across many expiries
(exactly what NFLX and GOOGL are). A 12-page cap that was sized for a tiny low-priced chain silently
truncates a megacap full-chain pull on every escalation.

## Evidence
Live CloudWatch Logs, `/ecs/blackout-production`, this session:
```
[polygon-gex] fetchHeatmapBandUnfiltered(NFLX) truncated: hit 12-page guard with next_url still set — chain incomplete, walls/OI/IV understated.
[polygon-gex] full-chain escalation ADOPTED for NFLX: 38 -> 263 strikes (spot 78.32, band 62-94).
[polygon-gex] fetchHeatmapBandUnfiltered(GOOGL) truncated: hit 12-page guard with next_url still set — chain incomplete, walls/OI/IV understated.
[polygon-gex] full-chain escalation ADOPTED for GOOGL: 39 -> 149 strikes (spot 338.72, band 268-403).
```
Both names ADOPTED the truncated full-chain result anyway (it was still strictly richer than the
banded pull), so the truncation degrades but does not visibly break the feature — the exact "reads
as fine, silently wrong" failure mode this file's earlier fixes were written to close.

## Fix
`src/lib/providers/polygon-options-gex.ts`:
- `const HEATMAP_UNFILTERED_PAGE_GUARD = 12;` → `const HEATMAP_UNFILTERED_PAGE_GUARD = HEATMAP_PAGE_GUARD;`
  (shares the already-fixed, env-overridable, floor-40 guard, same precedent as the OI-by-expiry
  term-structure loop).
- Exported `__test_heatmapUnfilteredPageGuard` for regression coverage (the guard is otherwise a
  private module const with no direct test surface).
- Updated the stale doc-comment cross-reference on `shouldEscalateToFullChain`.

No other call site references `HEATMAP_UNFILTERED_PAGE_GUARD`.

## Tests
`src/lib/providers/polygon-options-gex.test.ts` — new test asserts the guard is `>= 40` (the shared
floor) and `!= 12`. RED→GREEN proven: reverting the fix locally reproduced the exact failure
(`got 12`); restoring it passed. Full file suite: 69/69 pass. `npx tsc --noEmit` clean.

| **Status** | FIXED |
|-----------|-------|
| **Branch** | `fix/gex-heatmap-unfiltered-page-guard` |
| **PR** | #4028 |
| **Regression Test** | `src/lib/providers/polygon-options-gex.test.ts` (69/69 pass) |
