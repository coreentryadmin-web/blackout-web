> **kind:** FINDING

## Night Hawk Legacy — `extractMultiSourceCandidates`'s "unusualness" adjustment compares a 0–28-point normalized lane score against a real dollar baseline (live-picks-logic, held)

| | |
|---|---|
| **Status** | OPEN — reported per the standing escalation policy (live-picks-logic, needs a design decision on the correct fix shape, not a mechanical one-line change) |
| **Area** | Night Hawk Legacy — the multi-source candidate discovery engine (`src/features/nighthawk/lib/candidates.ts`'s `extractMultiSourceCandidates`), the function `edition-builder.ts`'s `buildEveningEdition` actually calls every night (STAGE 2) to pick which tickers get dossiers built and scored |
| **Severity** | P1 — a unit mismatch in the primary Legacy candidate-selection scoring path, unconditionally mis-weighting every flow-touched candidate, live every night, with zero test coverage of the affected code path |

### Root cause

`extractMultiSourceCandidates` composites 7 independent "lane" scores per ticker (flow, oi_change, unusual_trades, catalyst, predictions, movers, breakout), each **normalized to a small per-lane point ceiling** via `normalizeToMax()`:

```ts
const LANE_MAX_FLOW = 28; // ...other lanes max at 8-18
function normalizeToMax(entries: LaneEntry[], maxPts: number): Map<string, number> {
  const top = entries.reduce((m, e) => Math.max(m, e.rawScore), 0);
  if (top <= 0) return new Map();
  const out = new Map<string, number>();
  for (const e of entries) out.set(e.ticker, Math.max(out.get(e.ticker) ?? 0, (e.rawScore / top) * maxPts));
  return out;
}
function laneFlow(ctx: MarketWideContext): Map<string, number> {
  ... // seen.set(ticker, rawDollarPremium) accumulated here, in REAL DOLLARS
  for (const [ticker, score] of seen) entries.push({ ticker, rawScore: score });
  return normalizeToMax(entries, LANE_MAX_FLOW); // <- only the NORMALIZED (0-28) map is returned
}
```

`laneFlow`'s real dollar premium sum (`seen`, a local variable) is **never exposed** — only the 0–28-point normalized map comes back. Later, `extractMultiSourceCandidates` tries to apply a flow-specific "unusualness" bonus using that same normalized map as if it were the raw dollar figure:

```ts
// candidates.ts, extractMultiSourceCandidates
const flowLane = lanes.find(([n]) => n === "flow");
if (flowLane) {
  const flowRaw = flowLane[1].get(ticker); // <- this is the 0-28 NORMALIZED score, not a dollar figure
  if (flowRaw && flowRaw > 0) {
    const baseline = Math.max(avgPremiums[ticker] ?? 0, CANDIDATE_MIN_BASELINE_PREMIUM); // real dollars, floor $75,000
    score *= unusualnessMultiplier(flowRaw / baseline); // clamp(ratio, 0.5, 3)
  }
}
```

`avgPremiums[ticker]` comes from `fetchTickersAvgDailyPremium` (`src/lib/db.ts`), a **real dollar** 30-day average daily premium, floored at `CANDIDATE_MIN_BASELINE_PREMIUM = 75_000`. So the ratio computed is:

```
flowRaw (0..28) / baseline (>= 75,000)  =  at most 28/75,000 ≈ 0.000373
```

`unusualnessMultiplier` is `clamp(ratio, 0.5, 3)` — so this ratio is **always** clamped to the floor, **0.5**, whenever a ticker has any flow-lane presence at all (`flowRaw > 0`). For a ticker with **zero** flow-lane presence (surfaced only via movers/breakout/catalyst/etc.), `flowLane[1].get(ticker)` is `undefined`, the `if` is skipped, and `score` is left **completely unmultiplied** (effectively ×1).

### The actual effect on tonight's candidate pool

Every ticker with any real options-flow signal gets its composite score cut to **half** of what it would otherwise be, while every ticker surfaced by a non-flow lane with zero flow presence pays no such penalty. This is the exact opposite of the code's own stated intent — the comment directly above it says *"Unusualness ratio from flow lane raw premium vs 30-day avg"*, i.e. a genuinely unusual (multi-x-baseline) flow spike should be **rewarded** up to 3×, not have every flow-touched name silently knocked down to 0.5× regardless of how unusual its flow actually was. Since `applyConfluenceGate`/the final ranking sort both operate on `composite_score` after this multiplier is applied, this systematically disadvantages flow-driven candidates relative to catalyst/mover/breakout-only ones in the pool that ultimately gets dossiers built and scored for tonight's edition.

### Why this shipped unnoticed

- `laneFlow()` only returns the post-`normalizeToMax()` map; the raw dollar `seen` accumulator that would make the ratio meaningful is a function-local variable, never surfaced to the caller.
- The OLDER, still-present `extractCandidateTickers`/`aggregateTickerFlows` path (kept for `hunt-builder.ts`, not used by Legacy's edition pipeline) computes this ratio correctly — `unusualness = agg.rawPremium / baseline` where `agg.rawPremium` is a genuine dollar sum accumulated independently of any lane normalization. The multi-source engine's version looks like it was written by analogy to that correct pattern but reached for the wrong map (the normalized lane-score map that happens to live right next to it in `lanes`, rather than a raw dollar figure that was never plumbed through).
- `candidates.test.ts` has zero tests exercising `extractMultiSourceCandidates`'s DB-enrichment/unusualness-multiplier branch at all — every existing test targets `laneComposition`/`applyConfluenceGate`, both pure, order-preserving functions downstream of this bug. The interaction between a normalized lane map and a real-dollar baseline was never exercised by any test, so nothing caught the unit mismatch.

### Blast radius

- `extractMultiSourceCandidates` is called from exactly one place: `edition-builder.ts`'s `buildEveningEdition`, STAGE 2 (`candidates = await extractMultiSourceCandidates(ctx, MAX_CANDIDATES)`) — this is Legacy's actual nightly candidate-discovery entrypoint, not a secondary or legacy path.
- Every night's `composite_score` ranking, `applyConfluenceGate`'s admission cutoff, and the resulting `MAX_CANDIDATES`-sized ticker list handed to dossier-building are all affected — a ticker that would have ranked higher on genuinely unusual flow may be under-ranked (or excluded from the top-N cut) relative to a ticker with no flow signal at all.
- No other function reads this same broken ratio, so the blast radius is confined to `extractMultiSourceCandidates`'s composite scoring.

### Why this is reported rather than fixed directly

The mechanical defect (comparing a 0–28 normalized score to a real dollar baseline) is unambiguous, but the correct **shape** of the fix is a design choice with more than one reasonable answer:
- Have `laneFlow()` also return (or a sibling function separately compute) the raw dollar premium sum per ticker, so `extractMultiSourceCandidates` can divide dollars by dollars, matching the older `extractCandidateTickers` path's correct pattern; or
- Drop the flow-specific unusualness multiplier from the multi-source path entirely and let the corroboration-bonus tiers (2/3/4+ lane agreement, already present) carry that signal instead, since the multi-source design already has its own notion of "how much of an outlier is this."

Either way, this changes tonight's actual candidate ranking — the exact class of live-picks change this lane's standing policy treats as report-and-hold, and the kind of change this codebase's own audit culture (e.g. the `scripts/audit/*-ab.mjs` harnesses) generally likes to measure before shipping, given how central candidate selection is to what plays are even considered for the edition.

### Suggested fix (for review, not applied here)

Expose the raw dollar flow sum from `laneFlow()` (e.g. return `{ normalized: Map<string, number>; rawDollars: Map<string, number> }` instead of a bare `Map`, or add a small sibling function that recomputes just the raw sum), and use that raw dollar figure — not the normalized lane score — as the numerator in the `unusualnessMultiplier(flowRaw / baseline)` call. Add a regression test constructing a ticker with a real, large flow premium relative to a small `avgPremiums` baseline and asserting the multiplier actually rewards it (>1), plus a case with a normal/baseline-consistent premium asserting the multiplier stays near 1 — closing the exact coverage gap that let the unit mismatch ship unnoticed.
