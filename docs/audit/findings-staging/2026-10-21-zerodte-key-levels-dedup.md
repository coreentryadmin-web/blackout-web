# 0DTE `key_supports`/`key_resistances` show a duplicated level, silently dropping the real second-best one — FIXED

> **kind:** FINDING

| **Status** | FIXED |
|------------|-------|

## Symptom

Live `GET /api/market/zerodte/board` (production, 2026-10-21): `QQQ key_supports=[707.23, 707.23]`,
`AMD key_supports=[524.6, 524.6]` — both names show the SAME level twice instead of two distinct
supports, even though each name has real chart structure that should have surfaced a genuine
second level.

## Root cause

`src/features/nighthawk/lib/technicals.ts` (~line 185) builds `support_levels`/`resistance_levels`
as a concatenation of THREE independently-sourced levels:

```ts
support_levels: [...swings.support, mtf.weekly?.support, mtf.monthly?.support]
```

These three sources (a recent swing low, the weekly low, the monthly low) can legitimately
resolve to the same rounded price — e.g. the nearest swing support and the weekly support both
sitting on the same round number. `src/lib/zerodte/board.ts`'s `enrichSetup` (~lines 1858-1867)
then picked the "2 highest supports below price / 2 lowest resistances above price" with:

```ts
(tech?.support_levels ?? []).filter((l) => l > 0 && l < price).sort((a, b) => b - a).slice(0, 2)
```

— filter, sort, slice(0,2), with **no deduplication**. When two of the three sources collide,
the duplicate survives the sort as two adjacent, identical entries, and `slice(0,2)` returns
`[X, X]` instead of `[X, <real second-best level>]` — the actual second-best support/resistance is
silently dropped from the panel, not merely mis-ordered. This wasn't caught earlier because the
existing `board.test.ts` fixture (`fakeDossier()`) used three support levels and three resistance
levels that were all mutually distinct, so the no-dedup path was never exercised by a collision.

## Evidence

Live repro (production, 2026-10-21, `GET /api/market/zerodte/board`): `QQQ key_supports=[707.23,
707.23]`; `AMD key_supports=[524.6, 524.6]`.

Reproduced the same shape locally and proved RED→GREEN with `git stash` isolating only
`src/lib/zerodte/board.ts` (test file never touched):
- **RED** (pre-fix `board.ts`, fixture: `support_levels: [186.5, 186.5, 184.1, 179.9]`,
  `resistance_levels: [190.2, 190.2, 193.5, 175.0]`): `key_supports` came back `[186.5, 186.5]`
  (expected `[186.5, 184.1]`) — `AssertionError` on `deepStrictEqual`.
- **GREEN** (fix restored): `key_supports = [186.5, 184.1]`, `key_resistances = [190.2, 193.5]` —
  full suite 138/138 pass on `src/lib/zerodte/board.test.ts` (Node 20,
  `npx tsx --experimental-test-module-mocks --test src/lib/zerodte/board.test.ts`).

## Fix

Added a `dedupeLevels()` helper in `board.ts` (relative-tolerance dedup, 0.5% with a 0.01 floor —
the same convention already used by `swingLevels`'s own internal `dedup` in `technicals.ts`,
since every source already rounds to 2dp but isn't guaranteed to collide byte-for-byte) and ran
both `key_supports` and `key_resistances` through it BEFORE the sort+slice(0,2). Both fields had
the identical undeduplicated pattern, so both were fixed in the same change.

## Blast radius

`keySupports`/`keyResistances` are also read later in the same function to derive
`condorCallWall`/`condorPutWall` (the iron-condor short-strike wall inputs) — a duplicated level
there would not itself break the condor geometry (it already takes the first entry,
`keyResistances[0]`/`keySupports[0]`, which is unaffected by a duplicate at the tail), but a
dropped second-best level means the panel itself under-informs the trader looking for the next
level out. No other call site in the repo reads `support_levels`/`resistance_levels` through this
same top-2 slice pattern (checked via grep for `support_levels` / `resistance_levels` outside
`technicals.ts` and `board.ts`), so no other fix site was needed.

## Deliberately left unchanged

`technicals.ts`'s own concatenation (`support_levels`/`resistance_levels`) was left as-is — it is
reasonable for the raw, undeduplicated list to carry every source (a future consumer may want to
know a level was corroborated by two independent timeframes), so the dedup belongs at the
presentation-consuming call site (`enrichSetup`'s top-2 slice), not the raw technicals builder.
