> **kind:** FINDING

## Ask Largo "Lane rank" section compared a rounded score to raw peer scores — FIXED

| | |
|---|---|
| **Status** | FIXED |
| **Lane** | Night Hawk Swings / Ask Largo |
| **Severity** | P3 (narrative quality — the ranking/gate logic itself is unaffected, only the displayed score/delta text) |
| **File** | `src/lib/swing/play-brief-lane-rank.ts` (`computeLaneRank`) |
| **Found by** | Standing "Ask Largo × Night Hawk Swings" mandate, aggressive-mode improvement hunt |

### Root cause

`computeLaneRank(play, laneRows)` builds its "Below lane median" narrative from two different
score sources at two different precisions:

- `medianScore`/`topScore` are computed from `laneRows: HorizonPlay[]` — fetched fresh, retaining
  the raw discovery/entry score to one decimal place.
- `playScore` was read straight off `play.score` (`TerminalPlay`) — but every adapter that builds
  a play-brief's `play` (`terminalPlayFromHorizon`, `src/features/nighthawk/command-deck/adapters.ts:966`)
  rounds the score to the nearest **integer** for board display: `score: Math.round(src.score)`.

So the section compared an integer-rounded value against decimal-precision peers/median, and the
"vs median" delta was computed from the rounded value too — silently different from the play's own
true score shown elsewhere in the same brief.

### Evidence

Live repro, AAPL WATCH brief (`GET /api/market/swing/play-brief?playId=SWING:AAPL&ticker=AAPL&status=WATCH`),
2026-09-17, real WATCH-lane scores XOM 52.7 / TSM 49.6 / AAPL 25.5:

```
## Why this setup
**Score pillars:**
• **Catalyst** — +19.4 pts
• **Regime** — +4.2 pts
• **Flow** — +1.9 pts
```
(sums to the true raw score, 25.5)

```
## Trade manager read
• **Below lane median** — **#3/3** (score **26**, -23.6 vs median). Leader: **XOM** @ **52.7**
```

Two different numbers for the identical quantity, three sections apart, in the same document —
the same "same fact, different section, different value" defect class this file has already fixed
repeatedly (IEEE754 median artifact, median-of-even-set, `Entry geometry`/put-wall/pillar-breakdown
duplication). The true delta is `25.5 - 49.6 = -24.1`, not the displayed `-23.6`
(`26 - 49.6 = -23.6`, i.e. computed from the rounded display value).

Regression tests added: `src/lib/swing/play-brief-lane-rank.test.ts` —
`"computeLaneRank: playScore uses the raw laneRows precision, not a pre-rounded TerminalPlay.score"`
(confirmed RED before the fix: `26 !== 25.5`) and a companion fallback test
(`"computeLaneRank: playScore falls back to TerminalPlay.score when the play's own row is absent
from laneRows"`) covering the defensive path.

### Blast radius

Single function, two call sites, both fixed by the one change: `laneRankSection` (used directly by
`play-brief-intel.ts:1466`) and `computeLaneRank` (also called directly by
`play-brief-narrative-coaching.ts:853` for the "Lane leader"/"Below lane median" bullet folded into
"Trade manager read"). Both read `snap.playScore`/`snap.deltaFromMedian` from the same
`LaneRankSnapshot`, so both were wrong the same way and both are fixed by the same source change.

### Fix rationale

`sorted` (built from the same `laneRows` array that already feeds `medianScore`/`topScore`) already
contains the play's own row at `idx` whenever a match is found — that row carries the play's score
at the SAME raw precision as every peer being compared against it. Reusing `sorted[idx].score`
instead of re-deriving a value from the differently-rounded `TerminalPlay.score` keeps `playScore`
and `medianScore` always at matching precision, with no behavior change to rank/median/leader logic.
Falls back to `play.score` only when the play's own row isn't present in `laneRows` (shouldn't
happen in production — `laneRows` is expected to include every open/WATCH row — kept for a caller
passing a partial list).

### Verification

- `npx tsx --experimental-test-module-mocks --test src/lib/swing/play-brief-lane-rank.test.ts` — 24/24 pass (Node 20), confirmed RED (`26 !== 25.5`) before the fix.
- `npx tsx --experimental-test-module-mocks --test src/lib/swing/play-brief*.test.ts` — 567/567 pass (Node 20).
- `npx tsc --noEmit` — clean.
