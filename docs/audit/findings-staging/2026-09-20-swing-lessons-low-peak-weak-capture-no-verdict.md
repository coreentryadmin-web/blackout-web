> **kind:** FINDING

## Ask Largo swing "Lessons" section silently dropped its verdict for a small-peak, weakly-captured closed trade — PR TBD — fix/swing-lessons-low-peak-capture-gap — 2026-09-20

| | |
|---|---|
| **Status** | FIXED |
| **Severity** | P3 |
| **Area** | Swing / Ask Largo play-brief |

**What was broken:** `lessonsSection` (`src/lib/swing/play-brief-intel.ts`) renders a "Lessons" retrospective for every CLOSED swing position. Its `capture` outcome branch had three cases — `capture >= 75`, `capture < 35 && play.peak > 20`, and `35 <= capture < 75` — but no case at all for `capture < 35 && play.peak <= 20`. A closed trade whose peak never got big enough to plausibly reach a trim rail (correctly excluded from the "tighten at first trim rail" advice, which would be nonsensical there) fell all the way through the if/else chain with nothing pushed beyond the bare `MFE capture: X% of peak move` fact — no verdict, no advice, unlike every other capture band (including the sibling `round_trip` outcome kind in the same function, which already has an explicit low-peak exception with its own wording).

The sibling function `closedCoaching` (`play-brief-narrative-coaching.ts`, the "Trade manager read" section for closed plays) does not have this gap — its equivalent capture branch is exhaustive via a plain catch-all `else` ("MFE capture X% — review runner vs trim policy"). `lessonsSection`'s chain was the only one of the two with a hole.

**Live evidence:** Checked the real 90-day closed-position population (`GET /api/market/swing/record?days=90`, 36 closed swing chains) for the exact `peak <= 20% && capture < 35%` combination — none currently exist. Every low-peak closed trade in the live population either round-tripped to a loss (handled by the `round_trip` outcome kind, which already has the low-peak exception) or nearly fully captured its small peak (landing in the `>= 75%` band). This is a real, confirmed code-path gap caught by comparing the two sibling functions' logic, not yet observed live — the next closed trade shaped like "peak +12%, exit +3%" would have hit it.

**What changed:** Added the missing `else` branch inside `capture < 35`, gated on `play.peak > 20` the same way the existing "Gave back the move" branch is, with its own distinct message for the low-peak case: `"**Small move, weakly captured** — the peak never reached a trim rail; review entry timing or thesis strength instead."` — reusing the same "a trim rail wouldn't have fired" framing this file's `round_trip` branch already established for the identical `peak <= 20` constraint, so the reasoning is consistent across both outcome kinds. Left unconditional (no `alreadyNoted` dedup flag), matching the sibling `"Partial capture"` branch below it — `closedCoaching`'s own text for this exact bucket is the unrelated generic "review runner vs trim policy" phrase, so there is no restatement risk to gate against.

**Blast radius:** Only `lessonsSection`'s capture branch changed. Additive (one new `else` arm) — cannot affect any other capture band, the `round_trip` kind, or any other section.

**Evidence:**
- New regression test in `src/lib/swing/play-brief-intel.test.ts`: `"lessonsSection: a small peak (<=20%) with weak capture (<35%) still gets a verdict line, not just the bare fact"`.
- RED→GREEN proven via `git stash` (reverting only the source fix): 1/171 tests in `play-brief-intel.test.ts` failed pre-fix, 171/171 pass post-fix.
- Full suite: `npm test` → 14900 pass / 0 fail / 3 skipped (pre-existing, unrelated).
- `npx tsc --noEmit` → clean.
