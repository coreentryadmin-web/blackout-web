> **kind:** FINDING

## 2026-11-07 — `docs/audit/DATA-API-PROCUREMENT.md`'s "Env tuning" table lists two GEX heatmap env defaults that were superseded months ago — FIXED (docs)

| **Status** | FIXED on `fix/data-api-procurement-stale-defaults` (docs-only) |
| --- | --- |

**Symptom:** `docs/audit/DATA-API-PROCUREMENT.md` (dated 2026-07-01) has an "Env tuning (free
correctness wins)" table presenting two env-var defaults as current:

- `GEX_HEATMAP_BAND_PCT` — doc says default **0.04** ("Other tickers")
- `OPTIONS_HEATMAP_PAGE_GUARD` — doc says default **40** ("Chain pagination cap")

Both are stale. The live implementation in `src/lib/providers/polygon-options-gex.ts` has moved
both defaults significantly since the doc was written, and the doc was never updated:

```
src/lib/providers/polygon-options-gex.ts:2041: const SPX_HEATMAP_BAND_PCT = 0.06;
src/lib/providers/polygon-options-gex.ts:2051: const DEFAULT_HEATMAP_BAND_PCT = 0.20;
src/lib/providers/polygon-options-gex.ts:2055-2061:
  function heatmapBandPct(root) {
    if (root === "SPX") return clamp(env.SPX_GEX_HEATMAP_BAND_PCT) ?? SPX_HEATMAP_BAND_PCT;
    return clamp(env.GEX_HEATMAP_BAND_PCT) ?? DEFAULT_HEATMAP_BAND_PCT;   // 0.20, not 0.04
  }

src/lib/providers/polygon-options-gex.ts:2018-2021:
  function resolveHeatmapPageGuard(envValue) {
    return Math.max(40, Number(envValue) || 200);                        // default 200, floor 40
  }
  const HEATMAP_PAGE_GUARD = resolveHeatmapPageGuard(process.env.OPTIONS_HEATMAP_PAGE_GUARD);
```

The code's own comments explain why each moved: `DEFAULT_HEATMAP_BAND_PCT` was raised from an
earlier ±4%/±12% because a narrow band missed real round-number gamma walls on sparse/low-priced
names (the comment names ASTS @ $73 specifically — only 10 strikes and 2 call walls inside ±6%,
real walls at 90/100/125 never fetched). `OPTIONS_HEATMAP_PAGE_GUARD`'s old cap of 40 is now only
the **floor** (`Math.max(40, ...)`), not the default — the resolved default when the env var is
unset is 200, ~4x headroom documented against under-pagination truncating chains.

A reader following this doc's "Env tuning" table to configure or reason about GEX heatmap behavior
would get numbers that are 5x (band) and 5x (page guard) off from what actually ships today — in
both cases understating how wide/deep the live defaults actually are, the exact "GEX coverage gap"
this same document's own §1 complains competitors beat BlackOut on.

**Verification against current `main`:** read `src/lib/providers/polygon-options-gex.ts` directly
(lines 2018-2061, quoted above) — this file is excluded from source changes this round (gex
provider correctness was already swept clean in prior rounds), so only the doc was touched; no
source edit was made or needed here.

**Fix (docs-only):** `docs/audit/DATA-API-PROCUREMENT.md`'s "Env tuning" table now states the
correct current defaults (`GEX_HEATMAP_BAND_PCT` → 0.20, `OPTIONS_HEATMAP_PAGE_GUARD` → 200) with a
one-line pointer to the source constants/functions and the reason each moved, so a reader checking
the doc against the code sees the same story instead of a stale one.

**Blast radius:** `docs/audit/DATA-API-PROCUREMENT.md` only — no source files changed, no behavior
changed.

**Evidence:**
- Direct read of `src/lib/providers/polygon-options-gex.ts` lines 2018-2061 on `main`, quoted above.
- `npx tsc --noEmit` — clean (pre-existing unrelated nighthawk-lane errors only, no new ones; docs
  change touches no `.ts`/`.tsx` file).
- Full `npm test` run before merge (docs-only change, no source touched).

Found via lead #1 in the round-377 prompt ("read a cross-cutting `docs/audit/*.md` doc not yet
read this session in full, cross-check present-tense claims against current source") —
`DATA-API-PROCUREMENT.md` was one of the four candidates named by round 376.
