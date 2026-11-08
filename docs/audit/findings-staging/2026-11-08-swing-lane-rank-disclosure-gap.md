> **kind:** FINDING

## Ask Largo swing play-brief: `collapseRedundantIntelSections` drops "Lane rank" and falsely claims it was "folded into Trade manager read" for a comfortably-good-but-not-top-3 position — FIXED

| | |
|---|---|
| **Area** | Night Hawk Swings — Ask Largo swing play-brief narrative pipeline |
| **Status** | FIXED |
| **File** | `src/lib/swing/play-brief-intel-collapse.ts` (`collapseRedundantIntelSections`), `src/lib/swing/play-brief-intel.ts` (`buildIntelSections`, call site) |

### Root cause

`collapseRedundantIntelSections` drops every section whose title is in the static
`NARRATIVE_COVERED_TITLES` set whenever a narrative ("Trade manager read") is present for a
non-closed bucket, and then unconditionally appends a note claiming the dropped content was
"folded into Trade manager read above." `"Lane rank"` is in that set, on the assumption that
`laneRankCoaching` (`src/lib/swing/play-brief-narrative-coaching.ts`) always narrates the same
rank/score/median/leader facts `laneRankSection` renders as a standalone section.

That assumption is false for one real, common band. `laneRankCoaching` only produces a bullet on
four branches: `rank === 1`, `deltaFromMedian < -15` (two variants), or
`(rank <= 3 && deltaFromMedian >= 10)`. A position that is comfortably good — well above the lane
median (`deltaFromMedian >= 10`) — but **not** top-3 by rank (e.g. `rank === 5`) falls through
every branch and the function returns `null`, deliberately: this is an editorial choice (not every
honest rank fact earns a bullet), not a bug in `laneRankCoaching` itself. But
`collapseRedundantIntelSections` still dropped the full "Lane rank" section (real rank, score,
lane median, desk leader) for that position and still claimed it was folded into the narrative —
a disclosure that was simply false whenever this band was hit, silently costing the member/Largo
real, correct lane-rank data with an incorrect "it's available elsewhere" claim.

### Evidence (RED → GREEN)

**Live repro (2026-11-08), position MRVL, positionId 70, SHORT, real native swing ledger:**
`GET /api/market/swing/play-brief?playId=SWING:MRVL&ticker=MRVL&positionId=70&status=OPEN` — the
default response has 12 sections, and "Trade manager read" ends with the "folded into Trade
manager read" note. The SAME request with `&expandIntel=1` has 14 sections — the two extra are
"Lane rank" and "Hold plan". "Hold plan"'s content genuinely appears verbatim in "Trade manager
read" (that disclosure is correct). "Lane rank" does **not** appear anywhere in "Trade manager
read"'s body — its real content ("#5 of 40 on OPEN lane · score 78 (+15.1 vs median)", "Lane
median: 63", "Desk leader: UVIX @ 89") is nowhere in the narrative text, confirming the false
claim.

**Regression tests:**

- `src/lib/swing/play-brief-narrative-coaching.test.ts` — new test proves the root cause in
  isolation: a fixture pinned to exactly `rank: 5`, `deltaFromMedian: 15.1` (same shape as the
  live MRVL repro) makes `laneRankCoaching` return `null`, by design.
- `src/lib/swing/play-brief-intel-collapse.test.ts` — 4 new tests on
  `collapseRedundantIntelSections`'s new `laneRankFolded` option:
  - `laneRankFolded: false` with another covered title present → "Lane rank" survives, the note
    still fires for the other title and its count reflects only what was actually dropped (`"for
    1 section folded"`, not 2).
  - `laneRankFolded: false` as the only covered title present → nothing dropped, no note
    appended at all (a dropped-count of 0 must not emit a note).
  - Omitting `laneRankFolded` entirely → same safe outcome as explicit `false` (a forgetful
    caller never loses the section or gains a false claim).
  - `laneRankFolded: true` → "Lane rank" still collapses and the note still fires, unchanged
    from the pre-fix behavior for the case where the claim is actually true.

**RED → GREEN proof:** reverted only `src/lib/swing/play-brief-intel-collapse.ts` to its pre-fix
state (via `git show HEAD:...` over the working file, source only — tests untouched) and re-ran
`src/lib/swing/play-brief-intel-collapse.test.ts`: **7 pass / 3 fail** — the three new negative
tests (false/omitted `laneRankFolded` must keep the section) failed exactly as expected; the
`laneRankFolded: true` test passed vacuously (old code drops unconditionally regardless of any
option), matching the same vacuous-pass shape this repo's sibling collapse fixes document for
their own staleness-suppression tests. Restoring the fix: **10/10 pass**.

**Full suite runs post-fix:**
- `play-brief-intel-collapse.test.ts` + `play-brief-narrative-coaching.test.ts` +
  `play-brief-intel.test.ts` + `play-brief.test.ts` + `play-brief-narrative.test.ts` +
  `play-brief-lane-rank.test.ts`: **985/985 pass**.
- `npx tsc --noEmit`: clean.

### Blast radius

Single call site for the fix itself — `buildIntelSections`'s one call to
`collapseRedundantIntelSections` (`play-brief-intel.ts`). No other caller of
`collapseRedundantIntelSections` exists repo-wide.

**Confirmed via grep: two other titles in `NARRATIVE_COVERED_TITLES` show the same static-list-
vs-real-predicate shape, left unfixed here (separate follow-ups, not the exact same one-line
pattern as this fix):**

- **"Wall dynamics"** — `wallDynamicsCoaching` (play-brief-narrative-coaching.ts:1471-1473)
  requires `vec.wallEvents.length >= 2` to render, while `wallDynamicsSection`
  (play-brief-intel.ts:3324-3325) renders with just `events.length >= 1`. A ticker with exactly
  one real wall-transition event gets a real "Wall dynamics" section but a silent `null` from the
  coaching bullet — the same false "folded in" shape, one event-count off.
- **"Vector desk"** — `vectorPlayCoaching` (play-brief-narrative-coaching.ts:579) returns `null`
  outright whenever the Vector snapshot is stale, while `vectorDeskSection`
  (play-brief-intel.ts:3393-3398) still renders real content (last-snapshot grade/conviction) on
  a stale snapshot for non-closed buckets. A stale-but-not-dead WATCH/OPEN play can have a real
  "Vector desk" section with nothing narrated about it.

**Also noting, not fixing:** this title is separately named as an UNFIXED, already-known
MAX_BULLETS-starvation candidate in
`docs/audit/findings-staging/2026-11-01-swing-flow-narrative-helix-tape-reserved-bullet.md`'s own
blast-radius section (`laneRankCoaching` is funneled through `tradeManagerNarrativeSection`'s
generic `collectCoachingBullets` loop with no `{ reserved: true }`, so a real, non-null
`laneRankCoaching` bullet can still be dropped by the 14-bullet cap if 14+ other coaching bullets
fire first). This fix's `laneRankFolded` check only recomputes whether `laneRankCoaching` *would*
produce a bullet, not whether that bullet survives the cap — a narrower, different root cause
(cap-starvation vs. this fix's deliberate-editorial-silence) that would need its own dedicated fix
(pulling the lane-rank bullet out of the generic loop to mark it reserved, mirroring the
dealer-posture/HELIX-tape precedent) rather than being folded into this already-scoped PR. It does
not make this fix incorrect — before this PR the false claim fired unconditionally in this band
too; after this PR it only remains possible in the much narrower (15th+ bullet) cap-starvation
case, which is a strict improvement, not a regression.

### Fix rationale

Mirrors the established remediation shape for this exact file's prior three fixes for other
titles (GEX posture's VEX/DEX/CHARM + net-GEX/session-change% parity, "Flow & positioning"'s
notable-prints/anomalies) — but those fixes threaded the *missing content* into the narrative
function so the existing "folded into Trade manager read" claim became unconditionally true.
That approach doesn't apply here: `laneRankCoaching`'s silence in this band is an explicit,
deliberate editorial decision (own doc comment, "not every real, honest rank/score fact earns a
bullet"), and the task explicitly rules out changing its thresholds. So the fix instead makes the
*collapse decision* track reality: the caller (`buildIntelSections`) recomputes the exact same
predicate `laneRankCoaching` uses — a direct function call, not a string-match against
`narrative.body` (this file's own `*AlreadyNoted` comments document why prose string-matching
drifts the moment a bullet's wording is reworded) — and passes it down as `laneRankFolded`. The
collapse function defaults to the *safe* outcome (keep the section, never claim an unproven fold-
in) when the flag is omitted or false, so a future caller that forgets to pass it loses only the
collapse optimization for this one title, never gains a false claim. Every other title in
`NARRATIVE_COVERED_TITLES` keeps its original unconditional-drop behavior unchanged.
