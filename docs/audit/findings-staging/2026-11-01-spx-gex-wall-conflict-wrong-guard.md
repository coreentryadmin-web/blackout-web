> **kind:** FINDING

## SPX Slayer `computeWeightedConflicts` silently drops a real, nearby opposing GEX wall when the mutually-exclusive nearer wall was scored — FIXED

**Status:** Fixed, regression test added (`src/features/spx/lib/spx-play-conflicts.test.ts`).

### Root cause

`computeSpxConfluence` (`src/features/spx/lib/spx-signals.ts`) has a deliberate mutual-
exclusivity rule (documented inline as "ISSUE-01"): when price sits between a support wall
and a resistance wall that are BOTH within 12 points, only the **nearer** wall is scored into
`factors` — the farther wall is dropped entirely and never reaches `factors`, by design, so
a rangebound market doesn't double-count both walls into the score.

`computeWeightedConflicts` (`src/features/spx/lib/spx-play-conflicts.ts`) separately computes
a desk-level "is GEX opposed to this direction" signal (`gexOpposed`) from the raw
`desk.gex_walls` array — independent of which wall `computeSpxConfluence` actually scored —
specifically so a genuinely-opposing wall that mutual exclusivity dropped from `factors`
still gets counted as a conflict. But the guard that was supposed to avoid double-counting
when the opposing wall WAS already scored checked the wrong thing:

```ts
if (gexOpposed(desk, direction) && !factors.some((f) => f.label.includes("GEX") || f.label.includes("γ"))) {
  weighted += 2;
}
```

This suppresses the +2 bonus whenever **any** GEX/γ-labeled factor exists in `factors` at
all — agreeing or opposing. So whenever mutual exclusivity scored the AGREEING wall (e.g.
"GEX support", bullish, nearer to price) while the genuinely-opposing wall ("GEX resistance",
farther but still within 12pts, dropped by mutual exclusivity) was never added to `factors`,
the guard saw "a GEX factor exists" and wrongly concluded the opposition was "already
counted" — when in fact nothing in `factors` represents it at all. The real, nearby,
opposing wall silently disappears from `weighted_conflicts`.

This is reachable in real production data any time price sits between two GEX walls both
within 12 points of spot (a common rangebound/pin-adjacent configuration), with the nearer
wall agreeing with the net direction and the farther wall opposing it.

### Evidence

- **RED (pre-fix):** a desk with `gex_walls: [{support, 7396, 4pts away}, {resistance, 7410,
  10pts away}]` and `factors` containing only the mutually-exclusivity-scored "GEX support"
  (+18, agreeing with a long) plus an unrelated "0DTE flow" factor (+14) — exactly the shape
  `computeSpxConfluence` would actually produce for this desk — returned
  `weighted_conflicts: 0` from `computeWeightedConflicts`, even though a resistance wall
  10pts away genuinely opposes the long and appears nowhere in `factors`.
- **GREEN (post-fix):** the same input now returns `weighted_conflicts: 2`, correctly
  flagging the real, unscored opposition.
- Full `spx-play-conflicts.test.ts` (5/5), `spx-play-gates.test.ts`, and `spx-signals.test.ts`
  pass unchanged (44/44) — including the existing "does not double-count news when News risk
  factor is already scored" test and the `gamma_flip`-null regression test, both still green.
- All 960 tests under `src/features/spx/**/*.test.ts` pass (Node 20,
  `--experimental-test-module-mocks`).
- `npx tsc --noEmit` clean on the whole project.

### Blast radius

`weighted_conflicts` feeds `evaluatePlayGates`'s entry-mode sizing (`maxWeightedForEntryMode`)
and `mixedTapeGateMessage`'s "Tape's mixed" hard block — both gate real BUY decisions. Under-
counting a genuine conflict means a setup that should have been capped to starter size, or
blocked outright as "mixed", could instead clear the full-size entry gate with a hidden,
unscored risk (a nearby opposing GEX wall) sitting right next to spot. The fix only changes
the GEX/γ double-count guard; `conflicts` (the unweighted count), the main
`factorOpposes`-driven weighting loop, and the news/tide/VIX guards are untouched.

### Fix rationale

Changed the guard from "does any GEX/γ-labeled factor exist in `factors`" to "does an
existing GEX/γ-labeled factor actually OPPOSE `direction`" — reusing `factorOpposes`, the
same helper the main weighting loop already uses, so the two can never disagree on what
counts as "opposing". This correctly distinguishes "the opposing signal was already counted
via a scored factor" (true double-count, still suppressed) from "an unrelated agreeing GEX
factor happens to exist while the real opposing wall was dropped by mutual exclusivity"
(not a double-count — now correctly added). Rejected: changing `computeSpxConfluence` to
always push both walls (would reintroduce the exact double-counted-score problem ISSUE-01
was written to fix) or removing the mutual-exclusivity rule (same problem, different file).

### Deliberately left unchanged

- `computeSpxConfluence`'s mutual-exclusivity scoring (ISSUE-01) — correct and intentional;
  only the downstream conflict-counting guard was wrong.
- `gexOpposed`'s own wall/regime detection logic — correct; it already independently re-derives
  opposition from the raw desk data for exactly this reason.
- The news/tide/VIX "already scored" guards (`newsAlreadyScored`, `Market tide` check,
  `vixAlreadyScored`) — each checks a label that can only ever be scored on one side for a
  given desk snapshot (no mutual-exclusivity ambiguity like the GEX-wall case), so they were
  not re-audited as part of this fix.
