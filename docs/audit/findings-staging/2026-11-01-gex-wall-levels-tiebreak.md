> **kind:** FINDING

# `computeGexWalls` ranked ties non-deterministically on half-strike names — FIXED

## Root cause

`computeGexWalls` (`src/lib/providers/gex-wall-levels.ts`) builds the Vector chart's ranked
multi-node `callWalls`/`putWalls` lists by pushing a candidate per strike while iterating
`Object.entries(strikeTotals)`, then sorting the resulting arrays by `pct` descending with
`Array.prototype.sort`. That sort is **stable** (guaranteed since ES2019), so on an exact
`|gamma|` tie between two strikes, the final order keeps whichever candidate was **pushed
first** — i.e. whichever entry `Object.entries()` happened to enumerate first.

For plain integer-index-like string keys (`"6800"`), the JS spec always enumerates those
ascending by numeric value regardless of insertion order, so the bug is invisible on
whole-dollar chains. But for **non-integer-index keys** — SPX's real half-strikes
(`"7700.5"`), or any other 0.5-wide chain — `Object.entries()` enumerates in **insertion
order** instead, which here is a direct function of `strikeTotalsFromLadder`'s source `Map`'s
insertion order, i.e. the order strikes arrived over the live WS ladder. Two independently
rebuilt computations of the *identical* book, differing only in trade-arrival order, can
therefore rank a tied pair of half-strikes in opposite order — read by a member as a wall
"flipping" when nothing in the market moved.

This is the exact same bug class already fixed, in the same file's own import
(`gex-cross-validation-core.ts`), for `wallsFromStrikeTotals` and `kingFromStrikeTotals`
(`#7191`, 2026-11-01), and for `scopeStructureToExpiry`
(`meridian-event-expiry-core.ts`, `#7193`, 2026-11-01) — a strict/unsorted argmax-style scan
over `Object.entries()` resolving an exact tie by insertion order rather than by strike. Those
two fixes landed the same day this one was found; `computeGexWalls` (a different file, a
multi-node ranker rather than a single argmax) was never checked against the same vein.

The file's own doc comment on `computeGexWalls` states the invariant this breaks directly:
`callWalls[0]`/`putWalls[0]` "are the exact same largest-positive/largest-negative strikes
`gex-positioning.ts`'s `call_wall`/`put_wall` would pick ... so the Vector chart's #1 wall per
side can never diverge from the Thermal/Grid GEX panels reading the same underlying ladder."
On an exact tie, with `wallsFromStrikeTotals` now deterministically tie-broken (lower strike
wins) and `computeGexWalls` not, that invariant could silently fail.

## Evidence

Reproduced directly: two `Map<number, number>` ladders describing the identical book
(`100.5` and `105.5`, each carrying exactly `5e8` gamma — an exact tie), inserted in opposite
order:

```
Map([[100.5, 5e8], [105.5, 5e8]])  → callWalls: [100.5, 105.5]
Map([[105.5, 5e8], [100.5, 5e8]])  → callWalls: [105.5, 100.5]
```

Same gamma data, opposite insertion order, **opposite #1 wall**. Confirmed this does NOT
reproduce with whole-dollar strikes (`100`/`105`) — consistent with the root cause being
`Object.entries()`'s insertion-vs-numeric enumeration split on non-integer-index keys.

- **RED (pre-fix):** added
  `"computeGexWalls: an exact |gamma| tie between two half-strikes resolves deterministically
  regardless of Map insertion order"` to `gex-wall-levels.test.ts` — 20 pass / 1 fail,
  `actual: [100.5, 105.5]` vs `expected: [105.5, 100.5]`.
- **GREEN (post-fix):** 21/21 pass in that file.
- Full consumer sweep (`gex-wall-levels.test.ts` + every Vector wall/GEX-reconstruct/play-engine/
  universe/snapshot test + `gex-odte-scope.test.ts` + `gamma-levels*.test.ts` +
  `pin-temporal-stability.test.ts`): **508/508 pass.**
- `npx tsc --noEmit`: clean.

## Blast radius

`computeGexWalls` (and its thin wrapper `computeBeadRailGexWalls`) is the shared wall-ranking
primitive behind:
- `vector-wall-history.ts` / `vector-wall-events.ts` / `vector-wall-membership.ts` /
  `vector-wall-proximity.ts` — the Vector chart overlay's wall bead rail, history and
  membership tracking.
- `vector-gex-reconstruct.ts` / `vector-narrowed-wall-core.ts` / `vector-dte-walls-core.ts` —
  the DTE-toggle wall reconstruction paths.
- `vector-play-engine.ts`, `vector-universe.ts`, `vector-snapshot.ts` — Vector play/universe
  scanning and the live snapshot cache.
- `src/lib/zerodte/pin-discovery.ts` / `pin-temporal-stability.ts` — PIN-regime wall input.
- `src/lib/bie/vector-full-state.ts`, `src/lib/nighthawk/cortex/types.ts` — cross-product Largo
  Cortex wall-trend reads of the same wall set.
- `src/lib/research/gamma-levels*.ts` — the public gamma-levels research pages.

Every one of these reads the ranked list this function returns; any affects a genuinely-tied
half-strike pair specifically (SPX, SPXW, and any other 0.5-wide chain), which is common on
index names, not an edge case confined to synthetic data.

## Fix rationale

Sort `Object.entries(strikeTotals)` ascending by numeric strike **before** the push loop, same
pattern as `wallsFromStrikeTotals`/`kingFromStrikeTotals`. Because the later `.sort((a, b) =>
b.pct - a.pct)` is stable, pre-sorting by strike makes an exact-tie resolution deterministic:
the lower strike is always pushed (and therefore ranked) first among ties, on every call,
regardless of the source Map's insertion order.

Deliberately left unchanged: the final `.sort(pct desc)` itself (still the correct primary
ranking key), the `spot` side-constraint logic (orthogonal to this bug, already correct per
`#3495`), and every downstream consumer (none needed a change — they all consume whatever
order this function returns).

| **Status** | FIXED — regression test added, RED→GREEN confirmed, 508/508 sibling tests pass, `tsc --noEmit` clean. |
|---|---|
