> **kind:** FINDING

## `fmtCompareSpot` deferred to the viewer's browser locale instead of pinning `en-US` — FIXED

**Status**: FIXED — `src/features/vector/lib/vector-compare-format.ts` (PR #TBD)

### Root cause

`fmtCompareSpot` (`src/features/vector/lib/vector-compare-format.ts`), the spot-price readout
used in `VectorComparePane.tsx`'s compare-pane header, called
`spot.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })`.
Passing `undefined` as the locale argument means "format using the viewer's browser/OS locale" —
every *other* price/number formatter in this desk (`helix-flow-format.ts`, `vector-technicals.ts`,
`vector-play-engine.ts`, `vector-wall-events.ts`, `vector-pulse.ts`, and ~15 more across
Vector/Helix/Thermal) explicitly pins `"en-US"` for exactly this reason — a repo-wide grep of
every `.toLocaleString(`/`.toLocaleDateString(` call site in non-owned code confirmed this file
was the single exception.

For a financial price readout, this is not purely cosmetic: the grouping and decimal separators
swap meaning across locales (`de-DE` renders `5432.1` as `5.432,10` — a period as the thousands
separator, a comma as the decimal point — the exact inverse of the US convention the rest of the
desk assumes). A trader whose browser is set to a non-US locale would see the SPX/ticker spot
price in the compare pane rendered with digit-grouping that reads backwards relative to every
other number on the same page.

### Evidence

The file's existing test (`vector-compare.test.ts`) already asserted an en-US-shaped output
(`assert.match(fmtCompareSpot(5432.1, "SPX"), /5,432\.10/)`) — that assertion only ever passed
because this sandbox's/CI's own environment locale happens to be en-US; it would silently diverge
under a different `Intl` default locale and gives no protection against the real bug (a viewer's
browser running a different locale).

Added a second regression test that spies on `Number.prototype.toLocaleString` to capture the
actual locale argument passed, independent of the running environment's own locale:
```
Number.prototype.toLocaleString = function (locale, options) { capturedLocale = locale; ... };
fmtCompareSpot(5432.1, "SPX");
assert.equal(capturedLocale, "en-US");
```
RED→GREEN confirmed via a temp-file swap (not `git stash`): reverting the fix (`"en-US"` →
`undefined`) fails this new test (`capturedLocale === undefined`); the fix passes. Full
`vector-compare.test.ts` suite: 15/15 passing post-fix. Lint + `tsc --noEmit` clean.

### Blast radius

Single call site (`VectorComparePane.tsx`'s compare-pane spot readout) — confirmed via repo-wide
grep that `fmtCompareSpot` has no other importers. No other locale-dependent `.toLocaleString()`
call without an explicit locale was found elsewhere in non-owned code during this pass (the
broader repo-wide grep showed every other formatter already pins `"en-US"` or `"en-CA"`
explicitly).

### Fix rationale

Pinned the locale argument to `"en-US"`, matching every sibling formatter in the same desk and the
file's own doc comment ("SPX gets 2dp like the rest of the desk"). Zero behavior change for any
viewer whose browser locale already resolves to en-US (the overwhelming majority); corrects the
display for any viewer whose browser locale does not.
