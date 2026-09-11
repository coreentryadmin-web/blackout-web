# Swing play-brief "Data freshness" section fabricated a directional "Bearish" pill — FIXED

> **kind:** FINDING

| | |
|---|---|
| **Area** | Night Hawk Swings — Ask Largo play-brief (`src/lib/swing/play-brief-intel.ts`) |
| **Severity** | P2 — member-visible, directly misleading |
| **Status** | FIXED (this PR) |
| **Found during** | Standing Ask Largo mandate, 2026-09-11 cycle — deep-dive on Catalysts / Meridian catalysts / Hold plan / Data freshness sections |

## Root cause

`dataFreshnessSection` (`play-brief-intel.ts:951-991`) is a pure data-quality report: option-mark
timestamp, swing-scan age, Vector staleness, GEX-matrix age, HELIX pipeline freshness. None of its
lines are a market read. Its `bias` field, however, was:

```ts
bias: play.markIsSync && playExpectsLiveOptionMark(play.status) ? "bearish" : "neutral",
```

`RichSection.bias` is `BieBias` (`bullish | bearish | neutral | mixed`), and the UI renders it
literally as a directional pill: `BiasPill` in `src/features/largo/answer/BieChips.tsx` maps it
through `BIAS_LABEL` (`bearish` → the string `"Bearish"`) and `biasToneClass` (`bie-bias-bearish`,
a red/negative CSS tone), on the `BieSectionCard` that wraps every rich Largo section. Any OPEN/
HOLD/TRIM swing play whose option mark was a sync quote without a stored freshness timestamp
(`markIsSync === true`) — regardless of whether the play is LONG or SHORT, regardless of any real
directional evidence — got a red "Bearish" pill stamped on its "Data freshness" card. A member
reading that card would reasonably conclude the desk sees a bearish signal on the position; the
actual fact is unrelated to direction at all — it's "we don't have a live-quote timestamp for this
mark, treat P&L as indicative."

This is a direct violation of `docs/audit/LARGO-PRODUCT-CONTRACT.md`'s **direction** pillar:
`direction` must represent an actual market read; overloading the same field as a generic
"something's off, flag it red" semaphore corrupts that signal for every consumer of `RichSection`
(any future cross-section bias rollup, any UI that trusts the pill).

## Why it wasn't caught earlier

Zero test coverage of `dataFreshnessSection`'s `bias` field existed — the 6 existing tests for this
function (mark timestamp formatting, stale vector/GEX/scan/HELIX warnings, WATCH/CLOSED suppression)
all assert on `section.body`, never on `section.bias`. The bug shipped invisibly because nothing
ever checked what pill it would render as.

## Evidence

- New regression test `dataFreshnessSection: bias is never directional — ...` in
  `src/lib/swing/play-brief-intel.test.ts`: constructs an OPEN, LONG play with `markIsSync: true,
  markAsOf: null` (a live position whose mark carries no freshness timestamp — the exact live shape
  this section warns about) and asserts `section.bias === "neutral"`.
  - **Before fix:** 82 pass / 1 fail — the new test fails, asserting `"bearish"` was returned.
  - **After fix:** 83/83 pass.
- Full suite: 13721 pass / 0 fail / 3 skipped (pre-existing, unrelated). `tsc --noEmit` clean.

## Fix

`dataFreshnessSection` now always returns `bias: "neutral"` — data-quality facts are never a
directional call. The `play.markIsSync && playExpectsLiveOptionMark(play.status)` condition still
gates the **body line** ("Mark age unknown — sync quote without timestamp; treat P&L as
indicative"), which is correct and unchanged; only the pill mislabel is removed.

## Blast radius

Single function, single call site (`buildIntelSections` → `dataFreshnessSection`, wired
unconditionally into every WATCH/OPEN/CLOSED swing brief). No other `RichSection` builder in
`play-brief-intel.ts`/`play-brief-narrative.ts`/`play-brief.ts` derives `bias` from a data-quality
condition instead of an actual directional read — checked each `bias:` assignment in those three
files; every other one is either genuinely thesis/technicals/flow-direction-derived or omitted.
`playExpectsLiveOptionMark` import stays in use (still gates the body line).

## Fix rationale

Left the body-line condition untouched — it correctly explains the caveat in prose, which is the
right way to surface a data-quality fact. The fix is narrowly scoped to the pill, the only place the
false directional signal actually reached a member.
