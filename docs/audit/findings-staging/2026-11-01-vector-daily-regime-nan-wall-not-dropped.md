> **kind:** FINDING

# Vector daily-regime overlay: a NaN wall strike wasn't dropped like a missing one

| | |
|---|---|
| **Area** | Vector — `vector-daily-regime.ts` (end-of-session dealer-regime rail: `/api/market/vector/daily-regime`, and `get_vector_analytics`'s historical overlay for Largo) |
| **Status** | Fixed |
| **Severity** | P3 — malformed-upstream-sample edge case, no live repro confirmed, but a real, demonstrable contract violation with a direct regression test |

## Root cause

`reduceSessionToDaily()` collapses one session's recorded wall/flip samples into a single
end-of-session row. Its own comment states the contract plainly: *"A row with no level at all
carries no information — drop it rather than emitting a gap the chart would have to
special-case."* That drop check reads:

```ts
const flip = Number.isFinite(last.gammaFlip as number) ? (last.gammaFlip as number) : null;
const callWall = last.walls?.callWalls?.[0]?.strike ?? null;
const putWall = last.walls?.putWalls?.[0]?.strike ?? null;
if (flip == null && callWall == null && putWall == null) return null;
return {
  date,
  gammaFlip: flip,
  callWall: Number.isFinite(callWall) ? callWall : null,
  putWall: Number.isFinite(putWall) ? putWall : null,
  observed: last.modeled !== true,
};
```

`flip` is guarded with `Number.isFinite` *before* the drop check — a non-finite `gammaFlip`
becomes `null` early, so the drop check can see it. `callWall`/`putWall` are only coerced with
`?? null` at that point, which catches an *absent* strike (`undefined`) but not a *present,
non-finite* one (`NaN`). A `NaN` strike is `!= null`, so it sails past the
`flip == null && callWall == null && putWall == null` check even though it carries no real
information — the exact case the comment says to drop. The function then falls through to the
return statement, where the *second*, separate `Number.isFinite` guard (previously living only
there) nulls the field out anyway — producing a row with `gammaFlip: null, callWall: null,
putWall: null` instead of returning `null` as the contract requires. This is the same
"guard present on one sibling field (`flip`), missing on another (`callWall`/`putWall`) at the
point that matters" shape already confirmed in `helix-flow-deep-link.ts` (#7184) and
`vector-pick-effective-bias.ts` (#7185) this sweep.

## Evidence

Live repro against `main` before the fix (`node --import tsx`, file-based script per this repo's
own documented inline-eval trap):

```js
reduceSessionToDaily("2026-08-07", [
  { time: 1, walls: { callWalls: [{ strike: NaN, pct: 1 }], putWalls: [{ strike: NaN, pct: 1 }] }, gammaFlip: NaN },
]);
// => { date: "2026-08-07", gammaFlip: null, callWall: null, putWall: null, observed: true }
// expected: null (per the function's own "drop it" comment, and the existing sibling test
// "rows carrying no level at all are dropped, not emitted as gaps")
```

New regression test (`vector-daily-regime.test.ts`, "a NON-FINITE wall strike (NaN, not absent)
is dropped exactly like a missing one") fails on the pre-fix code with exactly this payload
(confirmed via `git stash` RED→GREEN) and passes after the fix. A second case in the same test
confirms the fix is additive, not stricter than necessary: a genuinely finite wall alongside a
NaN flip still reports the real wall (`callWall: 7800`) while only the non-finite fields
(`putWall`, `gammaFlip`) null out — the row is not over-dropped.

## Blast radius

Single call site: `vector-daily-regime-server.ts`'s `loadSessionWallTail` → `reduceSessionToDaily`
pipeline, which feeds both `/api/market/vector/daily-regime` (the historical 1D/1W/4H regime
overlay chart) and Largo's `get_vector_analytics` tool (same derivation, per that file's own
"one derivation, not a copy" header). No other caller in the repo.

## Fix rationale

Moved the `Number.isFinite` guard for `callWall`/`putWall` to the same place it already lived for
`flip` — immediately at extraction, before the drop check — rather than widening the drop check's
condition or leaving the second guard where it was. This makes all three fields follow the exact
same shape (guard once, at the point of extraction) so a future field added to this function
can't reintroduce the same split. Deliberately left unchanged: the drop check's logic itself
(`flip == null && callWall == null && putWall == null`), the return statement's field names, and
every other function in the file — this is a narrowly-scoped, single-function fix.
