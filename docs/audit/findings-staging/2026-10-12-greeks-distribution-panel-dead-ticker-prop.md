## 2026-10-12 — [Thermal] GreeksDistributionPanel carried a dead required `ticker` prop — FIXED
> **kind:** `FINDING`

| **Area** | **Severity** | **Status** |
|---|---|---|
| Thermal / dead code | P3 — harmless at runtime, pure cleanup | FIXED |

**What's wrong.** `src/features/thermal/components/GreeksDistributionPanel.tsx` declared
`ticker: string` as a required prop, destructured it as `ticker: _ticker`, and never referenced
it anywhere in the component body — confirmed via grep, the name appears exactly twice in the
whole file (the type declaration and the underscore-prefixed destructure). Its parallel sibling
`ThetaDistributionPanel` (same tab group, rendered as the alternate "pair-d" lens in
`GexHeatmap.tsx`) has no `ticker` prop at all and renders fine without it — an inconsistency
between two near-identical components where one carries a vestigial prop the other never
needed. The caller (`GexHeatmap.tsx`) passed `ticker={ticker}` for no effect.

**Fix.** Removed the `ticker` prop from `GreeksDistributionPanelProps`, the destructure, and the
caller's pass-through in `GexHeatmap.tsx`. Updated the existing test helper
(`GreeksDistributionPanel.test.tsx`) to stop passing the now-removed prop.

**Verification.** `npx tsx --experimental-test-module-mocks --test
src/features/thermal/components/GreeksDistributionPanel.test.tsx` → 13/13 pass (unchanged — the
prop was never read, so removing it changes no rendered output). `tsc --noEmit` clean.

**Blast radius.** `GreeksDistributionPanel.tsx`, its one caller in `GexHeatmap.tsx`, and its own
test file. No other callers exist (confirmed via repo-wide grep for `GreeksDistributionPanel`).

Found via a background Explore-agent sweep of the Vector/Thermal desk UI, independently
re-verified (confirmed the prop's only two occurrences in the file, `ThetaDistributionPanel`'s
lack of an equivalent prop, and the caller's pass-through) before fixing.
