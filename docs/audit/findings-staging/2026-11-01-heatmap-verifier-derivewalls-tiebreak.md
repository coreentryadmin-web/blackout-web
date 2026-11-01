> **kind:** FINDING

# `heatmap-verifier.ts`'s `deriveWalls` picked call/put wall + King non-deterministically on an exact tie — FIXED

## Root cause

`deriveWalls` (`src/lib/correctness/heatmap-verifier.ts`) is the INDEPENDENT oracle the GEX
correctness audit (`invariantChecks`, used by `verifyHeatmapTicker`) runs against the served
matrix: INV-3a/INV-3b compare it against `hm.gex.call_wall`/`hm.gex.put_wall`, and INV-3c (plus
the raw-chain King cross-check and the 0DTE-scope King cross-check further down the same file)
compare it against `kingFromStrikeTotals`. It scanned `Object.entries(strikeTotals)`
**unsorted**, tracking `callWall`/`putWall`/`king` with strict `g > maxPos` / `g < maxNeg` /
`Math.abs(g) > maxAbs` comparisons.

`strikeTotals` carries SPX-style decimal strike keys (`"7700.5"`), which are **not** JS
integer-index keys, so `Object.entries()`/`Object.keys()` enumerates them in **insertion
order**, not numeric order — confirmed directly:

```
Object.keys({ "720.5": 1, "700.5": 1 })  →  ["720.5", "700.5"]   (insertion order, not sorted)
```

On an exact tie between two strikes' net gamma, a strict-`>` scan over that unsorted order keeps
whichever strike was inserted first, which is a property of how the engine happened to build
`strike_totals` that request — not of the gamma data at all. This is the **identical** bug class
already fixed in this exact session for `wallsFromStrikeTotals`/`kingFromStrikeTotals`
(`gex-cross-validation-core.ts`), `computeGexWalls`/`topGexPinStrikes` (Vector), and
`summarizeHeatmapGammaByExpiry` (Meridian) — and, most tellingly, for this *same file's own two
neighboring oracles*: `deriveFlip` (line ~132) and `deriveCumulativeGammaFlip` (line ~159) both
already sort `Object.entries(strikeTotals)` ascending by strike before reducing, with an in-code
comment explaining exactly why. `deriveWalls`, sitting directly above both of them, never got
the same fix — the vein was fixed twice in this file and skipped the third, oldest sibling.

## Evidence

Reproduced directly with two `strikeTotals` fixtures carrying identical data, built with the two
tied strikes inserted in opposite order:

```
tiedHighFirst = { "720.5": 1e9, "700.5": 1e9, "710.5": 5e8 }
tiedLowFirst  = { "700.5": 1e9, "720.5": 1e9, "710.5": 5e8 }
```

Pre-fix, `deriveWalls(tiedHighFirst).callWall === 720.5` while
`deriveWalls(tiedLowFirst).callWall === 700.5` — same book, opposite "independent" call wall,
purely from build order. The same shape reproduces for `putWall` (negated values) and for `king`
(an exact `|GEX|` tie).

- **RED (pre-fix logic, isolated by temporarily reverting only the `.sort()` call while keeping
  the function exported):** 4 new tests fail —
  `deriveWalls: exact call-wall tie ...`, `exact put-wall tie ...`, `exact |GEX| king tie ...`,
  and `tie-break determinism holds under the spot side-constraint too` — 23/27 pass in
  `heatmap-verifier.test.ts`.
- **GREEN (post-fix):** 27/27 pass in `heatmap-verifier.test.ts`.
- Full sibling sweep (`heatmap-verifier.test.ts` + `gex-cross-validation-core.test.ts` +
  `gex-odte-scope.test.ts`): **78/78 pass.**
- `npx tsc --noEmit`: clean.

## Blast radius

`deriveWalls` is called from four sites in `heatmap-verifier.ts`, all part of the live GEX
correctness audit (`verifyHeatmapTicker`, the production correctness-sweep entry point for this
module):
- INV-3a/INV-3b (`invariantChecks`) — compares `derivedCall`/`derivedPut` against the served
  `hm.gex.call_wall`/`hm.gex.put_wall`. A false INV-3a/INV-3b "flag" from this bug would read as
  "production's call/put wall is wrong" on a tick where it was actually correct and
  deterministic (per the already-fixed `wallsFromStrikeTotals`) — the exact "flicker" failure
  mode this whole vein of fixes exists to remove, just surfacing as a false audit alarm instead
  of a member-visible flicker.
- INV-3c (`invariantChecks`) — King self-consistency (`void derivedKing` today, but the same
  unsorted scan feeds it).
- The raw-chain King cross-check (`rawRecomputeNetGexAndKing` comparison, line ~1106,
  `deriveWalls(servedBand).king`).
- The 0DTE-scope King cross-check (line ~1282, `deriveWalls(odteScope.strikeTotals).king`).

Every one of these is a real-production-data audit path (SPX/SPXW half-strike chains are exactly
where this fires), so the bug could make the correctness verifier itself unreliable on tied
books — the audit tool reporting a disagreement that isn't real, or agreeing by incidental luck
rather than by a deterministic rule it can be trusted to repeat.

## Fix rationale

Sort `Object.entries(strikeTotals)` ascending by numeric strike **before** the scan — identical
fix shape, and identical tie-break convention ("lower strike wins"), already applied to
`wallsFromStrikeTotals`/`kingFromStrikeTotals` in production and to this same file's own
`deriveFlip`/`deriveCumulativeGammaFlip`. Also exported `deriveWalls` (previously module-private)
so it can be unit-tested directly with tie fixtures, matching how `deriveCumulativeGammaFlip` is
already exported and tested in this file.

Deliberately left unchanged: the side-constraint logic (`spot` gating which side a strike can
win, already correct per `#2503`), the King self-consistency placeholder (`void derivedKing`),
and every call site (none needed a change — they already consume whatever `deriveWalls` returns).

| **Status** | FIXED — regression tests added (4 new, covering call wall / put wall / King / the spot-constrained case), RED→GREEN confirmed via an isolated logic-only revert, 78/78 sibling tests pass, `tsc --noEmit` clean. |
|---|---|
