> **kind:** FINDING

## Ask Largo swing brief — closed-play "round-tripped past breakeven" fact restated verbatim in two sections — FIXED

| | |
|---|---|
| **Status** | FIXED |
| **Area** | Ask Largo swing play-brief CLOSED-bucket narrative (`src/lib/swing/play-brief-narrative-coaching.ts`'s `closedCoaching`, `src/lib/swing/play-brief-intel.ts`'s `lessonsSection`) |
| **Severity** | P3 (narrative quality — same "trade manager states a fact once" anti-pattern already fixed once this cycle for the Vector-conflict case, PR #4650, now found in a second, independent pair of sections) |

### Root cause

Two independently-composed functions both derive the SAME post-mortem fact from the SAME
`play.peak`/`play.exitPnlPct` inputs via the SAME shared helper (`mfeCaptureOutcome`), with zero
cross-awareness:

- `closedCoaching` (`play-brief-narrative-coaching.ts`) — feeds the "Trade manager read" section,
  built FIRST in `buildIntelSections` (`play-brief-intel.ts` line 817, well before the "Lessons"
  section is built at line ~894).
- `lessonsSection` (`play-brief-intel.ts`) — feeds the "Lessons" section, built for CLOSED plays
  only.

When `mfeCaptureOutcome` classifies the exit as a `round_trip` (was up at peak, closed negative),
both functions render a `**Round-tripped past breakeven**` sentence quoting the identical
peak/exit percentages, near word-for-word.

**Live repro (AAPL:36 closed play brief, 2026-09-09, standing Ask Largo deep-dive cycle):**
```
=== Trade manager read ===
• Exited **-56.2%** vs peak **+1.3%** **Round-tripped past breakeven** — was up **+1.3%** at
  peak, closed at **-56.2%**; tighten at first trim rail next time. ...

=== Lessons ===
Peak was **+1.3%** · exited **-56.2%**
**Round-tripped past breakeven** — up **+1.3%** at peak, closed at **-56.2%**.
**Gave back the move** — next time tighten at first trim rail or thesis fade.
...
```
The identical fact — this trade round-tripped past breakeven — appears in both the "Trade manager
read" and "Lessons" sections of one document.

**Notably, this exact restatement class was already anticipated and avoided for a DIFFERENT pair
of facts in the same function** — `buildIntelSections`'s own comment at (pre-existing) line 498-500
explicitly says the thesis-health advisory "is NOT repeated here — it's the exact sentence
tradeManagerNarrativeSection's pillar-fade narration already carries." The round-trip sentence was
simply missed when that discipline was applied.

### Fix

Same threading pattern as PR #4650 (Vector-conflict dedup, merged this cycle) and the pre-existing
thesis-health precedent above: `buildIntelSections` already computes `narrative` (the composed
"Trade manager read" `RichSection`) BEFORE calling `lessonsSection`, so no new coupling was needed
— just check the already-available `narrative.body` for the sentence and pass a boolean through:

```ts
const roundTripAlreadyNoted = narrative?.body?.includes("Round-tripped past breakeven") ?? false;
const lessons = lessonsSection(play, roundTripAlreadyNoted);
```

`lessonsSection` gained an optional `roundTripAlreadyNoted?: boolean` parameter that suppresses
ONLY the redundant sentence — every other line in "Lessons" (peak/exit summary, "Gave back the
move" coaching, exit-reason line, archetype tag) is independent evidence and renders unchanged.

### Evidence

- New regression test `lessonsSection: omits the round-trip sentence when the Trade manager read
  section already stated it, but keeps the rest` (`play-brief-intel.test.ts`) — proves the sentence
  is present with no suppression, absent with suppression, and that the rest of the section (gave
  back the move / stop loss / archetype tag) survives in both cases.
- RED→GREEN proven via `git stash` (source-only revert): 1 failure pre-fix, 0 post-fix, 62/62 in
  the file.
- `npx tsc --noEmit`: clean.
- Full `src/lib/swing/*.test.ts` suite: 827/829 pass; the 2 failures (`ex-dividend-reads.test.ts`,
  `play-brief-resolve.test.ts`) are pre-existing on unmodified `origin/main` (confirmed earlier this
  session via the same isolation) and unrelated to this change.

### Blast radius

One function (`lessonsSection`), one call site (inside `buildIntelSections`) — grepped for every
other `lessonsSection(` reference; none found outside this file and its test.
