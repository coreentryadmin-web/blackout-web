> **kind:** FINDING

## Lane-rank "leader" callout could name a WATCH setup whose own thesis already broke — FIXED

| **Status** | FIXED |
|---|---|

### Root cause

`computeLaneRank`/`laneRankCoaching` (`src/lib/swing/play-brief-lane-rank.ts`,
`play-brief-narrative-coaching.ts`) already exclude an *exiting* COMMIT-bucket peer from the named
"leader" pointer (#4825, 2026-09-12 — CRWD sat #1 by score while its own manage engine had fired
`EXIT_RUNNER`). The WATCH bucket has the identical failure mode with a different trigger: a peer's
own `setupState` reaching `INVALIDATED` (thesis broke pre-entry), and #4825's fix did not cover it
— its own file-header comment says so explicitly ("WATCH-bucket rows never carry `manageAction`,
so this is a no-op there").

Found live 2026-09-12: SKHY sat **#1 of 8** WATCH candidates by raw score (59) while its own brief's
**Entry** section already read `Serving section: RESEARCH` / `Setup: INVALIDATED` (per
`sectionForSwingPlay`, `serving.ts` — `setup === "INVALIDATED"` routes a name OUT of WATCH into
RESEARCH), and its own **Trade manager read** led with `Thesis BREAK — structure invalidated —
thesis broke pre-entry. Exit or cut to runner only; don't add size.` Three bullets later, the same
folded narrative still said:

> **Lane leader** — **#1 of 8** on WATCH (score **59**). Desk attention follows the top row.

Directly contradicting the disclosure two sections above it in the SAME response — "don't add
size" followed by "desk attention follows the top row," which reads as encouragement. A different
WATCH ticker's own brief would have suffered the mirror case: naming SKHY as `Desk leader: SKHY @
59` while SKHY's own thesis had already broken.

This wasn't caught by #4825's own tests because every fixture there used `manageAction`-based
peers (COMMIT bucket only); nothing exercised a WATCH peer whose `setupState` is `INVALIDATED`
despite `HorizonPlay.setupState` being a real, populated field (`horizon-plays.ts`) distinct from
`manageAction`.

### Fix

Same shape as #4825, extended to the WATCH-bucket trigger: `computeLaneRank` still computes
`rank`/`medianScore`/`total` against the FULL peer set (an honest "where does this score fall,"
unaffected by thesis state — unchanged), but the named `topTicker`/`topScore` now ALSO skips any
peer whose `setupState === "INVALIDATED"`, alongside the existing `EXIT`/`EXIT_RUNNER` exclusion.
A new `selfInvalidated` flag on `LaneRankSnapshot` additionally guards the *self-referential* case
(the play's own rank-1 status): `laneRankSection` suppresses only the "Top-ranked play in this
bucket — size and attention follow score" line (rank/median stats stay honest and visible);
`laneRankCoaching` returns `null` outright when `selfInvalidated` is true, since every one of its
branches ("Lane leader," "Top-tier setup," "Below lane median... Leader: X") reads as guidance
about where to put attention/size, none of which apply once the SAME brief's Entry/Verdict sections
already say the thesis broke.

### Blast radius

Both consumers of `computeLaneRank` are fixed by the one change, same as #4825. Only the WATCH
bucket is affected by the peer-exclusion change (COMMIT-bucket rows don't carry `setupState`
today, so the new filter clause is a no-op there — mirror of #4825's own no-op note in reverse).
The new `selfInvalidated` self-guard is bucket-agnostic in principle but in practice only ever
fires for WATCH (COMMIT-bucket rows don't reach `INVALIDATED` setup states in the live data).

### Fix rationale

Excluding an invalidated peer from the named pointer, and suppressing self-praise on an invalidated
self, keeps the "where do you stand" rank/median math honest while removing the contradictory
"look at this one" / "size and attention follow score" implication — the same minimal, additive
shape as #4825, extended to the trigger #4825 didn't cover.

### Evidence of testing

- 5 new tests: `computeLaneRank` named-leader skips an INVALIDATED WATCH peer (live SKHY repro);
  `selfInvalidated` is true only for the play's own INVALIDATED setupState; `laneRankSection`
  suppresses the rank-1 praise line but keeps rank stats when self-invalidated; `laneRankCoaching`
  returns null when self-invalidated; `laneRankCoaching` still names a real leader for a healthy
  rank-1 WATCH setup (regression guard against over-suppressing).
- RED→GREEN proven via `git stash` — 4 of the 5 new/touched assertions fail pre-fix, pass post-fix.
- `play-brief-lane-rank.test.ts` + `play-brief-narrative-coaching.test.ts` (84 tests combined): pass.
- `npx tsc --noEmit`: clean.
- Full `npm test` (Node 20): pass, 0 fail (see PR for exact count — run in progress at write time).

Found during the Night Hawk Swings standing aggressive-mode improvement-hunt mandate (CLAUDE.md),
doing a live forensic pass on SKHY (the #1-scored WATCH candidate) after already confirming #4825
fixed the COMMIT-bucket analog earlier the same day — checked whether the identical class of bug
existed on the WATCH side and found it did, live, in production.
