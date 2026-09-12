> **kind:** FINDING

## Lane-rank "leader" callout could name a position the desk is already telling members to exit — FIXED

| **Status** | FIXED |
|---|---|

### Root cause

`computeLaneRank` (`src/lib/swing/play-brief-lane-rank.ts`) powers the "Lane rank" section and the
`laneRankCoaching` bullet in every OPEN-position play-brief — e.g. NN#32's brief reads:

> **Below lane median** — **#89/90** (score **23**, -40 vs median). Leader: **CRWD** @ **86.5** —
> confirm before adding size.

The "leader" pointer was picked purely by `row.score` — the static discovery/commit-time score —
with no regard for the position's *current* management state. Found live 2026-09-12: CRWD sat #1
by score (86.5) among real OPEN positions, but its own manage engine had already fired
`EXIT_RUNNER` (round-tripped from a real +129.7% peak down to -9.5% mid / -22.2% executable, fully
trimmed, runner being managed out). The brief was naming a position the desk is actively telling
members to exit as "the leader ... confirm before adding size" — advice that reads as "put money
here" about the exact opposite of what the trade-manager read three lines below it was saying.

This wasn't caught before because every existing test for `computeLaneRank` used synthetic peers
with no `manageAction` set at all — the field exists on `HorizonPlay` (and is populated live for
every real committed position, confirmed via `GET /api/market/nighthawk/horizons?view=swings`) but
nothing exercised the case where the top-scored peer is mid-exit.

### Fix

Purely additive filter, no new computation: `computeLaneRank` still computes `rank`/`medianScore`
against the FULL peer set (an honest "where does this score fall", unaffected by exit state) but
now picks the *named* `topTicker`/`topScore` from peers whose `manageAction` is not `EXIT` or
`EXIT_RUNNER`, falling back to the raw #1 only if every peer is exiting (still shows something
rather than nothing). WATCH-bucket rows never carry `manageAction`, so WATCH-lane behavior is
unchanged.

### Blast radius

Both consumers of `computeLaneRank` — `laneRankCoaching` (play-brief-narrative-coaching.ts, the
"Trade manager read" bullet) and `laneRankSection` (play-brief-lane-rank.ts, the standalone "Lane
rank" section) — read the same `topTicker`/`topScore` fields, so both are fixed by the one change.
Only the OPEN bucket is affected (WATCH rows have no `manageAction` to filter on); `rank`/`total`/
`medianScore`/`deltaFromMedian` are unchanged everywhere.

### Fix rationale

Excluding an exiting peer from the *named pointer* (not from the rank/median math) keeps the
"where do you stand" fact honest while removing the misleading "look at this one" implication —
the minimal change that fixes the narrative without touching the underlying ranking semantics.

### Evidence of testing

- 3 new tests in `play-brief-lane-rank.test.ts`: named leader skips an EXIT_RUNNER peer (live CRWD
  repro), falls back to the raw #1 when every peer is exiting, and WATCH-bucket rows are unaffected
  (no `manageAction` to filter on).
- RED→GREEN proven via `git stash` — the CRWD-repro test fails pre-fix (`'CRWD' !== 'AAPL'`), passes
  post-fix.
- `play-brief-lane-rank.test.ts` + `play-brief-narrative-coaching.test.ts` (76 tests combined): pass.
- `npx tsc --noEmit`: clean.
- Full `npm test` (Node 20): **13785 pass / 0 fail / 3 skipped** (pre-existing, unrelated).

Found during the Night Hawk Swings standing aggressive-mode improvement-hunt mandate (CLAUDE.md) —
a genuine narrative-quality gap surfaced by live re-checking the real OPEN book, not a synthetic
audit.
