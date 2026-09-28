# P2: SPX Slayer play gates.blocks shows the same trade idea twice — FIXED

> **kind:** FINDING

## Problem

Live repro (2026-09-28, `GET /api/market/spx/play`, reproduced on two separate live fetches):
`gates.blocks` carried two near-identical lines back to back —

```
"Tape's mixed, but Calls lean — 7695 Call on watch · At 0DTE support node 7695 (+1 pts) · waiting for grade confirmation"
"Tape's mixed, but Calls lean — 7695 Call on watch · At 0DTE support node 7695 (+1 pts)"
```

Same read (5-engine live monitor, standing mandate) also confirmed reproducible on a second live
fetch 1.5s later with different price/strike inputs — same duplication shape, not a one-off.

## Root Cause

`humanizeGateBlock` (`spx-play-intel.ts`) replaces several structurally different raw gate reasons
with the same synthesized text when they match a substring check:

- `block.includes("headwinds") || block.includes("too many conflicts")` → `buildPlayIdeaIntel()`
- `block.includes("too low — quality setups only")` → `buildPlayIdeaIntel()`
- `block.includes("below minimum")` → `buildPlayIdeaIntel() + " · waiting for grade confirmation"`
- `block.includes("Confirmations") && block.includes("need stronger alignment")` →
  `buildPlayIdeaIntel() + " · confirmations still building"`

`buildPlayIdeaIntel(desk, confluence)` is a pure function of `desk`+`confluence` — it does not
depend on which raw gate triggered it. A weak setup very commonly fails the grade gate
(`Grade ${grade} below minimum (need B or better)`, `spx-play-gates.ts`) AND the score gate
(`Score ${abs} too low — quality setups only`) simultaneously, so BOTH raw reasons hit different
branches above and both get replaced with the identical base idea line — one with the
"waiting for grade confirmation" suffix, one without. `humanizeGateBlocks` was a plain `.map()`
with no dedup, so both survived into the final array.

## Fix

`humanizeGateBlocks` now tracks the idea line's own prefix (before any trailing `" · ..."` clause)
across the whole array and keeps only the FIRST occurrence — later raw gates that would humanize to
the same idea are dropped. First occurrence naturally keeps the more informative (suffixed) variant,
since `spx-play-gates.ts` pushes the grade-below-minimum check before the score-too-low check.
Blocks that never matched a humanize branch (e.g. the generic "Cold BUY needs score ≥78..." /
"Cold BUY requires grade A or better..." lines) are untouched.

## Files Changed

- `src/features/spx/lib/spx-play-intel.ts` — `humanizeGateBlocks` dedup logic + comment.
- `src/features/spx/lib/spx-play-intel.test.ts` — new regression test reproducing the exact live
  duplicate shape.

## Evidence

- Live repro: `GET /api/market/spx/play`, two separate fetches ~1.5s apart, both showing the same
  duplication shape with different live strike/price values.
- New regression test RED pre-fix (`git stash` proof) / GREEN post-fix.
- `npx tsc --noEmit` — clean.
- `npx tsx --experimental-test-module-mocks --test src/features/spx/lib/spx-play-intel.test.ts
  src/features/spx/lib/spx-play-gates.test.ts` — 29/29 pass, no regression.

## Status

| **Status** | FIXED |
| --- | --- |
| **Commit** | this PR |
| **PR** | small, single-issue |
