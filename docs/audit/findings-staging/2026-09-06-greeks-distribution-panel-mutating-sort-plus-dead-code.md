## 2026-09-06 — [FINDING, Thermal desk, P4] `GreeksDistributionPanel` mutated its memoized `analysis.buckets` in place via `.sort()`; plus 2 confirmed-dead exports — FIXED

> **kind:** `FINDING`

### Symptom

Found during a DISCOVERY-lane sweep of the Thermal desk for the population/cohort/order-mismatch
bug class already fixed repeatedly elsewhere this session (SPX gate calibration, Vector/Helix
direction reads, horizon-outcomes grading lane). Thermal itself came back clean on that specific
class — it's been hardened against it across several prior PRs (`recompute-levels.ts`'s #3214
wall-inversion fix, the `rebaseChangePct` regression tests) — but the same sweep surfaced one real
correctness landmine and two dead exports.

### Root cause

`analyzeGreeksDistribution()` (`src/features/thermal/lib/gex-heatmap/greeks-distribution.ts:164`)
returns `buckets` with a documented, load-bearing contract: **strike-ascending** order (`buckets:
buckets.sort((a, b) => a.strike - b.strike)`). `GreeksDistributionPanel.tsx:35` read that memoized
array and computed its "Top 5 Strikes" rail with:

```ts
const top5 = analysis.buckets.sort((a, b) => b.absGamma - a.absGamma).slice(0, 5);
```

`Array.prototype.sort` mutates in place — this silently reorders the component's own memoized
`analysis.buckets` from strike-ascending to gamma-descending, permanently, for every later read of
that same object (re-renders with unchanged `useMemo` deps, or any future code added to the
component that assumes the documented order). Its sibling file gets this exactly right:
`ThetaDistributionPanel.tsx:33` does `[...analysis.buckets].sort(...)` — a copy first, no mutation.

No live-rendering defect exists today: nothing else in `GreeksDistributionPanel` currently reads
`analysis.buckets`' order (only its `.length`, order-independent), and re-sorting an
already-gamma-sorted array by the same comparator is idempotent. This is a **landmine, not yet a
manifested bug** — a real regression is one future edit away (anything reading `analysis.buckets`
order-dependently, or a second consumer sharing the object) — same shape (mutate-in-place vs.
copy-first) as the class of bugs already fixed elsewhere this session, just caught before it shipped
a visible symptom rather than after.

### Fix

Extracted the top-N selection into a pure, exported, unit-tested helper next to
`analyzeGreeksDistribution` (matching the file's existing analyze-then-select pattern):

```ts
export function topGammaBuckets(buckets: GreeksDistributionBucket[], n = 5): GreeksDistributionBucket[] {
  return [...buckets].sort((a, b) => b.absGamma - a.absGamma).slice(0, n);
}
```

`GreeksDistributionPanel.tsx` now calls `topGammaBuckets(analysis.buckets)` instead of sorting
inline. This is directly testable (unlike the inline JSX version, which can't be exercised without
a live two-render React harness), and matches the codebase's established pattern of pure,
independently-tested helpers backing thin presentational components.

### Evidence

- RED→GREEN: `git stash push -- greeks-distribution.ts GreeksDistributionPanel.tsx` (keeping the
  new test) → test fails (`topGammaBuckets is not a function`, confirming the helper — and the
  fix — didn't exist pre-patch) → `git stash pop` → test passes.
- New regression test asserts `analyzeGreeksDistribution`'s `buckets` stays strike-ascending after
  `topGammaBuckets` selects a gamma-ranked top-5 view from it — the exact contract the mutation
  violated.
- `npx tsc --noEmit`: clean.
- Full `npm test` (Node 20.20.2): **13032 pass / 0 fail / 3 skipped**.

### Blast radius

`src/features/thermal/lib/gex-heatmap/greeks-distribution.ts`,
`src/features/thermal/components/GreeksDistributionPanel.tsx`,
`src/features/thermal/lib/gex-heatmap/greeks-distribution.test.ts`. No other caller of
`analyzeGreeksDistribution` or `GreeksDistributionPanel` exists (verified by grep) — single
component, single fix site.

### Also fixed in the same PR — 2 confirmed-dead exports (Thermal desk, same sweep)

1. `src/features/thermal/lib/thermal-compare-presets.ts:133` —
   `isThermalComparePresetId(raw)`, exported, zero callers anywhere in the repo (verified via
   `grep -rn "isThermalComparePresetId"` before/after: 1 file (definition) → 0 files). Removed;
   its sibling `parseThermalComparePresetId` (which it wrapped) is still used and untouched.
2. `src/lib/thermal-discord-card.ts:679` — `thermalDiscordCaptionMode(_columns)`, exported, zero
   callers (same grep pattern, same result). The underscore-prefixed unused parameter was itself a
   tell. Removed; the `ThermalCardColumn` type it referenced is still used elsewhere in the same
   file (verified, 4 other usages remain).

| **Status** | FIXED — PR opened, merge pending CI/peer-review per standing policy |
