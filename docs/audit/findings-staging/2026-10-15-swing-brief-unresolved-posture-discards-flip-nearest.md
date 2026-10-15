## 2026-10-15 — [FINDING, P3, Ask Largo Night Hawk Swings] `dealerPostureLine()` discarded `flip_nearest`/`distance_to_nearest_flip_pct` whenever gamma posture was unresolved — live repro GOOG — FIXED

> **kind:** `FINDING`

| **Status** | FIXED |
|---|---|

### Context

Live spot-check of `GET /api/market/swing/play-brief` for the 3 real committed HOLD positions
(GOOG:59, GOOGL:58, TSLA:57) as part of this cycle's non-skippable Ask Largo deep-dive (standing
mandate, `#4076`). GOOG's "Trade manager read" section rendered only:

> Spot **344.91** — dealer gamma posture not resolved on this read.

while the SAME brief's "GEX posture" section (a different code path reading the same
`ctx.ecosystem.gex_positioning`) rendered full real dealer data for GOOG moments earlier in the
response (Net GEX, walls, vanna/dex/charm reads) — the two sections did not actually disagree
(both correctly reflect that `gex.gamma_posture`/`flip` are null for GOOG right now), but the
"not resolved" line discarded a specific, already-computed, genuinely useful fact.

### Root cause

Confirmed live via `cumulativeGammaFlipDetail` (the real production function,
`gex-cross-validation-core.ts`) run against GOOG's actual current `strike_totals`:

```
spot: 344.87
detail: { flip: null, reason: "crossings_far_from_spot", crossings: 1, nearestCrossing: 388.43 }
distance_to_nearest_flip_pct: -12.63
```

GOOG's book has exactly one zero-crossing, at 388.43 — **12.63%** above spot, just outside the
`cumulativeGammaFlipDetail` `±12%` plausibility window (`FLIP_MAX_DIST_PCT`), so `flip` is
correctly `null` and `gamma_posture` is correctly unresolved (confirmed via the raw
`gex.regime` object: `{"flip":null,"posture":null,"read":"Gamma flip undetermined — regime read
unavailable until the chain prints a clean dealer-gamma profile."}`).

`gex-positioning.ts`'s own field doc for `flip_nearest` says exactly this is the designed case:
"Also populated when `flip` is null because every crossing sits outside the ±12% plausibility
window (`flip_reason` = crossings_far_from_spot): it names the closest crossing even when it was
rejected as the headline flip." This field — and `flip_crossings`/`distance_to_nearest_flip_pct`
alongside it — are the exact inputs the fragile-flip clause shipped earlier today (PR #6062) reads.
But `dealerPostureLine()`'s early-return branch for unresolved posture
(`src/lib/swing/play-brief-narrative.ts`, the `if (!posture || posture === "unknown")` guard) ran
BEFORE any of those fields were ever consulted — it returned the bare "not resolved" message and
discarded `flip_nearest` unconditionally, even on a fresh (non-stale) GEX matrix that had already
computed the one thing worth telling a trader in exactly this situation: there IS a crossing, it's
at 388.43, it's just ~12.6% away — too far to call a stable regime, but still the level to watch
if price approaches it.

### Fix

`src/lib/swing/play-brief-narrative.ts`: in the unresolved-posture branch, append a
`nearestCrossingBit` sourced from `gex.flip_nearest`/`gex.distance_to_nearest_flip_pct`, gated on
`!gexMatrixStale(gex, readMs)` — the same staleness gate every sibling regime read in this function
(`fragileBit`, `regimeBits`) already uses, since a stale matrix's crossing location is exactly as
unreliable as its flip. Renders as:

> Spot **344.87** — dealer gamma posture not resolved on this read — chain's only crossing sits at
> **388.43** (-12.6% away), too far from spot to call a stable regime.

When `flip_nearest` is absent (e.g. the book never crosses zero — `net_short_everywhere`) or the
matrix is stale, the branch falls back to the original bare message unchanged — no new failure
mode, strictly additive information when available.

### Blast radius

Single call site (`dealerPostureLine`, the only caller of this early-return branch). No other
section reads this branch's output. `gexPostureSection` (play-brief-intel.ts) and the collapse
logic that folds it into this narrative for OPEN/WATCH buckets are untouched — this only adds
content to a message that previously threw away data it already had on hand.

### Tests (RED → GREEN, proven via `git stash` on `play-brief-narrative.ts` only)

- Live repro (GOOG numbers above) verbatim: unresolved posture + fresh, non-stale `flip_nearest`
  surfaces the nearest-crossing clause with the correct formatted distance.
- Unresolved posture with no `flip_nearest` (zero crossings) stays the original plain message —
  no crash, no fabricated clause.
- Unresolved posture with a STALE GEX matrix suppresses the new clause (falls back to the plain
  message), mirroring the existing `gexMatrixStale` gate on `fragileBit`/`regimeBits`.
- Pre-fix: 2 of the 3 new assertions fail (regex mismatch — the branch never appends anything).
  Post-fix: all pass. `npx tsc --noEmit`: clean. Full `npm test` (Node 20.20.2): 16111/16111 pass,
  0 fail, 3 skipped.
