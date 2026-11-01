> **kind:** FINDING

## Ask Largo `bookContextSection` same-underlying closer hardcoded "twice" regardless of real count — FIXED

| | |
|---|---|
| **Area** | Night Hawk Swings / Ask Largo (`src/lib/swing/play-brief-intel.ts`, `bookContextSection`) |
| **Severity** | P3 (narrative correctness — a numeric claim in the trade-manager voice disagreeing with the data it's describing) |
| **Status** | FIXED |
| **Found by** | Standing Ask Largo × Night Hawk Swings ownership mandate, live digging, 2026-11-01 |

### What was broken

`bookContextSection`'s same-ticker/same-direction "Concentration — same underlying" closer sentence
was a bare string literal:

```ts
`${play.ticker} stacks the identical wager twice, not diversifying across names.`
```

regardless of how many same-ticker/same-direction positions actually overlapped the reviewed play.
It read correctly for exactly one pre-existing position (2 total instances including the reviewed
one) — the only shape the pre-existing test (`2026-10-21, live MRNA repro`) covered — but the live
book now holds a THIRD independent MRNA LONG position: positionId 2240 overlaps TWO prior MRNA LONG
positions (#68 and #2167), for 3 total instances, and the rendered brief still said "twice":

```
**Concentration — same underlying** — already holding MRNA LONG (separate, cross-engine position
#68), MRNA LONG (separate position #2167) on MRNA itself, the same side as this LONG candidate.
This is the identical name, not just the same sector. MRNA stacks the identical wager twice, not
diversifying across names.
```

Live-confirmed via `GET /api/market/swing/play-brief?playId=SWING:MRNA&ticker=MRNA&positionId=2240`
on prod, 2026-11-01.

### Root cause

`sameTickerSameDir.length` (the count of OTHER overlapping rows, excluding the reviewed play) was
computed but never consulted when building the closer sentence — the sentence template hardcoded
"twice" as if `sameTickerSameDir.length` could only ever be 1.

### Fix

Added a small `timesWord(total)` helper ("twice" for 2, `"N times"` for 3+) and computed
`totalSameTickerSameDir = sameTickerSameDir.length + 1` (the reviewed row plus every other
overlapping row) to drive both the pending-entry ("Adding X stacks...") and already-committed
("X stacks...") closer variants.

### Blast radius

Single call site — the one `bookContextSection` closer sentence for the same-ticker/same-direction
branch. The sibling "Concentration" (different-ticker, same-theme) closer a few lines below was
already count-free ("stacks the same wager rather than diversifying risk") and needed no change.

### Tests

`src/lib/swing/play-brief-intel.test.ts`:
- Extended the existing 2026-10-21 MRNA test with an explicit assertion that the 1-other-position
  (2 total) case still says "twice".
- New: a 2-other-positions (3 total), already-committed (`status: "HOLD"`) case asserting the text
  now says "3 times" and never "twice".
- New: the same 2-other-positions shape through the WATCH/pending-entry branch ("Adding MRNA
  stacks...").

RED→GREEN verified via `git stash push -u -- src/lib/swing/play-brief-intel.ts`: both new tests
failed against the pre-fix source with the exact "twice" mismatch predicted; restoring the fix
(`git stash pop`) passes all 353 tests in the file. `tsc --noEmit` clean.

### PR

`fix/book-context-hardcoded-twice-count`
