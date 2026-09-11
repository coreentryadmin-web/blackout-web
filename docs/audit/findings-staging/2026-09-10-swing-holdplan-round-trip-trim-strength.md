> **kind:** FINDING

## Ask Largo swing brief — "Hold plan" round-trip bullet said "trim into strength" after already saying the strength was gone — FIXED

| | |
|---|---|
| **Status** | FIXED |
| **Lane** | Night Hawk Swings / Ask Largo play-brief, "Hold plan" section |
| **Severity** | P2 — member-visible contradictory guidance on a real open production position, no incorrect data |
| **Found by** | Live OPEN-position "Hold Plan / Watch Levels" cross-section consistency check (5-engine live monitor, Ask Largo mandate), `GET /api/market/swing/play-brief?playId=SWING:NN&ticker=NN&positionId=32&status=OPEN`, 2026-09-10 23:4x UTC

### What was broken

`holdPlanSection()` in `src/lib/swing/play-brief-intel.ts` computes the exact same
`mfeCaptureOutcome` giveback the "Trade manager read" narrative already computes, and for the
`round_trip` case rendered:

```
**Round-tripped past breakeven** — was up **24%** at peak, now **-54%** — consider trim into strength
```

"Consider trim into strength" tells the member to bank a partial gain while "in strength" — but
the clause immediately before it says the play has already round-tripped PAST breakeven into a
**loss**. There is no strength left to trim into by the time this sentence is read. Live capture,
NN (`SWING:NN:32`, real committed position, entry $1.95, mark $0.90, peak +24.4%, live P&L -53.8%).

### Root cause — this is the SAME bug class already fixed once, in a sibling call site the earlier fix's blast-radius check missed

This is not a new defect pattern — it is the exact contradiction already found and fixed on
**this same NN position** earlier the same day
(`docs/audit/findings-staging/2026-09-10-swing-trim-strength-line-vs-round-trip.md`,
`actionNarrative`'s TRIM branch in `src/lib/swing/play-brief-narrative.ts`). That fix's own
"Blast radius" section stated *"Single call site (`actionNarrative`'s TRIM branch)... `SELL` and
the default `HOLD` branches were not touched; they don't carry an analogous 'still near peak'
claim to contradict."* — true for `play-brief-narrative.ts`, but it did not check whether any
*other file* independently computed the same `mfeCaptureOutcome` giveback and rendered its own
"into strength" claim. `play-brief-intel.ts`'s `holdPlanSection` does exactly that, at a call site
the original fix never looked at (different file, different section, same underlying fact).
`play-brief-narrative.ts` had already been corrected to say **"consider protecting what's left"**
for this exact case — `play-brief-intel.ts` was never brought in line with it.

### Fix

Changed `holdPlanSection`'s `round_trip` branch trailing clause from "consider trim into
strength" to "consider protecting what's left" — matching the wording
`play-brief-narrative.ts`'s SELL branch already uses for the identical fact, so the two
sections describing the same play no longer contradict each other. The `capture` branch
(giveback <70%, still in profit) was deliberately left unchanged — "trim into strength" is
factually correct there (the play has NOT round-tripped into a loss), same reasoning the
original fix used to scope itself to the `round_trip` case only.

### Evidence

New assertions in `src/lib/swing/play-brief-intel.test.ts` ("holdPlanSection: round-trip bullet
renders" test): `assert.doesNotMatch(section!.body, /consider trim into strength/)` +
`assert.match(section!.body, /consider protecting what's left/)`. RED before the fix (git-stash
proof — asserted the "into strength" phrase was absent, got it present), GREEN after. Full swing
suite + full `npm test` (13675 pass / 0 fail) + `npx tsc --noEmit`: clean.

### Blast radius

Single call site (`holdPlanSection`'s `round_trip` branch). Every other `mfeCaptureOutcome` call
site in the swing lane was re-checked (`grep -rn "mfeCaptureOutcome" src/lib/swing/*.ts`): the
`capture` branch (same function, `giveback.capturePct < 70`), `lessonsSection` (CLOSED plays, its
own independent "tighten at first trim rail next time" trailing clause — forward-looking advice
for the next trade, not a contradiction), and `play-brief-narrative-coaching.ts`'s two call sites
(`underlyingTapeCoaching`'s "option round-tripped past breakeven" aside and the CLOSED post-mortem
line) all render neutral/factual trailing text with no "still in strength" claim — none of them
pair that claim with an already-realized round-trip in the same sentence.

### Why this and not something bigger

Considered re-checking every other `mfeCaptureOutcome` call site in the swing lane for the same
class of contradiction rather than fixing only `holdPlanSection` — did check
(`grep -rn "mfeCaptureOutcome" src/lib/swing/`): the other two call sites
(`play-brief-narrative-coaching.ts`'s CLOSED coaching, and `lessonsSection`'s CLOSED post-mortem)
render only in `roundTripAlreadyNoted`-aware or CLOSED-only paths with their own distinct trailing
text, neither of which claims "into strength" — so this fix is the complete remaining instance of
the bug, not a partial one.
