> **kind:** FINDING

## Lane-rank "Desk leader" pointer could name the play's OWN ticker as the leader — FIXED

| **Status** | FIXED |
|---|---|

### Root cause

`computeLaneRank` (`src/lib/swing/play-brief-lane-rank.ts`) computes `rank`/`total`/`medianScore`
against the FULL sorted peer set (including the play's own row — that is how `idx`/`rank` are found
at all), then separately picks a "named leader" pointer (`topTicker`/`topScore`) by filtering that
same sorted list down to peers whose own `manageAction`/`setupState` don't disqualify them
(`EXITING_MANAGE_ACTIONS`/`INVALIDATED_SETUP_STATES`, added in #4849/#4842). That filter never
excluded the play's OWN row.

So whenever the play is NOT raw rank #1, but IS the best real (non-excluded) candidate — which
happens exactly when the actual raw #1 is itself excluded — the "leader" pointer resolves to the
play's own ticker.

**Live repro (2026-09-12, COIN's own WATCH brief):** board was SKHY (score 59, `setupState:
INVALIDATED`) / COIN (55.4, healthy) / GOOGL (51) / ... . SKHY sat raw rank #1 but is excluded from
leader eligibility (per #4842's fix). COIN is the next-best score and IS eligible, so it became the
named leader — but the play IS COIN. `GET /api/market/swing/play-brief?playId=SWING:COIN` rendered:

> **#2 of 8** on WATCH lane · score **55** (**+16.2** vs median)
>
> Lane median: **38.8**
>
> Desk leader: **COIN** @ **55.4**

Naming COIN as "the leader" on COIN's own brief is meaningless — a leader pointer exists to point a
member at something ELSE worth comparing against, not to restate the row they're already reading.
The same class of latent risk exists in `laneRankCoaching`'s below-median "Leader: ..." line
(`play-brief-narrative-coaching.ts`), since it reads the same `topTicker`/`topScore` fields.

### Fix

`computeLaneRank` now excludes the play's own matching row(s) (via the existing `laneRowMatchesPlay`
ticker+contract matcher, the same one already used for `idx`/`rank`) from the leader candidate list
`others` up front, before applying the exiting/invalidated filter — so neither the eligible-candidate
pick nor its fallback can ever select the play itself. `rank`/`total`/`medianScore` are untouched
(still computed against the FULL peer set, self included, per #4849's own documented rationale that
this honesty should not depend on exit/invalidation state).

### Blast radius

Both consumers of `computeLaneRank` (`laneRankSection` and `laneRankCoaching`) inherit the fix for
free since they only read the returned `topTicker`/`topScore` — no separate self-check was needed in
either renderer.

### Fix rationale

Same centralization discipline as #4842/#4849: fix once at the shared `computeLaneRank` layer rather
than adding a per-renderer self-check, so a future third consumer of this snapshot type is correct by
construction instead of needing to remember a new guard.

### Evidence of testing

- 2 new tests in `play-brief-lane-rank.test.ts`: named leader is never the play's own ticker when the
  play is the best eligible peer (COIN/SKHY/GOOGL live repro — RED pre-fix, reproduces the exact
  "topTicker: COIN" self-reference); named leader falls back to a real OTHER peer (never self) when
  every other peer is exiting/invalidated.
- RED→GREEN proven via `git stash` on `play-brief-lane-rank.ts`: 1 assertion fails pre-fix
  (`topTicker` equals `"COIN"` when it must not), 0 fail post-fix.
- `play-brief-lane-rank.test.ts` + `play-brief-narrative-coaching.test.ts` + `play-brief.test.ts` +
  `play-brief-intel.test.ts` combined (243 tests): pass.
- `npx tsc --noEmit` (Node 20): clean.
- Full `npm test` (Node 20): pending at PR-open time — CI `verify` will confirm.

Found during the Night Hawk Swings standing aggressive-mode improvement-hunt mandate, auditing two
fresh WATCH tickers (COIN/GOOGL) not previously checked this session — the exact same board data the
already-shipped #4842 test fixture uses, read from the OTHER ticker's own perspective.
