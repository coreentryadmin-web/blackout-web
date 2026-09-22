> **kind:** FINDING

## Ask Largo — Night Hawk Swings: `crossDeskCoaching`'s Vector-dedup guard fails when Vector is demoted to a "rest" conflict — FIXED

**Status:** FIXED

### Root cause

`crossDeskCoaching` (`src/lib/swing/play-brief-narrative-coaching.ts`) ranks conflicting desks by
load-bearing weight (`renderCrossDeskConflict`) and renders the **lead** conflict in one phrasing —
`` `${lead.desk} ${lead.claim}` `` → `"Vector bearish (...)"` — and any **demoted** conflict in a
different phrasing — `` `${c.desk} also reads ${c.claim}` `` → `"Vector also reads bearish (...)"`.

Two separate dedup guards exist to stop `vectorPlayCoaching` (this file) and `counterThesisLine`
(`play-brief-narrative.ts`) from re-quoting the same Vector headline `crossDeskCoaching` already
named in its "Cross-desk friction" bullet — the fix that landed 2026-09-09/2026-09-13 for the
"triple restated" duplication bug. Both guards detected "already noted" by regex-matching the
**rendered text** for the literal substring `Vector bearish`/`Vector bullish`:

```
/Vector (bearish|bullish)/
```

That regex only matches the **lead**-conflict phrasing. It does not match
`"Vector also reads bearish (...)"` — the phrasing used whenever another desk outranks Vector's own
weight. Vector's evidence kind (`"structure"`) carries the highest base weight (3) of the four
kinds, so it is the lead for every archetype except one: `FLOW_ACCUMULATION`, whose archetype bonus
(+2) goes to HELIX's `"flow"` kind instead, giving HELIX 2+2=4 > Vector's un-bonused 3. So a
`FLOW_ACCUMULATION` swing where **both** HELIX and Vector conflict with the swing direction demotes
Vector to the "rest" clause — and both dedup guards silently read that brief as "Vector was never
noted," reopening the exact duplication their own fix comments say was closed.

### Evidence

Live repro built directly against the real functions (LONG swing, `archetype: "FLOW_ACCUMULATION"`,
Vector bias `short`/headline `"Fade the rip"`, HELIX put-heavy flow):

```
crossDeskCoaching(...) →
"**Cross-desk friction** — HELIX put-led. ... Vector also reads bearish (Fade the rip)
 (live price structure — the same tape this swing itself trades) — lighter weight here."

/Vector (bearish|bullish)/.test(<above>) → false   (should be true)
```

With the old regex, `vectorConflictAlreadyNoted` came back `false`, and
`collectCoachingBullets`'s full output for this scenario carried BOTH:
```
• **Cross-desk friction** — HELIX put-led. ... Vector also reads bearish (Fade the rip) ...
• Vector desk: **Fade the rip**
```
— the identical headline stated twice in the same document, one sentence apart. Confirmed via a
RED→GREEN test (`git stash` on the two source files, regression test still fails pre-fix / passes
post-fix): `src/lib/swing/play-brief-narrative-coaching.test.ts` — "collectCoachingBullets:
Vector-conflict headline still duplicates when a FLOW_ACCUMULATION archetype demotes Vector below
HELIX in the friction ranking".

### Blast radius

Both call sites read the identical rendered text with the identical brittle regex and both needed
the identical fix:
- `src/lib/swing/play-brief-narrative-coaching.ts` — `composeCoachingBullets`'s
  `vectorConflictAlreadyNoted`, threaded into `vectorPlayCoaching`.
- `src/lib/swing/play-brief-narrative.ts` — the sibling `vectorConflictAlreadyNoted` derivation,
  threaded into `counterThesisLine` (per that function's own doc comment, it derives the identical
  guard independently rather than importing the other file's).

### Fix rationale

Widened both regexes to `/Vector (?:also reads )?(bearish|bullish)/`, matching both
`renderCrossDeskConflict` phrasings without changing anything else about detection (still requires
a real, rendered Vector-conflict substring — it cannot false-positive on an unrelated "Vector ..."
mention since only these two phrasings ever appear in `crossDeskCoaching`'s output).

**Alternative considered and rejected:** deriving the dedup guard from the `CrossDeskConflict[]`
array directly (a structural check) instead of regexing rendered prose, which would be more
robust against a future phrasing change to `renderCrossDeskConflict`. Rejected for THIS pass as a
larger refactor (`crossDeskCoaching` would need to expose its internal conflicts, or both dedup
sites would need to re-run desk-conflict detection themselves) than the bug warrants — flagged here
as a genuine follow-up if `renderCrossDeskConflict`'s phrasing changes again and trips this same
class of guard-drift a third time.

**Not touched:** `renderCrossDeskConflict`'s own phrasing (both call sites' dedup guards adapted to
it, not the other way — changing the desk-conflict prose itself was out of scope for a dedup-only
bug).

### Files
- `src/lib/swing/play-brief-narrative-coaching.ts`
- `src/lib/swing/play-brief-narrative.ts`
- `src/lib/swing/play-brief-narrative-coaching.test.ts` (regression test)
