## 2026-10-25 — [FINDING, P3 Night Hawk Swings / Ask Largo] Lane-rank/leader lines displayed the raw one-decimal score, disagreeing with "Why this setup"'s rounded display of the same fact — FIXED

> **kind:** `FINDING`

| Field | Detail |
|---|---|
| **Area** | Swing play-brief "Lane rank" section (`laneRankSection`, `src/lib/swing/play-brief-lane-rank.ts`) and the "Trade manager read" rank/leader bullet (`laneRankCoaching`, `src/lib/swing/play-brief-narrative-coaching.ts`) |
| **Found by** | Ask Largo × Night Hawk Swings standing ownership mandate — parallel correctness sweep + adversarial verify pass, 2026-10-25 (live repro SOXX: "Setup score: 74..." in "Why this setup" vs "score **73.7**" in "Lane rank") |

### Symptom

The same brief showed one play's own score as two different numbers: `whyThisSetupSection`'s lede
("...scoring 74.") rounds `play.score` to the nearest integer, while `laneRankSection`/
`laneRankCoaching` rendered `computeLaneRank`'s `playScore` field verbatim — raw, one-decimal
precision sourced from `laneRows` (`HorizonPlay[]`), e.g. "score **73.7**" for the identical
measurement three sections later in the same document.

### Root cause

`computeLaneRank`'s `playScore` field is DELIBERATELY kept at laneRows' raw precision (2026-09-17
fix, regression-tested in `play-brief-lane-rank.test.ts`) so `deltaFromMedian` — computed from
that same raw value against `medianScore` (also raw-derived) — stays internally consistent and
doesn't round-trip through a differently-rounded type. That fix was correct and is untouched here.
What it never addressed: every render call site (4 total, across two files) printed that same raw
`playScore` straight into member-facing text, where it collides with `play.score`'s independent,
separately-rounded display convention used everywhere else in the brief (`whyThisSetupSection`'s
lede, the "Setup score" evidence[] fact).

### Fix

Rounds the score ONLY at the point of display (`Math.round(snap.playScore)`), at all 4 call sites:
`laneRankSection`'s base rank line, and `laneRankCoaching`'s rank-1 "Lane leader" and "Below lane
median" branches. `deltaFromMedian`/`medianScore` (computed from the raw value, inside
`computeLaneRank`, before this change) are completely untouched — they were never duplicated
elsewhere in the brief, so their own one-decimal precision was never in question. `snap.topScore`
(a different ticker's score) is also left untouched — out of scope for this fix, which is
specifically about THIS play's own score agreeing with itself across sections.

### Blast radius

Scoped to the 4 identified render sites. `computeLaneRank`'s own returned `playScore`/
`deltaFromMedian`/`medianScore` fields are unchanged — the existing 2026-09-17 regression test
(`"computeLaneRank: playScore uses the raw laneRows precision..."`) still passes untouched, since
it tests the function's return value, not any rendered text.

### Tests

- `play-brief-lane-rank.test.ts` — new test: `laneRankSection`'s rank line rounds 25.5→26 to match
  `whyThisSetupSection`'s convention, while the rendered `deltaFromMedian` (-24.1) keeps its own
  raw precision. Confirmed RED on pre-fix code (rendered "score **25.5**"), GREEN after.
- `play-brief-narrative-coaching.test.ts` — 2 new tests: `laneRankCoaching`'s rank-1 "Lane leader"
  branch and its "Below lane median" branch both round the displayed score. Both confirmed RED
  (rendered the raw decimal verbatim), GREEN after.

Full `src/lib/swing/*.test.ts` (2046 tests) and `npx tsc --noEmit` both pass clean.
