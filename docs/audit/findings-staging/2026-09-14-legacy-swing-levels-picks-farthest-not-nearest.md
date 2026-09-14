> **kind:** FINDING

## Night Hawk Legacy — `swingLevels()`'s support/resistance arrays surface the FARTHEST pivot from spot, not the nearest (live-picks-logic, held)

| | |
|---|---|
| **Status** | OPEN — reported per the standing escalation policy (live-picks-logic, needs a design decision + backtest, not a mechanical one-line fix) |
| **Area** | Night Hawk Legacy — deterministic technical-level detection (`src/features/nighthawk/lib/technicals.ts`) and its two direct consumers, `deterministic-edition.ts`'s `resolveLevels()` (the CORE synthesis path for every deterministically-generated Legacy play) and `play-backfill.ts`'s thin-edition rescue |
| **Severity** | P2 — no publish-gate/geometry violation (mitigated by an unrelated downstream clamp — see below), but the specific support/resistance level quoted for a play's target/stop is, by construction, the LEAST relevant one available, not the most |

### Root cause

`technicals.ts`'s `swingLevels()` detects 2-bar pivot highs/lows over a 45-session lookback, then picks which ones to surface via:

```ts
const dedup = (levels: number[]) => {
  const sorted = Array.from(new Set(levels)).sort((a, b) => a - b); // ascending by VALUE
  ...
  return out; // ascending, deduped
};
return {
  resistance: dedup(highs).slice(-5).reverse(), // the 5 LARGEST highs, largest first
  support: dedup(lows).slice(0, 5),             // the 5 SMALLEST lows, smallest first
};
```

`dedup` sorts by raw **magnitude**, never by distance to the current spot price. `resistance[0]` is therefore always the single **highest** pivot high found anywhere in the 45-session window, and `support[0]` is always the single **lowest** pivot low — i.e. the two most extreme, farthest-from-price levels among whatever was detected, not the nearest ones a member (or the deterministic thesis-builder) would actually reference for tomorrow's session.

Both direct consumers read only index `[0]`, with no re-sort in between:

```ts
// deterministic-edition.ts:141-146 — the CORE synthesis path, resolveLevels()
function firstFinite(nums: Array<number | null | undefined> | undefined): number | null {
  for (const n of nums ?? []) {
    if (n != null && Number.isFinite(n) && n > 0) return n;
  }
  return null;
}
// deterministic-edition.ts:334-335
let support = firstFinite(tech?.support_levels) ?? tech?.prior_day?.low ?? null;
let resistance = firstFinite(tech?.resistance_levels) ?? tech?.prior_day?.high ?? null;
```

```ts
// play-backfill.ts:132-133 — the thin-edition rescue path
const support = dossier.tech?.support_levels?.[0];
const resistance = dossier.tech?.resistance_levels?.[0];
```

`firstFinite` just returns the first positive, finite element — no distance-based re-sorting exists anywhere between `swingLevels()` and either consumer.

### Concrete example

Lookback finds pivot lows at $130 and $140 with spot at $145 (a plausible shape — an older, deeper low and a more recent, shallower pullback). `support_levels` = `[130, 140, ...]`. `resolveLevels()`/`backfillThinEditionPlays()` both pick `130` as "support" — the deeper, older, less-relevant low — when `140` is the nearer, more recently-tested level a trader would actually reference as tomorrow's support. Same shape in reverse for resistance (the farthest/highest pivot high wins over a nearer one).

### Why this doesn't (currently) cause a publish-gate violation

`play-levels.ts`'s `buildDirectionalStockLevels()`, which turns the resolved support/resistance into the actual published target/stop, clamps the distance on both sides:

```ts
// LONG example
let stopDist = Math.min(spot - rawStop, maxStopDist);        // clamped to a volatility-scaled cap
const targetDist = Math.min(rawTarget - spot, maxTargetDist); // clamped to a volatility-scaled cap
const finalTargetDist = Math.max(targetDist, spot * 0.01);    // floored
```

and `deterministic-edition.ts`'s `resolveLevels()` additionally widens the target when it's too *close* (the PR-N21/N22 fix, "push the target-side S/R out so overnight plays have meaningful reward," 1.0× ATR floor). Between the cap and the floor, the **final numeric** target/stop lands in a sensible ATR-scaled band regardless of whether the seed level was near or far — which is exactly why this has not shown up as a `target_unreachable`/`band_detached` gate failure (those were traced elsewhere in this codebase's history, e.g. stale-dossier backfill plays). The bug is real but currently absorbed by an unrelated safety clamp built for a different reason.

### What actually goes wrong

When the farthest-pivot value happens to already sit **inside** the clamp/floor band (common for a moderately volatile name with a recent 45-day range), it is used **as-is**, un-clamped — so the play's stop or target is anchored to, and any level context built from it cites, the least-relevant technical level available rather than the nearest one. This is a picks-quality/narrative-honesty issue (citing a stale or irrelevant "support"/"resistance" as if it were the meaningful nearby zone), not a geometry-safety one.

### Why this is reported rather than fixed directly

The mechanical defect (sorting by magnitude instead of by distance-to-spot) is clear, but the correct fix requires a design decision this file's own audit culture treats as measurement-worthy, not a blind edit:
- "Nearest" needs a precise definition — nearest pivot strictly below/above the current spot (discarding a low that's actually above spot, e.g. after a rally) vs. nearest by absolute distance regardless of side.
- Changing which technical level seeds every deterministically-generated Legacy play's target/stop is exactly the kind of live-picks change this codebase's own `scripts/audit/*-ab.mjs` culture backtests before shipping (see e.g. `swing-early-trim-ab.mjs`, `tier-exit-mode-ab.mjs` for the established pattern of measuring a levels/exit change against real closed positions before committing to it).
- `swingLevels()`/`resolveLevels()` currently has **zero** test coverage of its ordering semantics (`technicals.test.ts` only covers `classifySetup`/`buildTechnicalSummary`), so there's no documented intent to confirm against — this appears to be an oversight, not a verified deliberate choice.

### Suggested fix (for review, not applied here)

Sort `swingLevels()`'s pivot arrays by absolute distance to the bar's *own* closing price at the time of detection is not quite right either (spot changes by the time the card is built); the cleaner fix is to have `buildTechnicalCard()` re-sort `support`/`resistance` by distance to `mtf.price` (the same spot used everywhere else in the card) right before assigning `support_levels`/`resistance_levels`, so index `[0]` is contractually "the nearest real technical level to current price on this side" for every consumer. Add a regression test on `swingLevels()` (or a new sort helper) asserting `[0]` is the nearest pivot to a given spot, not the most extreme one — closing the exact coverage gap that let this ship unnoticed.
