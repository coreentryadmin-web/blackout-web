> **kind:** FINDING

## Thermal — `GreeksDistributionPanel` mislabels Vanna/Delta exposure as "gamma" — FIXED

| | |
|---|---|
| **Area** | Thermal / GEX Heatmap (`/heatmap` desk) |
| **Severity** | P3 — UI copy, misleading terminology, no data/scoring impact |
| **Status** | Fixed, PR [#7379](https://github.com/coreentryadmin-web/blackout-web/pull/7379) |

### Root cause

`GexHeatmap.tsx`'s pair-d tab renders `GreeksDistributionPanel` for every lens except
CHARM (which gets the dedicated `ThetaDistributionPanel`) — i.e. for GEX, VEX (vanna), and
DEX (delta) alike, each time passing that lens's own `cells` block
(`src/features/thermal/components/GexHeatmap.tsx`, pair-d `TabPanel`).

The underlying analysis (`analyzeGreeksDistribution` in
`src/features/thermal/lib/gex-heatmap/greeks-distribution.ts`) is correctly lens-agnostic — it
just sums `|value|` per strike, whichever Greek it is — but the panel's "Insights" list
hardcoded the English word **"gamma"** regardless of which lens's data it was showing: when
`clusterCount > 2`, it unconditionally rendered **"Multiple distinct gamma clusters
detected"**, even while displaying VEX (vanna) or DEX (delta) exposure data.

The sibling `ThetaDistributionPanel` has no equivalent bug — it is only ever rendered for the
CHARM lens, so its hardcoded "charm"/"decay" wording is always correct. `GreeksDistributionPanel`
is the one component shared across three different Greeks (GEX/VEX/DEX), and the one place this
hardcoding was wrong.

Why it wasn't caught earlier: the pre-existing test suite only ever rendered the panel with no
`lens` prop, so it only ever exercised the GEX case, where "gamma" happens to be the correct word.

### Evidence

Added a regression test in `GreeksDistributionPanel.test.tsx` that renders the *same* cells
(alternating high/low strikes producing `clusterCount === 3`, the exact condition gating this
bullet) once per lens (`gex`, `vex`, `dex`).

- **RED pre-fix** (confirmed via `git stash` of the two source-file changes, test kept): 1 test
  failed — `vex lens should say vanna clusters` — with the actual rendered text containing
  `"...Multiple distinct gamma clusters detected..."` while fed vanna data.
- **GREEN post-fix**: 14/14 tests pass in `GreeksDistributionPanel.test.tsx`.
- Full `thermal` feature test suite (155 tests across components + `gex-heatmap` + lib): clean.
- `tsc --noEmit`: clean.

### Blast radius

Single call site — `GreeksDistributionPanel` has no importer besides `GexHeatmap.tsx`.
`ThetaDistributionPanel`, `analyzeGreeksDistribution`, and `analyzeThetaDistribution` are
untouched; this is a presentation-layer label fix only, no data/scoring logic changed.

### Fix

`GexHeatmap.tsx` already has the correct per-lens vocabulary (`LENS_VOCAB`, noun
"Gamma"/"Vanna"/"Delta"/"Charm") used everywhere else in that file for exactly this purpose.
Threaded the same concept into `GreeksDistributionPanel` via a new optional `lens` prop
(`"gex" | "vex" | "dex"`, default `"gex"` — so every existing caller, including the pre-existing
tests, keeps the exact pre-fix "gamma" wording unless a non-default lens is explicitly passed),
and used it to pick the correct noun ("gamma"/"vanna"/"delta") for the one bullet that named a
specific Greek. `GexHeatmap.tsx`'s call site now passes `lens={lens}`.
