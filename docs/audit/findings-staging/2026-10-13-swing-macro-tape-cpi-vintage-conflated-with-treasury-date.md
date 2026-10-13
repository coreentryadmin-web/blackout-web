## 2026-10-13 — [Night Hawk Swings / Largo] Macro tape section shows CPI with zero vintage disclosure — the one combined `as_of` field silently borrows the FRESHER treasury date — FIXED
> **kind:** `FINDING`

| **Area** | **Severity** | **Status** |
|---|---|---|
| Night Hawk Swings — Ask Largo swing play-brief, `macroTapeSection` | P2 — silently misleading data vintage on a member-facing index/ETF brief | FIXED |

### What was wrong

`macroTapeSection` (`src/lib/swing/play-brief-intel.ts`) renders the index/ETF-scope "Rates
backdrop" line — 10-year treasury yield, the 10s-1s curve spread, and CPI — with **zero freshness
disclosure**, unlike every other data-bearing section in this same file family (GEX posture, Vector
desk, chart levels, Meridian catalysts, fundamentals/short-interest all carry an explicit "Last
snapshot … may lag" note or an inline date once the underlying read is old enough to matter).

Live-verified the same day directly against Polygon's own reference endpoints (the same ones
`fetchPolygonMacroBackdrop`, `src/lib/providers/polygon-macro.ts`, calls):

```
treasury row: date 2026-10-08   (5 days old)
inflation row: date 2026-08-01  (73 days old)
now: 2026-10-13
```

CPI is a monthly series with an inherent ~1-month publish lag, so a 73-day-old print is the
*normal*, current reading — not a fetch failure. The bug is that the member sees no date at all:
`CPI **334.1**` renders with the exact same unqualified confidence as the 5-day-old `10Y **5.22%**`
sitting right next to it on the same line, with nothing to tell the two vintages apart.

**Root cause:** `buildMacroBackdrop` (`polygon-macro.ts`) computes one combined
`as_of: treasury.date ?? inflation.date ?? null`. Because the daily treasury series almost always
has a `date`, this expression collapses to the TREASURY print's date even when the line is also
reporting the CPI figure — so even if `macroTapeSection` had rendered `as_of`, it would have shown
the misleadingly fresh 2026-10-08 next to a CPI number that is actually dated 2026-08-01. A single
shared vintage field cannot honestly represent two independently-aged series; that's a stronger
failure mode than simply omitting a date, since surfacing the wrong one actively asserts a false
recency rather than leaving it unstated.

This is the same freshness principle (Largo product contract) already enforced for
`arsenal.fundamentals.as_of` (`catalystsSection`'s `fundamentalsAncient`/`fundamentalsFreshnessTag`
staleness tiers) and `arsenal.news.as_of` (the 2026-09-18 fix referenced in that section's own
comment) — macro was the one sibling arsenal leg that carried a computed `as_of` all the way
through the type system (`EcosystemArsenalMacro.as_of`) and still never reached a renderer.

### Fix

- `src/lib/bie/ecosystem-context.ts` — `EcosystemArsenalMacro` gains two new, ADDITIVE fields
  (Largo product contract: never flatten a more precise field away in favor of a coarser one) —
  `treasury_as_of` and `cpi_as_of` — populated directly from `reads.macro.treasury.date` and
  `reads.macro.inflation.date` in `assembleEcosystemArsenal`, instead of the single conflated
  `as_of`. The existing `as_of` field is left untouched (still `treasury.date ?? inflation.date`)
  since `src/lib/bie/verdict.ts` reads the same conflated value from `PolygonMacroBackdrop` directly
  (a separate call site, out of scope here — noted below under blast radius).
- `src/lib/swing/play-brief-intel.ts`'s `macroTapeSection` now appends each value's own date:
  `10Y **5.22%** (2026-10-08)` and `CPI **334.1** (2026-08-01 print)`. No threshold/staleness-tier
  machinery was added (unlike fundamentals) — CPI's vintage is *always* shown, every time, because
  a monthly print with no attached date is ambiguous by nature, the same "always disclose, don't
  gate on a threshold" treatment `formatMeridianItem` already applies to earnings dates elsewhere in
  this file.

### Evidence (RED → GREEN)

Two new tests in `src/lib/swing/play-brief-intel.test.ts`:
- `macroTapeSection: CPI and 10Y each disclose their OWN print date...` — asserts both dates render
  distinctly. Verified RED against the pre-fix source (`git stash` on just the two source files,
  tests kept): failed on the exact predicted line, `'Rates backdrop: 10Y **5.22%** · 10s-1s **0.78**
  · CPI **334.1**'` — no dates anywhere. GREEN after restoring the fix.
- `macroTapeSection: missing per-series dates render the figures with no false date...` — back-compat
  guard: when `treasury_as_of`/`cpi_as_of` are null (e.g. an older fixture), no date is fabricated.
- `ecosystem-context.test.ts`'s existing `assembleEcosystemArsenal(index): macro/breadth/catalysts
  populate...` fixture updated to carry `treasury.date`/`inflation.date` and assert the two new
  fields alongside the untouched `as_of`.

Full suite: `npx tsc --noEmit` clean; targeted files 263/263 pass
(`src/lib/swing/play-brief-intel.test.ts` + `src/lib/bie/ecosystem-context.test.ts`); full `npm test`
run alongside this PR (see PR description for the exact count).

### Blast radius

- `src/lib/swing/play-brief-narrative-coaching.ts`'s `macroTapeCoaching` reads the same
  `arsenal.macro` object but never renders CPI at all (only 10Y/curve/breadth tone) — left
  untouched; the material gap (a 2+-month-old figure with zero disclosure) is specific to
  `macroTapeSection`'s CPI line. Checked for duplication between the two renderers first:
  `collapseRedundantIntelSections` (`play-brief-intel-collapse.ts`) already lists "Macro tape" in
  `NARRATIVE_COVERED_TITLES`, so `macroTapeSection`'s standalone output is dropped whenever the
  Trade-manager narrative (which folds in `macroTapeCoaching`) is leading — not a duplicate-fact bug
  like the chart-technicals/Vector-desk one fixed earlier today, so no narrative-side change needed.
- `src/lib/bie/verdict.ts`'s `macroSummary.date` reads `macro.as_of` directly off the raw
  `PolygonMacroBackdrop` parameter (a different call site than `EcosystemArsenalMacro`) and inherits
  the identical treasury-date-shadows-CPI-date conflation. Not touched by this PR — confirming
  whether that `date` field is ever surfaced as member-facing text (vs. staying internal to the BIE
  verdict engine) is a separate investigation, out of scope for this single-issue fix.

### What was deliberately left unchanged

`buildMacroBackdrop`'s combined `as_of` derivation (`polygon-macro.ts`) stays as-is — changing its
return shape would ripple into `verdict.ts` and any other untraced consumer of `PolygonMacroBackdrop`
directly. The additive per-series fields on `EcosystemArsenalMacro` solve the member-facing
rendering gap without touching that shared root type.
