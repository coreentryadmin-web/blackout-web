> **kind:** FINDING

## Night Hawk Legacy — grounding CHECK 6 hard-drops a play over an unrelated catalyst number — FIXED

| | |
|---|---|
| **Status** | FIXED |
| **Severity** | P1 (live, cost two higher-scored candidates their publication) |
| **Surface** | `src/features/nighthawk/lib/grounding.ts` — CHECK 6 (prose-vs-structured strike divergence) |

### Root cause

CHECK 6 tests `hasStrikeWord` (does `/\b(call|put|strike)s?\b/i` appear anywhere in the
**combined** `thesis + " " + key_signal` text) and then scans **every** numeric token in that
same combined text for a value that: sits in the plausible strike range (`[spot*0.5, spot*2]`),
is not `%`/`$`, isn't the grounded strike, and isn't any real chain strike. If it finds one, it
hard-drops the whole play with "prose references N near a strike claim ... dropping user-visible
contradictory setup text."

Nothing in the check required the flagged number and the strike-word to be in the **same
sentence** — only that both exist somewhere in the combined text. So a completely unrelated,
legitimate catalyst/guidance figure in one sentence ("guidance raised to 410"), paired with an
unrelated "heavy call buying" mention in a different sentence, reads identically to an actual
contradictory strike echo ("calls at 410") to this check.

### Evidence

Live: tonight's (2026-10-14 edition) CloudWatch det-edition build log showed AXTI (score 73,
`rank_governor` #1) and BE (score 69, #2) — both higher-scored than every play that actually
published (CLS 59, VST 59, AMD 56) — built successfully then dropped by this exact check:
"AXTI prose references 74 near a strike claim but the grounded contract strike is 65 and 74 is
not in the chain" / "BE prose references 315.4 ... grounded contract strike is 265." Journaled as
`legacyGroundingDropsTopScoredCandidates_2026_10_14` (REPORT AND HOLD) pending a controlled
reproduction.

Reproduced directly against `groundPlay()` with a synthetic play (real NBIS fixture already in
`grounding.test.ts`, strike 300):
```
thesis: "Heavy call buying ahead of earnings signals bullish positioning."
key_signal: "Management raised full-year guidance to 410 in yesterday's update."
```
→ `severity: "drop"`, `"NBIS prose references 410 near a strike claim but the grounded contract
strike is 300 and 410 is not in the chain — dropping user-visible contradictory setup text."` —
410 has nothing to do with the strike; it's a guidance figure in an entirely separate sentence
from the word "call." This is a byte-for-byte reproduction of the AXTI/BE shape.

### Fix

Scope both the `hasStrikeWord` test and the number extraction to the **same sentence/clause**
(split on `.`/`!`/`?`/newline) instead of the whole combined text. A genuine same-sentence strike
echo ("Calls at 410 are the trigger") still drops — covered by the pre-existing test
("groundPlay drops contradictory user-visible prose strike claims"). A cross-sentence unrelated
number no longer does — new test ("groundPlay does NOT drop an unrelated catalyst number merely
because a strike word appears in a different sentence").

### Blast radius

Single call site — CHECK 6 is only read inside `groundPlay()`, batch-wrapped by `groundPlays()`
(which removes any `severity: "drop"` play from the published list). No other check in this file
shares this pattern closely enough to need the same fix: CHECK 6's own IV-rank sub-check (just
above, lines ~398-413) tests `/iv\s*rank|ivr|implied/i` against the combined text too, but that
one's own number scan is already localized to %-tokens specifically flagged against a single
`groundedIv` value, not an open-ended strike-range scan — left unchanged, out of scope for this
fix (no live evidence of a problem there).

### Not fixed/changed

The grounding layer itself is a deliberate safety layer, not disabled or loosened — a real
contradictory strike claim in the same sentence as the number still hard-drops exactly as before.
Nothing about CHECK 1-5 touched.
