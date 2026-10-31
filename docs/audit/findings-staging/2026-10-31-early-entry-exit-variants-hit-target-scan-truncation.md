> **kind:** FINDING

## Early-entry big-target backtest tooling: `replayRatchetExit`/`replayPartialProfitRunner` computed `hit10`/`hit20` INSIDE the decision loop, silently truncating the scan on whichever exit rule happened to return first — FIXED

**Status:** Fixed, 2 regression tests added (`src/lib/zerodte/early-entry-exit-variants.test.ts`). PR #7094.

### Root cause

`early-entry-exit-variants.ts` (shipped net-new in #6946) provides pure, bar-walkable replays
of the shipped ratchet exit and alternative exit rules, for the operator's "optimize for the
big-target ($10/$20) hit rate separately from small winning trades" mandate. Both
`replayRatchetExit` and `replayPartialProfitRunner` are documented to report `hit10`/`hit20` as
**pure path properties** — "did the underlying option premium ever touch $10/$20," identical
across every exit variant replayed on the same real bar path, regardless of which rule's own
exit fired first.

Before the fix, both functions computed `timeToHit10Ms`/`timeToHit20Ms` **inside** their own
per-bar decision loop — the same loop that `return`s early on a stop/ratchet-floor/
flat-theta-bleed/tranche condition. A variant whose own rule exits earlier (e.g. the shipped
ratchet's tight floor) stops iterating before it ever examines later bars where the underlying
genuinely touched $10 or $20 — silently truncating the "did this ever happen" scan to "did this
happen before MY rule decided to stop looking," which is a different, narrower question than the
one the field is documented to answer.

### Evidence

- Found by reading the real 45-day backtest's (`scripts/audit/early-entry-big-target-backtest.mjs`)
  own output before drawing any conclusion from it, per the standing "treat as a hypothesis to
  validate" discipline: one TRAIN row showed `partial-profit` reporting `hit$20%=1.2%` while
  every other exit variant on that **exact same row** (same real option-premium bar path, by
  construction) showed `hit$20%=0%` — directly contradicting the script's own documented
  invariant that hit10/hit20 must be identical across variants.
- **RED (pre-fix, via `git stash`):** new regression test constructs a path where bar 1 drops
  straight to the hard stop (so the OLD decision loop never advances past bar 1) and bar 2 —
  unreachable by the old loop — touches $11; asserts `hit10 === true` and
  `timeToHit10Ms === bars[1].t`. Confirmed failing against the pre-fix code.
- **GREEN (post-fix):** `src/lib/zerodte/early-entry-exit-variants.test.ts` — 15/15 pass (13
  original + 2 new regression tests, one per affected function).
- Full `npm test` (Node 20): 17491 pass / 0 fail / 3 skipped (pre-existing) — zero regressions.
- `npx tsc --noEmit -p .`: clean.
- Re-ran the real 45-day backtest with the fix: `hit10RatePct`/`hit20RatePct` are now byte-identical
  across all 4 exit variants in both the TRAIN (n=83) and VALIDATION (n=68) halves, as the
  invariant requires (TRAIN: 3.6%/1.2% every variant; VALIDATION: 4.4%/0% every variant) —
  confirms the fix, not just the unit tests.

### Blast radius

Both exit-replay functions had the identical bug (same copy-pasted per-bar loop shape) — both
fixed by the same extracted `scanHitTimes()` helper, not just the one (`partial-profit`) whose
symptom surfaced it first. No other file imports either function yet — only the new backtest
script does (per #6946) — so there is no second call site and zero live-board behavior change;
this is a correction to in-progress research tooling, not a production data-correctness fix.

### Fix rationale

Extracted `scanHitTimes(walk)` — scans the **entire** bar array once, before either function's
own decision loop runs, decoupling hit-detection from each rule's own early-`return` control
flow:

```ts
function scanHitTimes(walk: ExitBar[]): { timeToHit10Ms: number | null; timeToHit20Ms: number | null } {
  let timeToHit10Ms: number | null = null;
  let timeToHit20Ms: number | null = null;
  for (const b of walk) {
    if (timeToHit10Ms == null && b.h >= 10) timeToHit10Ms = b.t;
    if (timeToHit20Ms == null && b.h >= 20) timeToHit20Ms = b.t;
    if (timeToHit10Ms != null && timeToHit20Ms != null) break;
  }
  return { timeToHit10Ms, timeToHit20Ms };
}
```

Considered and rejected: continuing to compute the hit-scan per-variant inside each decision
loop but extending every loop to keep running after its own exit fires just to finish the scan —
rejected because it conflates "the position is still open" with "we are still allowed to look at
history," and would have to be re-derived separately for every future exit variant added to this
module, instead of being a single shared, variant-agnostic pass over the one real bar path both
replays are already handed.

### Deliberately left unchanged

- `exitCleared10`/`exitCleared20` (whether THIS rule's own realized exit price cleared the
  target) are correctly rule-dependent and were not touched — only the path-level `hit10`/`hit20`
  fields were in scope.
- The decision loops' own exit logic (stop/floor/flat-theta-bleed/tranche thresholds) — unchanged;
  this is purely a measurement fix, not a change to any exit rule's behavior.
