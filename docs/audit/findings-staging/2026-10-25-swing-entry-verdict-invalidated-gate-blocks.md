> **kind:** FINDING

## Night Hawk Swings — `swingEntryVerdict`'s INVALIDATED/persistence-gap dont_buy branch dropped real gate blocks — FIXED

| | |
|---|---|
| **Status** | FIXED |
| **Surface** | `src/lib/swing/entry-verdict.ts` (`swingEntryVerdict`) |
| **Severity** | P2 (member-facing: dropped real, live gate evidence from Entry section text) |

### Root cause

This exact file already carries two prior fixes for the identical defect class — `commitGateBlockedBy`
is resolved once, above the `switch`, regardless of which branch fires, but a given branch can still
unconditionally discard it:

1. The top-level `section === "RESEARCH"` early return (fixed 2026-10-08, live AMD repro).
2. The `dont_buy` branch for a lapsed entry-validity deadline (fixed, live MU repro 2026-09-11).

A third instance of the same gap survived in the `dont_buy` branch for `setupState === "INVALIDATED"`
/ `persistenceObserved === true` (lines ~377-386 pre-fix): it returned
`gateBlocks: researchGateBlocks(input)` alone, never appending the real, already-computed
`commitGateBlockedBy` evidence the way the two fixed siblings do.

This branch looked unreachable at first read — `sectionForSwingPlay` (`serving.ts`) already routes
`persistenceObserved === true` or `setupState === "INVALIDATED"` straight to `"RESEARCH"`, which the
top-level early return handles correctly. But `resolveSwingServingSection` (this same file) short-
circuits on a **stamped** `input.servingSection` when one is supplied, skipping that recompute
entirely. So whenever a row's stamped `servingSection` predates a fresher `setupState`/
`persistenceObserved` read — a plausible staleness window on a live board, not a contrived input —
`section` reads as something other than `"RESEARCH"`, `evaluateSwingEntryEnterability` separately
concludes `dont_buy` for the same INVALIDATED/persistence-gap reason, and execution lands in the one
branch that still dropped the live gate evidence.

### Evidence

Live repro (`node --import tsx`):

```js
swingEntryVerdict({
  servingSection: "WATCH", // stale stamp — a fresh read already says INVALIDATED
  setupState: "INVALIDATED",
  commitGateBlockedBy: ["gate:G-S12:halt_feed_stale", "gate:G-S4:regime_degraded"],
});
```

Pre-fix: `gateBlocks: [{code: "thesis_invalidated", ...}]` — the two real, live gate codes
(G-S12 halt-feed-stale, G-S4 regime-degraded) never appear.
Post-fix: `gateBlocks` carries `thesis_invalidated` first (primary, authoritative reason, unchanged)
followed by `g_s12_halt_feed_stale` and `g_s4_regime`.

### Blast radius

Single call site inside `swingEntryVerdict` — every consumer of `TerminalPlay.gateBlocks` for a row
that resolves this way (play-brief's Entry section, play-brief-intel's "Before entry, clear:",
play-brief-narrative-coaching) was affected: the row would silently render only "Structure
invalidated" or "persistence gap" with no mention of the other real, currently-active commit gates,
exactly the same member-visible loss of evidence the two prior fixes in this file corrected for
their own branches.

### Fix rationale

Identical pattern to the two sibling fixes already in this file: compute
`commitGateBlocksForVerdict(commitGateBlockedBy, gateDiagnostics)` (both already in scope from above
the switch) and append it after `researchGateBlocks(input)`'s primary reason, never replacing it —
the thesis-invalidated/persistence-gap verdict stays first and authoritative; the gate detail is
additive context.

### Tests

Added two cases to `entry-verdict.test.ts`: a stamped non-RESEARCH section with `setupState:
"INVALIDATED"` plus live gate codes, and the same shape for `persistenceObserved: true`. RED→GREEN
confirmed: reverting only the source fix (keeping the new tests) fails 2/25 exactly as expected;
reapplying passes 25/25.

- `npx tsx --experimental-test-module-mocks --test src/lib/swing/entry-verdict.test.ts` — 25/25 pass
- `npx tsc --noEmit` — clean
- Full `npm test` (Node 20) run alongside this PR
