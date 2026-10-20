## `computeLaneRank` can still render a confidently-fabricated "#N of N" rank when the play's own row genuinely isn't found among its peers — real gap, but fixing it conflicts with an existing test's deliberate design intent

> **kind:** `FINDING`

| Field | Value |
| --- | --- |
| **Status** | REPORTED, NOT FIXED — flagged for the swing/Largo-contract owner to decide the right shape (nullable rank vs. an explicit "own row not found" flag vs. leaving as-is); not unilaterally touched, since an existing test explicitly defends part of the current behavior as deliberate |
| **Severity** | P3 (a real absence-disclosure gap per Largo C3, but the one KNOWN production trigger was already fixed 2026-09-17; residual exposure is narrower than the symptom alone suggests) |
| **Surface** | `src/lib/swing/play-brief-lane-rank.ts` (`computeLaneRank`) |

### What it is

`computeLaneRank` locates the reviewed play's own row among its sorted peers at `idx =
contractMatches.length === 1 ? sorted.findIndex(...) : sorted.findIndex((r) =>
r.ticker.toUpperCase() === play.ticker.toUpperCase())`. When the play's own row is not present in
`sorted` at all (`idx === -1`), `rank = idx >= 0 ? idx + 1 : sorted.length + 1` evaluates to
`sorted.length + 1`, which the return statement then clamps: `rank: Math.min(rank, sorted.length)`
— producing exactly `sorted.length`, i.e. the brief renders `"**#{total} of {total}**"` (confidently
dead-last) for a case that is actually "we couldn't locate this play's own row in its peer set at
all," not a real last-place measurement.

### Why this is narrower than it looks

A near-identical shape (`idx === -1` from a bucketing MISCLASSIFICATION, not a genuinely-missing
row) was already found and fixed 2026-09-17 (live LITE repro) — `rowInBucket` was rewritten to key
off `liveStatus` instead of the floor-gate `status` field specifically so a real, present row is
correctly bucketed and therefore correctly located (`idx >= 0`) in production. That fix is still in
place and unchanged by this finding.

What remains is the residual, structurally-still-possible case where the play's own row is not in
`laneRows` AT ALL (not merely misbucketed) — e.g. a caller supplying an incomplete peer list, or a
genuine data-sync gap between the play object and the lane snapshot it's being ranked against. The
function's own existing comment at the `playScore` fallback (line ~164) already acknowledges this:
*"Falls back to play.score only when the play's own row isn't present in laneRows (shouldn't happen
in production — laneRows is expected to include every open/WATCH row — but keeps the function total
for a caller that passes a partial list, e.g. tests)."* So the author already anticipated this path
existing, at least for defensive/test purposes — the gap is that `rank`/`total` don't get the same
honest treatment `playScore` does.

### Why this wasn't a drive-by fix

A naive fix (return `null` when `idx === -1`, mirroring the existing `ownRowWithheld` early-return a
few lines above) directly conflicts with an EXISTING, deliberately-written test:

```
test("computeLaneRank: playScore falls back to TerminalPlay.score when the play's own row is
absent from laneRows", () => {
  // Defensive fallback only — production laneRows is expected to always include the play's own
  // row, but a caller passing a partial list (or a test) must still get a sane playScore rather
  // than undefined/NaN.
  const snap = computeLaneRank(play({ ticker: "AAPL", score: 26, status: "WATCH" }), [
    row("XOM", 52.7, "WATCH"),
    row("TSM", 49.6, "WATCH"),
  ]);
  assert.ok(snap);
  assert.equal(snap!.playScore, 26, "no matching laneRows row for AAPL — falls back to play.score");
});
```

This test explicitly expects a NON-NULL snapshot for exactly the `idx === -1` scenario — returning
`null` here would break it and contradict its own stated design intent ("must still get a sane
playScore"). The test does not itself assert anything about `rank`/`total` in this fixture, so there
IS room to fix just those two fields without breaking it — but the two plausible shapes (make `rank`
nullable and update `laneRankSection`'s template + every other consumer to handle it, or add a new
`ownRowFound: boolean` field the renderer checks before building the `#N of N` line) are both a real,
if small, API-shape decision on a type (`LaneRankSnapshot`) with more than one consumer — not a
same-pattern one-line correction like the `STOP_OUT` exclusion fix shipped alongside this finding
(`2026-10-20-swing-lanerank-stopout-leader-exclusion.md`).

### Suggested next step

Whoever owns the swing play-brief / lane-rank narrative should decide the shape: widen
`LaneRankSnapshot.rank`/`total` to `number | null` (and gate the `laneRankSection` template line on
non-null), or add an explicit `ownRowFound: boolean` the renderer can check before asserting a
specific rank, then land it alongside an update to the existing `playScore`-fallback test so both
fields' honesty-on-absence are locked in together, not drive-by patched here.
