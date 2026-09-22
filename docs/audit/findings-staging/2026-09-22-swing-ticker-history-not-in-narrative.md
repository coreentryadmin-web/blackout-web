# Swing brief's ticker-specific losing track record never reaches "Trade manager read"

> **kind:** FINDING

| Field | Value |
|---|---|
| **Status** | FIXED |
| **Severity** | P3 (enhancement) |
| **Lane** | Night Hawk Swings — Ask Largo play-brief |
| **Found by** | Ask Largo × Night Hawk Swings standing mandate, aggressive-mode enhancement hunt (2026-09-22) |

## Gap

`play-brief-ticker-history.ts`'s `loadTickerTrackRecord` computes a plain, chain-aware count of
how the desk has done trading this EXACT ticker before (Largo C10, "historical context") — real,
already-shipped, already-tested logic (including a 2026-09-21 temporal-ordering fix). It reaches
the brief in exactly two places:

1. `tickerTrackRecordSection` (play-brief-intel.ts) — its own standalone "Ticker track record"
   section.
2. `play-brief.ts`'s evidence-array builder — one `[FACT]` line near the bottom of the document.

It never reaches `tradeManagerNarrativeSection`'s "Trade manager read" — the section a member
actually reads to decide whether to act on a live recommendation. Every sibling piece of
counter-evidence this file already has (cross-desk conflict, catalyst timing, short interest, IV
extremes) gets its own coaching bullet in that section; ticker-specific track record did not.

## Live repro (AAPL:40, 2026-09-22)

AAPL's live brief renders `**Consider adding**` as its lead "Trade manager read" bullet
(manageAction ADD, thesis intact, +43.1% live). The SAME brief's evidence array separately states:

> `[FACT] Ticker track record: AAPL 0W / 2L across 2 prior closed trades.`

A 100% loss rate on this exact ticker — a member reading only the bolded recommendation (the
normal reading path) has no way to see this unless they also read the evidence list at the very
bottom of the document.

## Fix

New `tickerHistoryCoaching(ctx)` in `play-brief-narrative-coaching.ts`, wired into
`collectCoachingBullets` near `crossDeskCoaching` (early enough to survive the 14-bullet cap).
Fires ONLY when the record is actually cautionary (`losses > wins`) — a neutral or winning record
needs no special callout, since the bare section already cites it and a positive recommendation
needs no extra corroboration to stand. No minimum-sample gate (matches `loadTickerTrackRecord`'s
own established discipline: a plain factual count, not a calibrated score needing Largo C6
graduation), but the wording names the sample size so a thin `0W/1L` reads as thin evidence, not a
damning verdict.

## Evidence

4 new unit tests + 1 `collectCoachingBullets` integration test. `npx tsc --noEmit`: clean. Full
`src/lib/swing/*.test.ts`: 1503/1503 pass.

## Blast radius

One new function, one new call site in `collectCoachingBullets`. Does not touch
`tickerTrackRecordSection` or the evidence-array citation (both keep rendering exactly as before) —
purely additive, and only renders anything new for the minority of positions with a losing
ticker-specific record.
