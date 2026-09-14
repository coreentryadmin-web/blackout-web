> **kind:** FINDING

## Ask Largo's catalyst-coaching bullet kept warning "size down before report" hours after the print had already landed and moved the stock — FIXED

| **Status** | FIXED (this commit) |
|---|---|

**Root cause:** `catalystCoaching` (`src/lib/swing/play-brief-narrative-coaching.ts`) gates its
earnings warning on `days_until <= 14`, and specifically `days_until === 0` for "today." But
`days_until === 0` alone cannot distinguish "prints tonight" from "printed three hours ago" — the
function had no concept of the current ET wall-clock time relative to the print's own
`report_time` bucket (`"premarket"`/`"afterhours"`/`"unknown"`), so the same forward-looking "size
down or exit before report" instruction rendered regardless of whether the print was still ahead
or had already happened.

**Evidence (live reproduction, 2026-09-14, PLAY — Dave & Buster's, forensic batch 14):** PLAY
reported Q2 FY26 results after the 16:00 ET close (confirmed directly against Benzinga,
`benzinga_id 61777824`, published 2026-09-14T20:31:07Z = 16:31 ET) — a miss on both lines, already
down 12.16% in after-hours trading within minutes. The play-brief was rendered at 19:07 ET, 2.5+
hours later, with the SAME brief's own Vector desk already reading "momentum short on continuation
→ target put wall 7" off the post-print tape — yet the catalyst bullet still said:

> **Earnings in 0d** (2026-09-14 (afterhours)) — size down or exit before report unless thesis is earnings-driven.

A member reading only this bullet would believe they still had time to react before the print,
when the gap had already happened and the stock had already moved on it.

**Blast radius:** every same-day (`days_until === 0`) earnings position read after the print's own
implied bell-relative time (16:00 ET for afterhours, 09:30 ET for premarket) on the print date
itself. Scoped to `catalystCoaching` only — `catalystsSection`'s (`play-brief-intel.ts`) neutral
"Earnings: **date** today (afterhours)" evidence line is factually accurate either way and doesn't
make a forward-looking claim, so it was left untouched; extending this fix there would require
threading a current-time parameter through a function that currently only takes
`EcosystemContext`, a larger, out-of-scope signature change for a pure display line that isn't
itself wrong.

**Fix:** added `printAlreadyLandedThresholdMs`, deriving the ET epoch-ms instant a same-day print
of the given `report_time` bucket has definitively landed, and comparing it against `ctx.asOf` (the
brief's own read time). When the threshold has passed, the bullet now reads "**Earnings already
printed today**... thesis now carries a realized print gap; reassess off the post-print structure,
not the pre-print setup" instead of the forward-looking warning. `report_time === "unknown"` never
claims already-printed (never guesses it landed), matching the exact honest-absence discipline the
adjacent `noGapExposure` branch in this same function already applies for the identical reason.
The `noGapExposure` branch itself (a contract's own expiry vs the print date) is untouched — that
fact stays true regardless of whether the print has landed yet.

**Fix rationale:** kept the fix narrowly scoped to the one function making a temporally
forward-looking claim, rather than also touching `catalystsSection`'s neutral evidence line or the
shared cross-product earnings type (`EcosystemArsenalEarnings`) — both would widen the change well
beyond what this specific defect needs. Considered reusing Meridian's `classifyPrintTiming` (which
classifies a raw Benzinga `HH:MM:SS` time), but swing's `report_time` is already a bucketed
`"premarket"|"afterhours"|"unknown"` value, not a raw clock time, so a purpose-built threshold
check was simpler and more direct than adapting a helper built for a different input shape.

**Test:** RED→GREEN proven (git-stashed the source fix, confirmed 2 new tests — live-shaped
afterhours-past-16:00 and premarket-past-09:30 PLAY repros — fail against pre-fix code with the
exact wrong forward-looking output; restored and confirmed green). Added 3 more tests proving the
fix narrows correctly: the SAME afterhours/premarket cases read BEFORE their threshold keep the
original forward-looking warning, and an `"unknown"` timing bucket never claims already-printed
even at a read time late enough that a known bucket would. Full `src/lib/swing/*.test.ts` (1135
tests) green, `tsc --noEmit` and `eslint` clean on both changed files.
