## 2026-10-21 — [FINDING, swing] Confidence "moderate" tier collapsed the entire realistic 1-8 unavailable-source range into one undifferentiated label

> **kind:** `FINDING`

| Field | Value |
| --- | --- |
| **Status** | FIXED (partially — see "Why not a bigger fix") |
| **Severity** | P3 (calibration nuance, Largo C6/C7 — no field was wrong, a real distinction was unrepresented) |
| **Surface** | `src/lib/swing/play-brief-confidence.ts` — `swingPlayBriefConfidence()` |

### Root cause

For non-closed, non-thin-entry plays, the only threshold was zero vs non-zero `unavailableSources`
— any count >=1 read "moderate" with no further graduation. Live data confirmed the full realistic
range in production: MRNA (8 unavailable — every live feed this file tracks for a committed
position down at once, essentially total live-source outage) and RNG×2 (8 each) read the IDENTICAL
"moderate" as DKNG (7) and TSLA/SHOP (6 each, WATCH bucket). The function's own unit tests already
showed the bottom of the range (1 and 2) also reads "moderate", so 1-of-N and 8-of-8 were
presentationally identical. The `"insufficient"` `BieConfidenceLevel` the type declares valid (and
that the precedent this function's own header comment cites, `cortex-read.ts`, actually reaches for
"every source absent") was structurally unreachable from `swingPlayBriefConfidence` — no code path
ever returned it, even at the measured live worst case of 8/8 feeds down.

### Evidence

MRNA (positionId 1958, TRIM): `confidence.level='moderate'`, `unavailableSources` length 8
(`['HELIX flow','option mark','Vector heatmap','Vector dark pool','Meridian catalysts','swing
discovery scan','Night Hawk Legacy','thesis health']`). RNG (positionId 1966, OPEN):
`confidence.level='moderate'`, length 8 (identical 8 names). DKNG (positionId 1963, OPEN):
`confidence.level='moderate'`, length 7. TSLA/SHOP (WATCH): `confidence.level='moderate'`, length 6
each. All four distinct real counts (6, 7, 8, 8) rendered the same single label with no
intermediate tier used in production.

Added 4 tests to `play-brief-confidence.test.ts` (5 still reads "moderate" — no regression at the
old boundary; 6 and 8 now read "low"; the thin-entry-evidence gate still dominates over the new
tier). RED→GREEN, git-stash-verified on the source file alone: 11/13 (2 fail) before the fix,
13/13 after. Broader regression sweep: `play-brief.test.ts` + `cortex-read.test.ts` — 206/206
total. `tsc --noEmit` clean.

### Blast radius

Single function, one new branch. No other call site reads `swingPlayBriefConfidence`'s output
beyond the envelope's `confidence` field it already populated.

### Fix

Added a `low` tier at `unavailableSources.length >= 6` (between the existing zero-count `high`
branch and the `moderate` fallback), citing the real counts this audit cycle observed in its own
code comment. Existing tests pinning 1 and 2 at "moderate" are untouched; 5 still reads "moderate"
(verified by a new test at the old boundary); 6 and 8 now read "low".

### Why not a bigger fix

This is explicitly a partial fix. `collectBriefUnavailableSources` (`play-brief-absence.ts`) has no
fixed roster size — its ~19 distinct possible `source` labels are mutually exclusive by gating
condition (e.g. "Vector desk state" vs "fetch failed" are alternate branches of the same check) and
bucket/context-dependent (Meridian peer cohort, 0DTE Command, Night Hawk Legacy, etc. only ever
fire under specific conditions), so there is no honest, non-arbitrary "N of M" denominator to
compute from inside this function without restructuring `collectBriefUnavailableSources` itself to
also report how many checks it attempted (not just which failed) — a materially bigger change than
this single-issue PR's scope. Because of that, this fix deliberately stops at a count-based `low`
tier grounded in the real distribution this audit cycle measured (6/7/8 all occurring live), rather
than fabricating a false `insufficient`/"every source absent" claim without a true denominator to
back it — doing so would be exactly the kind of invented certainty the Largo contract's own C6
principle warns against. Reaching a genuine `insufficient` tier is a real, distinct follow-up that
needs that denominator fix first, not a threshold tune of this PR's own count.
