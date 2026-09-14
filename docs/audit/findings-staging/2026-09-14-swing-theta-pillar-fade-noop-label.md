> **kind:** FINDING

## Ask Largo swing "Pillar fade" narrative rendered "drifted DTE 4 migrate → DTE 4 migrate" — a no-op-looking transition despite a real score fade — FIXED

| **Status** | FIXED (this commit) |
|---|---|

**Root cause:** `thetaBudgetScore()` (`src/lib/swing/thesis-health.ts`) returns one shared
`{commit, current, label}` object per DTE band. Unlike every other pillar scorer in this file
(persistence/entry_geometry/flow_corroboration/regime, which genuinely have identical commit and
current labels because they're read from a single evolving state with no independent "at entry"
snapshot), theta budget's `commit` and `current` SCORES deliberately diverge from a single `dte`
input — time decay is the whole point of the pillar (e.g. migrate band: commit 0.75, current
0.55) — but the `label` field was a single string used for both. `toPillarPair()` then copied
that one label into both `commit.label` and `current.label`, so `play-brief-narrative-coaching.ts`'s
`thesisPillarCoaching()` (`"drifted ${commitLabel} → ${currentLabel}"`) rendered a transition where
both sides read identically.

**Evidence (live reproduction, 2026-09-14, CLSK):** pulled CLSK's live play-brief (HOLD, LONG,
entry $0.28, mark $0.17, -41.1%). "Trade manager read" section:

> Pillar fade — Theta budget drifted DTE 4 migrate → DTE 4 migrate (Δ -3 pts)

The pillar's `status` was genuinely `"faded"` (score 0.75→0.55 crossing `pillarStatus`'s -5..-20
centipoint band) — a real signal worth surfacing — but the label pair gave a member reading this
line zero information about what actually changed, reading as a copy-paste artifact rather than a
real transition.

**Blast radius:** `thetaBudgetScore` is the only scorer in this file whose commit/current SCORES
diverge from a single input while sharing one label — confirmed by reading all five scorer
functions. `setupPersistenceScore`'s `INVALIDATED` branch (commit 0.2, current 0) has the same
shape but is NOT fixed here: unlike theta budget, its "commit" score doesn't represent a real,
statable fact this function has access to (the setup was, by definition, NOT invalidated at
commit — the true pre-invalidation commit-time state isn't passed into this function), so a
distinct commitLabel there would need a frozen commit-time setupState this call site doesn't
currently carry. Noted here rather than guessed at.

**Fix:** `thetaBudgetScore` now returns a `commitLabel` distinct from the current-state `label`
in the two bands where the score actually fades (cliff/migrate: `"full runway assumed"`); the
ample-runway band keeps commit and current labels identical since there's no divergence to
explain. `toPillarPair()` now accepts an optional `commitLabel`, defaulting to `label` when
omitted — every other call site (persistence/entry/signals/regime) is unchanged, since none of
them pass it.

**Fix rationale:** conceptually, "at commit" for a fresh swing entry always assumes ample runway
ahead (a setup wouldn't be entered already near its DTE cliff) — "full runway assumed" states that
plainly without inventing a specific number this function doesn't track. Scores themselves are
untouched; only the label pairing changed, so `pillarStatus`/health-percentage math is
byte-identical.

**Test:** RED→GREEN proven (git-stashed the source fix, confirmed both new migrate/cliff tests
fail with identical commit/current labels pre-fix, restored and confirmed green). Added 3 tests:
migrate band (labels differ, status "faded"), cliff band (labels differ, status "lost"), and
ample-runway band (labels legitimately match, status "intact" — proving the fix doesn't force a
spurious difference where none exists). Full `src/lib/swing/*.test.ts` (1120 tests) green, `tsc
--noEmit` and `eslint` clean.
