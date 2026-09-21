## 2026-09-21 — [FINDING, P2, Swing/Ask Largo] Lane-rank narrative compared a fabricated `score: 0` fallback as if it were a real value — FIXED

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | FIXED (this PR) |
| **Area** | `src/lib/swing/play-brief-lane-rank.ts`, `src/lib/swing/live-plays.ts`, `src/lib/horizon-plays.ts` |
| **Severity** | P2 — misleading member-facing coaching text on a live, real-money position |
| **Found via** | Standing Ask Largo × Night Hawk Swings ownership mandate deep-dive, live GET `/api/market/swing/play-brief?playId=SWING:AAPL:40` |

### Root cause

`livePlayFromSwingPosition` (live-plays.ts) computes a committed swing position's `score` as:

```ts
const score =
  row.feature_vector && typeof row.feature_vector.evidence_score === "number"
    ? (row.feature_vector.evidence_score as number)
    : 0;
```

`HorizonPlay.score` is a non-nullable `number`, so a position whose `feature_vector.evidence_score`
was never pinned (an older commit predating that pin, or any other shape gap) falls back to a
**literal `0`** — not an honest "unknown," a real comparable number as far as every downstream
consumer can tell.

`computeLaneRank` (`play-brief-lane-rank.ts`) sorts ALL peer rows by this raw `score` to compute
rank/median/the named "lane leader," with no awareness that a `0` can be a fallback rather than a
measurement. Live repro, `SWING:AAPL:40` (2026-09-21, RTH): a real, live, +39.2% P&L position the
desk says to HOLD — its own brief's "Why this setup" section shows real non-zero pillar points
(Catalyst 35.3 + Structure 26.5 + Regime 14.7 + Volatility 14.3 ≈ 91) reconstructed from the pinned
`feature_vector` via a separate path (`pinnedFactorsFromFeatureVector`) — while the SAME brief's
"Trade manager read" section said:

> **Below lane median** — **#59/59** (score **0**, -63 vs median). Leader: **GEMI** @ **74** —
> confirm before adding size.

A trader reading that line sees "worst-scored position in the entire 59-position book, confirm
before adding size" about a real winner the desk is telling them to hold — the opposite of what the
brief's own other sections say about the same position two paragraphs apart.

This is the same violation class this repo's Largo product contract already names for `confidence`:
*"`confidence` must be OMITTED when a product cannot calibrate it... fabricated certainty... corrupts
cross-product ranking. Omission is honest; fabrication is not."* `score: 0` here is the same shape of
problem one level down — a per-play ranking input, not a cross-product confidence field, but the
same fix applies: an uncalibrated value must never be compared against calibrated peers.

Note this is a *different* "score withheld" mechanism from the one already in `play-brief.ts`
(`thesisHealthSection`'s "Aggregate score withheld — not every pillar input is wired for this
position yet.") — that one covers the pillar-AGGREGATE percentage shown in the "Thesis health"
section; this bug is in the separate `TerminalPlay`/`HorizonPlay.score` field the lane-rank/peer-
comparison feature reads. Both are real, both needed the same honest-omission discipline, only one
had it.

### Evidence

Live run, 2026-09-21 17:21 UTC (RTH, real data):
```
GET /api/market/nighthawk/horizons?view=swings
  → SWING lane, 61 committed rows, exactly 1 with score === 0 (AAPL, positionId 40)

GET /api/market/swing/play-brief?playId=SWING:AAPL:40
  → "Why this setup" pillars sum to ~90.8 (real, non-zero)
  → "Trade manager read" simultaneously: "Below lane median — #59/59 (score 0, -63 vs median).
     Leader: GEMI @ 74 — confirm before adding size."
```

### Blast radius

`computeLaneRank` is called from two sites, both affected: `play-brief-lane-rank.ts`'s own
`laneRankSection` (the standalone "Lane rank" section) and `play-brief-narrative-coaching.ts`'s
`laneRankCoaching` (the folded "Below lane median"/"Top-ranked" line inside "Trade manager read").
Both render off the same `LaneRankSnapshot`, so a single fix at `computeLaneRank` covers both.

Beyond AAPL's own fabricated rank, the same `score: 0` row was also counted as a real peer in the
`sorted`/`medianScore` pool for every OTHER open swing position's own lane-rank comparison —
dragging every other brief's computed median down by one artificially-low data point (small effect
at n=61, but the same shape of contamination scales worse the more positions carry an unwired
`feature_vector`).

### Fix rationale

Added `HorizonPlay.scoreWithheld?: boolean` (additive, optional — every existing producer/consumer
of `HorizonPlay` is unaffected) and set it true in `live-plays.ts` exactly when the `0` fallback is
used. `computeLaneRank` now:
1. Excludes any row carrying `scoreWithheld` from the peer pool entirely (median/rank for every
   OTHER play's own brief is computed only over real, calibrated scores).
2. Returns `null` outright when the CALLING play's own row is `scoreWithheld` — no snapshot, no
   fabricated "#59/59," no "Lane rank" section at all, matching the honest-omission pattern this
   feature's own sibling text (`thesisHealthSection`'s "score withheld") already uses.

Deliberately left unchanged: the underlying reason `feature_vector.evidence_score` is sometimes
missing (an older commit predating the pin) — that's a data-lineage fact about legacy rows, not a
bug to backfill here; fixing the CONSUMER to stop treating the fallback as real data is the scoped,
low-blast-radius fix. Also left `HorizonPlay.score` itself non-nullable, per its existing design
(board sort/display never null-checks it) — `scoreWithheld` is the honest sidecar flag rather than a
breaking type change across every `HorizonPlay` consumer.

### Test

`src/lib/swing/play-brief-lane-rank.test.ts` — two new tests: (1) a play whose own row is
`scoreWithheld` returns `null` from `computeLaneRank` (RED pre-fix: fabricated `#2/2, score 0`
snapshot; GREEN post-fix), (2) a withheld PEER is excluded from another play's own median/rank
computation (RED pre-fix: counted as a 3rd real peer; GREEN post-fix: pool of 2, correct median).
Full `npx tsc --noEmit` clean; `src/lib/swing/live-plays.test.ts`,
`src/lib/swing/play-brief-narrative-coaching.test.ts`, `src/lib/swing/play-brief.test.ts`,
`src/lib/swing/play-brief-intel.test.ts` all pass (466 tests, 0 fail) alongside the new tests.
