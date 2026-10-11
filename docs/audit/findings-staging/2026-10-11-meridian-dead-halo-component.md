> **kind:** FINDING

## Meridian — dead `MeridianHalo` component, superseded by its own 3D sibling in the same commit — FIXED

**Symptom:** `MeridianHalo` (`meridian-viz.tsx`) is a fully-implemented segmented-ring SVG
component (per-signal arcs, an inner agreement arc, click handling, a substantial doc
comment explaining its design) with zero references anywhere in `src/`, including
`git log -S "<MeridianHalo "` across all history — it has never been rendered by any
caller since it was added. No test file covers it.

**Root cause:** `MeridianHalo` was added in commit `ab30af1d8` ("feat(meridian): earnings
intelligence rebuild...") in the SAME commit as `MeridianHalo3D` (`meridian-spatial.tsx`),
which IS actively used — confirmed imported by `MeridianEarningsReportPanel.tsx`. Both
versions were built together and share the same underlying read
(`haloFromSignals`/`arcPath` from `meridian-viz-core.ts`), but only the 3D version shipped
into the UI; the 2D sibling was a finished, abandoned alternative, not in-progress work.

**Evidence:** `grep -rn "\bMeridianHalo\b" src/` before the fix: only the definition.
`grep -rln "MeridianHalo3D" src/` confirms it's imported by a real panel component.
`haloFromSignals` (the shared halo-geometry helper both versions call) is confirmed to have
its OTHER real caller in `meridian-spatial.tsx` — not orphaned by this removal.

**Fix:** Removed the `MeridianHalo` function. Removed its now-unused `haloFromSignals` and
`SignalLike` imports from `meridian-viz.tsx` specifically — both are still imported and used
in `meridian-spatial.tsx` for the live 3D version, untouched. `arcPath`/`LEAN_CLASS`/
`MeridianCountUp`/`Lean` (also used by `MeridianHalo`) all have other live callers in the
same file (`MeridianRing`, etc.) and are untouched.

**Fix rationale:** Pure deletion — a complete, confirmed-unrendered sibling of a component
that actually shipped, sharing the exact same data layer.

**Blast radius:** `src/features/meridian/components/meridian-viz.tsx` (one component +
2 now-unused imports removed) only.

**Regression guard:** None needed — `MeridianHalo3D`'s own test/usage coverage already
protects the live replacement; the removed component had none.
