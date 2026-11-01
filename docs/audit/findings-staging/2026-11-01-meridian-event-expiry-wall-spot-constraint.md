> **kind:** FINDING

## Meridian per-event GEX wall picker (`scopeStructureToExpiry`) had no spot-side constraint — could invert call/put wall relative to price — FIXED

**Status:** Fixed, regression test added (`src/lib/meridian/meridian-event-expiry-core.test.ts`).

### Root cause

`scopeStructureToExpiry` (`src/lib/meridian/meridian-event-expiry-core.ts`) re-derives the
dealer-structure walls for the one expiry that covers an earnings print, directly from
`cells[strike][expiry]`. It picked `callWall` as the strike anywhere in the scoped chain with
the single largest POSITIVE net dealer gamma, and `putWall` as the strike with the single
largest NEGATIVE net gamma — with **no constraint that the call wall sit above spot or the put
wall sit below it**:

```ts
if (v > 0 && (best == null || v > best.v)) best = { strike, v };
if (v < 0 && (worst == null || v < worst.v)) worst = { strike, v };
```

This is the identical defect class already found, measured live on production, and fixed in
the sibling helper `wallsFromStrikeTotals` (`src/lib/providers/gex-cross-validation-core.ts`,
fixed 2026-08-20 — that fix's own doc comment records AAPL/SPY/META each serving an inverted
wall on prod, e.g. `put_wall 765 <- support ABOVE price` on SPY at spot 763.11).
`meridian-event-expiry-core.ts` was written 2026-08-18 — two days before that fix landed — as
an **independent reimplementation** of the same argmax/argmin wall-selection logic, and the
spot constraint was never propagated to it; the function took no `spot` parameter at all.

Downstream, `meridian-earnings-intel.ts` feeds `scoped.callWall`/`scoped.putWall` into
`coerceMeridianWallLevels` (`meridian-earnings-intel-core.ts`), but that function only
corrects the case where `call_wall <= put_wall` **relative to each other** — it does not check
either wall's position relative to spot individually, so a wrong-side wall that happens to
still be numerically ordered correctly versus its counterpart (e.g. call wall below spot, put
wall also below spot but even lower) passes straight through uncorrected. The result reaches
members via `meridian-earnings-report-core.ts`, rendered as an actionable line ("Band
`${put_wall}-${call_wall}`", "Reaction-trade put-side or fade setups below call wall
`${call_wall}`").

### Evidence

- **RED (pre-fix):** a fixture modeling the exact live shape from the sibling fix's own
  measurements — spot 100, strike 95 carrying the single largest positive net gamma in the
  chain (9,000,000) but sitting BELOW spot, strike 110 carrying the single largest negative net
  gamma (-8,000,000) but sitting ABOVE spot, with the genuinely-correct call wall (105, above
  spot) and put wall (90, below spot) both present but smaller in magnitude — returned
  `callWall: 95, putWall: 110` with `spot` wired through: inverted, resistance below price and
  support above it.
- **GREEN (post-fix):** the same fixture with the spot constraint applied returns
  `callWall: 105, putWall: 90` — the genuinely nearest-qualifying walls on the correct side of
  price.
- A third test confirms **no fallback to the wrong side**: when every positive-gamma strike
  sits below spot (no candidate at all above spot), `callWall` is `null`, not an inverted guess.
- A fourth test confirms **zero behavior change for the omitted-spot case** — every existing
  caller/test that does not pass `spot` gets byte-identical output to before the fix.
- `meridian-event-expiry-core.test.ts`: 25/25 pass (was 23/25 before the fix — the two new
  spot-constraint tests were RED against the pre-fix source, confirmed before implementing the
  fix).
- `meridian-earnings-intel-core.test.ts` and the rest of `src/lib/meridian/*.test.ts` unaffected
  (484/488 pass; the 4 failures are a pre-existing, unrelated tsx-resolver `ERR_INVALID_URL`
  issue — ``tsx@4.23.x``'s own ESM resolver hook breaking under Node 20 when invoked via a raw
  `npx tsx --test <glob>` from inside a long nested scratchpad path, matching the exact "missed
  real failures" tsx-resolver trap CLAUDE.md's Environment-realities section already documents
  for #2073; none of the 4 failing files (`meridian-benzinga-earnings`, `meridian-earnings-
  history`, `meridian-estimate-revision-zero-delta`, `meridian-sector-classify`) import anything
  touched by this fix, and the proper `npm test` runner via `scripts/run-tests.mjs` does not
  exhibit it).

### Blast radius

- `scopeStructureToExpiry` has exactly one production call site:
  `meridian-earnings-intel.ts`'s `loadMeridianEarningsIntel`, which feeds `scoped.callWall`/
  `scoped.putWall` into `buildErPlayRead` (the earnings play-read) and into
  `coerceMeridianWallLevels` → `intel.walls` (rendered by `meridian-earnings-report-core.ts` as
  the "Band ${put_wall}-${call_wall}" line and the "fade setups below call wall" coaching line).
  Both consumers now receive side-constrained walls.
- `coerceMeridianWallLevels` itself was deliberately left unchanged (see below) — fixing at the
  source means it now receives already-correct raw walls in the common case, so its existing
  relative-ordering correction and pinned-single-strike spot tie-break continue to apply only
  to the genuinely-ambiguous cases they were built for.

### Fix rationale

Added an optional `spot?: number | null` parameter to `scopeStructureToExpiry`, mirroring
`wallsFromStrikeTotals`'s existing pattern exactly: when a real, positive spot is supplied, a
call-wall candidate must have `strike > spot` and a put-wall candidate `strike < spot`; when
omitted, the historical unconstrained behavior is preserved byte-for-byte, so every other
caller (there are none besides the one production call site, but the test file's 10+ pre-
existing unconstrained-mode tests all still pass unchanged). No fallback to an inverted level
when no strike qualifies on a side — null is the honest answer ("no call wall above spot in
this chain"), matching the sibling fix's own "NO FALLBACK TO THE WRONG SIDE" principle.

Wired `spot` through at the one call site by hoisting the existing `spot` computation
(`input.pack.positioning.spot ?? thermal?.spot ?? null`) above the `scopeStructureToExpiry`
call instead of leaving it where it was (further down, already computed from data available at
that point) — a pure reordering, no new data dependency introduced.

Rejected: duplicating the fix inside `coerceMeridianWallLevels` instead (would leave the root
cause in `scopeStructureToExpiry` unfixed for any future caller, and `coerceMeridianWallLevels`
already has a different, correct job — relative-ordering repair plus degenerate-pin tie-break —
that should not be made to also carry the primary side-of-spot constraint).

### Deliberately left unchanged

- `coerceMeridianWallLevels`'s relative-ordering correction and pinned-single-strike spot
  tie-break (`meridian-earnings-intel-core.ts`) — both still correct and still needed for the
  genuinely-ambiguous cases (e.g. a single pinned strike with no second candidate) that a
  per-strike spot constraint at the source cannot resolve by itself.
- `wallsFromStrikeTotals` (`gex-cross-validation-core.ts`) — the original, already-fixed
  sibling; untouched.
- The matrix's own whole-book `call_wall`/`put_wall`/`flip` aggregates — out of scope for this
  function, which exists specifically to re-scope structure to one expiry.
