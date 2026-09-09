> **kind:** FINDING

## Ask Largo swing brief — raw IEEE754 subtraction artifact leaked into "vs median" narrative — FIXED

| | |
|---|---|
| **Status** | FIXED |
| **Area** | Ask Largo swing play-brief lane-rank narrative (`src/lib/swing/play-brief-lane-rank.ts`, consumed by `play-brief-narrative-coaching.ts`) |
| **Severity** | P3 (narrative quality / data-correctness — a raw unrounded float presented as a trade-manager fact, the same class of bug CLAUDE.md's "Data-correctness notes" section already calls out generally: "several endpoints serve unrounded floats... round at the data layer") |

### Root cause

`computeLaneRank` derives `deltaFromMedian` via plain floating-point subtraction:

```ts
deltaFromMedian: playScore - medianScore,
```

`playScore`/`medianScore` are score floats (e.g. `57.2`, `45.4`) already carrying one decimal
place from upstream. Subtracting two such floats routinely produces an IEEE754 artifact —
`57.2 - 45.4 === 11.800000000000004` in Node — and the value is formatted directly into the
narrative with no rounding at either of its two call sites:

- `play-brief-lane-rank.ts`'s own `laneRankSection` ("Lane rank" section body).
- `play-brief-narrative-coaching.ts`'s `laneRankCoaching` (the "Top-tier setup" / "Below lane
  median" trade-manager-read bullet).

**Live repro (AMZN brief, 2026-09-09, standing Ask Largo deep-dive cycle):** the WATCH-bucket
AMZN brief's "Trade manager read" section rendered:
```
• **Top-tier setup** — **#3/15** on WATCH · **+11.799999999999997** vs median.
```
A real trader-facing sentence quoting a 17-digit float where a one-decimal score comparison was
intended.

### Fix

Round `deltaFromMedian` to one decimal place at the point of computation in `computeLaneRank`
(the single pure function both call sites read from), rather than rounding at each display call
site — one fix point, both consumers covered:

```ts
deltaFromMedian: Math.round((playScore - medianScore) * 10) / 10,
```

No other field on `LaneRankSnapshot` needed the same treatment: `playScore`/`medianScore`/
`topScore` are read directly from upstream `score` fields (already normalized at their own
source), not derived by subtraction here.

### Evidence

- New regression test `computeLaneRank: deltaFromMedian is rounded, not a raw float subtraction
  artifact` (`play-brief-lane-rank.test.ts`) — reproduces the live AMZN repro shape (57.2 vs 45.4
  medians) and asserts the result is exactly `11.8`, not the raw `11.800000000000004`.
- RED→GREEN proven via `git stash` (source-only revert): 1 failure pre-fix (`actual:
  11.800000000000004`), 0 post-fix, 7/7 total in the file.
- `npx tsc --noEmit`: clean.
- Full `src/lib/swing/*.test.ts` suite: 827/829 pass; the 2 failures (`ex-dividend-reads.test.ts`,
  `play-brief-resolve.test.ts`) are pre-existing on unmodified `origin/main` (confirmed via the
  same `git stash` isolation) and unrelated to this change — sandbox network/env dependencies, not
  a regression this PR introduces.

### Blast radius

One function (`computeLaneRank`), two consumers (`laneRankSection`, `laneRankCoaching`) — grepped
for every other `deltaFromMedian` reference; both are display-only reads of the same snapshot
field, so rounding at the source covers both without touching either call site.
