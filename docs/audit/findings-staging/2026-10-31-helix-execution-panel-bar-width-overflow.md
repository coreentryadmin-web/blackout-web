## 2026-10-31 — [FINDING, P3] Helix Execution Analysis panel renders bar widths past 100% when the smallest-premium bucket sorts first

> **kind:** `FINDING`

| | |
|---|---|
| **Area** | `src/features/helix/components/ExecutionAnalysisPanel.tsx` |
| **Status** | FIXED |
| **Severity** | P3 (visual/UI correctness — session-scoped Helix "Fill quality" panel; no data/trading-decision impact) |

### Root cause

`ExecutionAnalysisPanel.tsx` scales each bucket's bar width relative to what it assumes is the
largest-premium bucket:

```ts
const maxPremium = entries[0]?.premium ?? 1;
...
const barW = Math.max(6, (e.premium / maxPremium) * 100);
```

This is only correct if `entries[0]` actually holds the largest premium. It does not.
`summarizeExecutionQuality` (`src/features/helix/lib/helix-execution-quality.ts`) returns its
rollup in a **fixed bucket order** — `["aggressive", "passive", "mid", "unknown"]`, filtered to
buckets present — never sorted by premium:

```ts
const order: ExecutionQualityBucket[] = ["aggressive", "passive", "mid", "unknown"];
return order.filter((b) => map.has(b)).map((bucket) => { ... });
```

So whenever a bucket *later* in that fixed order (most plausibly "passive") carries far more
premium this session than "aggressive" (first in the order), `entries[0].premium` is the
*smallest* value in the array, not the largest. `maxPremium` then undershoots badly, and every
other bucket's `barW` computes to many multiples of 100% — a literal `width: 9000%` on the bar's
fill `<div>`, overflowing its track — while the genuinely tiny "aggressive" bucket renders at a
full, dominant-looking 100%. The visual read is exactly backwards from the real premium split.

**Why this wasn't caught earlier:** the sibling panel one file over, `RouteBreakdown.tsx`, does
the identical `entries[0]?.premium ?? 1` pattern — and it's correct there, because
`RouteBreakdown`'s own `useMemo` explicitly `.sort((a, b) => b.premium - a.premium)`s its entries
before taking `entries[0]` as the max. `ExecutionAnalysisPanel` copied the *consumption* pattern
without the *sort* that makes it valid, and its own data source
(`summarizeExecutionQuality`) was never sorted by premium — it's sorted by a fixed semantic
bucket order instead (aggressive → passive → mid → unknown), which is the right order to *display*
buckets in but the wrong thing to index `[0]` into for a max.

### Evidence

Reproduced directly against the real, unmodified `summarizeExecutionQuality`:

```
entries order: [ 'aggressive=10000', 'passive=900000' ]
aggressive: premium=10000 barW=100%   (should be the SMALL bar)
passive:    premium=900000 barW=9000% (should be the full, 100% bar)
```

RED→GREEN proof via `src/features/helix/components/ExecutionAnalysisPanel.test.tsx` (new file):
rendered the real component (via `renderToStaticMarkup`, with `framer-motion`'s `motion.div`/
`AnimatePresence` mocked to plain passthrough elements — same pattern as
`src/components/ios/IosNativeSegment.test.tsx`) with two alerts: a $10k "aggressive" print
(ask_pct=80, sorts first) and a $900k "passive" print (ask_pct=10, sorts second). Before the fix:
`bar width must never exceed 100%, got 9000%` (test failure, confirmed with `git stash` on the
component file alone). After the fix: both bars clamp to ≤100%, with the true-largest bucket
rendered at 100%, not the true-smallest.

### Blast radius

Single call site — `ExecutionAnalysisPanel.tsx` is the only consumer of
`summarizeExecutionQuality`'s ordering for a max-premium denominator. `RouteBreakdown.tsx` was
checked and does **not** share the bug (it sorts its own entries by premium before indexing
`[0]`, so `entries[0]` is a true max there by construction — left unchanged). No other panel in
`src/features/helix/components/` indexes `entries[0]` as an assumed max over a non-premium-sorted
source; checked `StrikeStackDetector.tsx`, `SplitFlowRadar.tsx`, `SessionCorrelationMatrix.tsx` —
each either delegates its own max/denominator math to its lib layer or doesn't compute one.

### Fix rationale

Changed the denominator to a genuine max over the whole entries array:

```ts
const maxPremium = Math.max(1, ...entries.map((e) => e.premium));
```

This is correct regardless of what order `summarizeExecutionQuality` returns its buckets in — the
fixed semantic display order (aggressive/passive/mid/unknown) is deliberate and desirable for
*display* (it's how a trader expects to scan the rows) and is left completely untouched; only the
scaling denominator was wrong. Considered sorting `entries` by premium before rendering (matching
`RouteBreakdown.tsx`'s approach) and rejected it: this panel's fixed semantic order is the point —
sorting by premium would put "fill quality" rows in an order that no longer groups "all the
aggressive activity" together, which is what a trader scanning this panel wants.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PzDkDzjR3bJQsFbXENzsVz
