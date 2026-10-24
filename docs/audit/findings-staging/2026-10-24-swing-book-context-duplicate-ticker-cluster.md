> **kind:** FINDING

## Ask Largo swing Book Context: duplicate OTHER ticker scattered instead of clustered

| **Status** | FIXED |
|---|---|

### Root cause

`bookContextSection` (`src/lib/swing/play-brief-intel.ts`) builds its theme-overlap "Concentration"
sentence by mapping `overlap.sameThemeSameDirection`/`sameThemeOpposedDirection` (minus the
reviewed ticker) straight into a comma-joined name list, in whatever order `checkPortfolioOverlap`
returned them. `formatOverlapPosition` already disambiguates a ticker that appears more than once
in that list with its own position id (fixed 2026-09-17, #5167) — but nothing groups the two
occurrences of the SAME ticker together. If an unrelated ticker happens to sit between them in the
source order, the duplicate reads as an accidental repeat rather than a deliberate second position.

Live repro (2026-10-24, Night Hawk Swings standing mandate, `GET /api/market/swing/play-brief?
playId=SWING:PANW:67&ticker=PANW`):

```
Concentration — already holding 5 same-direction positions in theme "software":
ZS LONG (separate position #2106), SNOW LONG, NET LONG, CRWD LONG, ZS LONG (separate position #2028).
```

ZS (two Banger-origin positions, #2106 and #2028) is correctly annotated both times, but SNOW/NET/CRWD
sit between the two mentions, so a trader skimming the sentence sees "ZS LONG ... ZS LONG" with no
visual grouping and reasonably reads it as a rendering bug rather than two real, independently-opened
positions.

This is the same underlying concern (`MAX_OVERLAP_NAMES`'s own doc comment calls it "bullet-dump
instead of trade-manager voice") as the already-fixed MRNA/TSLA/TSLL same-ticker cases, but one
level down: those fixes split a duplicate that matches the REVIEWED ticker into its own sentence.
This is a duplicate WITHIN the "other" (non-reviewed) side of a multi-name theme sentence, which
none of the existing splits cover, because there's no single ticker to pull into a dedicated
sentence when the theme has several genuinely different names.

### Blast radius

Both call sites that build an "other" (non-reviewed-ticker) names list from a theme-overlap bucket
are affected identically: `otherSameDir` (the `sameThemeSameDirection` "Concentration" sentence) and
`otherOpposed` (the `sameThemeOpposedDirection` "Internal conflict" sentence). Both now route through
the same `clusterByTicker` helper.

### Fix

Added `clusterByTicker(positions)`: a stable grouping pass that moves every occurrence of the same
ticker to sit contiguously, preserving first-occurrence order between distinct tickers. Applied to
`otherSameDir` and `otherOpposed` immediately after filtering out the reviewed ticker, before mapping
to `formatOverlapPosition`/`joinOverlapNames`. Pure reordering — `dupTickers`/`crossEngineDupTickers`
are computed by the caller over the original (unclustered) list beforehand and are unaffected.

### Evidence

- Live repro captured above via the real production `play-brief` endpoint before writing the fix.
- Regression test (`src/lib/swing/play-brief-intel.test.ts`, `"bookContextSection: a duplicate OTHER
  ticker in a multi-name theme overlap is clustered adjacently, not scattered (2026-10-24, live PANW
  repro)"`) reproduces the exact live shape (ZS/SNOW/NET/CRWD/ZS) and fails without the fix (confirmed
  via `git stash` of `play-brief-intel.ts` alone), passes with it.
- Full `npx tsx --experimental-test-module-mocks --test src/lib/swing/play-brief-intel.test.ts`: 320/320
  pass. `tsc --noEmit`: clean.

### Why this fix and not an alternative

Considered combining duplicate tickers into a single entry ("ZS LONG ×2 (positions #2106, #2028)")
instead of clustering. Rejected for this PR: it would change `formatOverlapPosition`'s per-row
contract (which several other call sites and tests depend on returning one string per position) and
is a larger, more opinionated UI change. Clustering is the minimal fix that solves the actual
scannability problem (the two mentions are no longer separated by unrelated names) without touching
any other rendering behavior.
