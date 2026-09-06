# Swing play-brief — 7 coaching helpers + wallDynamicsSection + trade-manager proximity/wall-event bullets still narrated from stale Vector snapshots (Largo C2)

> **kind:** FINDING

## Status
FIXED.

## Root cause
#4400–#4402 gated `chartTechnicalsSection`, `chartLevelsSection`, `watchForSection`,
`vectorDeskSection`, `vectorPlayCoaching`, `collectFocalLevels`' king strike, and
`counterThesisLine`'s walls against `vectorSnapshotStale()`. Seven coaching helpers in
`play-brief-narrative-coaching.ts` were never covered by that sweep: `magnetCoaching`,
`expectedMoveCoaching`, `confluenceCoaching`, `wallIntegrityCoaching`, `vexCoaching`,
`flowPrintsCoaching`, `wallDynamicsCoaching` — all still rendered directional/level narration
straight off `vec.*` fields with no staleness check. `wallDynamicsSection` (the intel-section
counterpart in `play-brief-intel.ts`) had the identical gap, and `tradeManagerNarrativeSection`'s
own "Nearest wall" / "Wall just moved" bullets (built from `vec.proximity`/`vec.wallEvents`
directly) were likewise ungated.

Four independent PRs (#4404, #4405, #4406, #4407) converged on parts of this same gap in parallel
and had to be consolidated — #4404/#4405/#4406 were closed as superseded by #4407, but #4407
itself was branched before #4402 merged: its diff reverted #4402's already-shipped fixes
(`chartTechnicalsSection`'s regime gate, `chartLevelsSection`/`watchForSection`'s wall gating,
`vectorDeskSection`'s "Last snapshot" disclaimer) while correctly adding the 7 coaching-helper
gates. GitHub itself flagged it `mergeable_state: dirty` — not mergeable as-is. Rather than merge
a PR that silently regresses shipped fixes, the genuinely new content (7 coaching-helper gates,
`wallDynamicsSection`, `tradeManagerNarrativeSection`'s proximity/wall-event gating) was manually
reconciled on top of current `main` (which already has #4402), so nothing already fixed was lost.

## Evidence
- `npx tsc --noEmit` clean.
- Full `src/lib/swing/*.test.ts`: 787/787 pass (was 779 pre-fix) — 8 new regression tests (one per
  coaching helper + `wallDynamicsSection`), each confirmed RED via `git stash` isolating the source
  fix from the test (8 failures with the fix stashed, 0 with it restored).

## Blast radius
`src/lib/swing/play-brief-narrative-coaching.ts` (7 helper functions), `play-brief-intel.ts`
(`wallDynamicsSection`), `play-brief-narrative.ts` (`tradeManagerNarrativeSection`'s
proximity/wall-event bullets). No API/schema changes — narrative/coaching text only.

## Fix rationale
Same `vectorSnapshotStale(vec, Date.now())` early-return pattern already established across
#4387–#4402, applied to the remaining ungated call sites. Deliberately did NOT adopt #4407's
branch wholesale since it would have regressed #4402's already-merged, already-tested fixes —
cherry-picked only its genuinely new, non-overlapping content instead.
