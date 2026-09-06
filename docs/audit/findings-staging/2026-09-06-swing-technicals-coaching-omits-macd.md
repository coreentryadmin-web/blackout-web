# Swing `technicalsCoaching` narrative omits MACD, the dissenting vote in its own bias score

> **kind:** FINDING

## Status
FIXED — PR pending (`fix/swing-technicals-coaching-omits-macd`).

## Root cause
`technicalsBias()` (`src/lib/swing/play-brief-technicals.ts`) computes the "chart reads
bullish/bearish/neutral" verdict from FOUR independent votes: `emaStack`, `macd`, spot-vs-`vwap`,
and `structure.direction`. But `technicalsCoaching()` (`src/lib/swing/play-brief-narrative-coaching.ts`,
the function that renders the human-readable "Chart read" line inside the swing play brief's
"Trade manager read" narrative section) only ever printed THREE of those four inputs — VWAP, RSI,
emaStack, structure — and never MACD, even though MACD's vote fully participates in the printed
verdict. A MACD vote that *dissents* from the other three (e.g. bear MACD inside an otherwise
bull emaStack/VWAP/structure read) is invisible to the reader: the narrative says "chart reads
bullish" with no way to see that one of the four inputs behind that verdict disagreed.

This is the same defect class already fixed 8x this session for Largo C2 (a value feeding a
directional claim without the claim showing its work / staleness) — here it's not staleness but
**incompleteness**: the verdict's own inputs aren't all surfaced, so the reader can't audit it.

## Evidence
Live production repro, 2026-09-06 (`SWING:NRG:34`, `GET /api/market/swing/play-brief?playId=SWING:NRG&ticker=NRG`):
- `technicals` fixture matching the live NRG read: `emaStack: "up"`, `macd: "bear"`, spot 118.95
  above VWAP 117.08, `structure.direction: "up"` → 3 bull vs 1 bear → `technicalsBias` correctly
  returns `"bullish"`.
- The rendered "Chart technicals" (raw) section on the SAME brief separately prints `MACD: **bear**`
  — so the data IS present and IS a real disagreement — but the narrative's own "Chart read — ...
  chart reads bullish (aligns with swing direction)." line never mentions it.
- Regression test `technicalsCoaching: dissenting MACD must be visible even when it loses the
  bull/bear vote (2026-09-06 live NRG repro)` in `play-brief-narrative-coaching.test.ts`:
  RED before fix (asserting `/macd\s*\*\*bearish\*\*/i` against the rendered line failed — the
  string never contained "macd" at all), GREEN after (added `MACD **bearish**` to the `parts` list
  alongside the existing VWAP/RSI/emaStack/structure). Full `src/lib/swing/*.test.ts` suite:
  767/767 pass (was 766/766 pre-fix). `npx tsc --noEmit` clean.

## Blast radius
Single function, `technicalsCoaching()`. No other call site renders this line independently
(`vector-desk-intel.ts`'s own `MACD bullish/bearish` print is a separate, unrelated Vector-desk
narrative path that already surfaced MACD correctly — confirms the omission was local to the
swing brief's coaching function, not a systemic MACD-hiding bug).

## Fix rationale
Added the MACD line to `technicalsCoaching`'s `parts` array using the same
`t.macd === "bull" ? "bullish" : "bearish"` phrasing `vector-desk-intel.ts` already uses elsewhere,
so the fix is consistent with the existing convention rather than inventing new wording. Left
`technicalsBias()` itself untouched — its scoring was already correct; only the narrative's
transparency into that scoring was incomplete.
