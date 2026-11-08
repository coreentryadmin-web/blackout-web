> **kind:** FINDING

## Ask Largo swing play-brief: "Levels on chart", "Flow & positioning", "Macro tape", "Hold plan" also falsely claim they were "folded into Trade manager read" — FIXED

| | |
|---|---|
| **Area** | Night Hawk Swings — Ask Largo swing play-brief narrative pipeline |
| **Status** | FIXED |
| **File** | `src/lib/swing/play-brief-intel-collapse.ts` (`collapseRedundantIntelSections`), `src/lib/swing/play-brief-intel.ts` (`buildIntelSections`, call site; new `levelsOnChartHasUnfoldableContent` helper), `src/lib/swing/play-brief-narrative.ts` (`flowNarrative` exported) |

### Root cause

Direct sibling of the same-day "Lane rank" (#7580) and "Wall dynamics"/"Vector desk" (#7587)
fixes, same mechanism: `collapseRedundantIntelSections` drops every section whose title is in the
static `NARRATIVE_COVERED_TITLES` set whenever a narrative ("Trade manager read") is present for a
non-closed bucket, then unconditionally claims the dropped content was "folded into Trade manager
read above." **Correction to #7587's own finding doc** (`2026-11-08-swing-wall-dynamics-vector-desk-
false-folded.md`): its blast-radius section claimed the other five titles in the set — including
these four — were "independently re-verified elsewhere to have [their] narrative-side coaching
function cover the SAME structural condition [their] section-builder uses to render... so they
correctly stay on the unconditional-drop path." That claim does not hold for four of the five on
re-verification against current source (only "GEX posture" is genuinely fine, confirmed unchanged
post-#5998/#5994) — exactly the kind of same-day staleness trap this repo's own CLAUDE.md warns
about repeatedly. Re-verified directly against source rather than trusted:

- **"Levels on chart"** — `chartLevelsSection` renders GEX king strike / max pain / up to 3
  dark-pool levels with NO cap at all whenever the data is present and not stale. The narrative's
  only counterpart (`tradeManagerNarrativeSection`'s focal-levels loop, via `narrateKing`/
  `narrateMaxPain`/`narrateDarkPool`) is itself subject to that function's own `MAX_BULLETS=14`
  cap, bypassing it only when a given level happens to be the one `resolveInvalidationFocalLevel`
  names for the reserved "Break watch" bullet — confirmed live-documented elsewhere in the same
  file (ticker TPR, the dealer-posture-line fix's own doc comment: "action/Manage plan/Earnings-
  in-4d/.../landed on EXACTLY 14 non-reserved bullets" before a later call ran). Exactly
  reconstructing "was the cap already full by the time the loop reached this level" would mean
  replaying the whole upstream bullet-accumulation order — real duplicated logic that would drift
  the moment any upstream function's own bullet count changed. **Approximated instead**, biased
  toward the same safe "keep" direction: `levelsOnChartFolded` is only `true` when NONE of the
  three at-risk facts (king/max-pain/dark-pool) exist for this ticker at all.
- **"Flow & positioning"** — two independent gaps. (1) The 0DTE sold-iron-condor line has NO
  narrative counterpart by construction, not probabilistically: both `crossDeskCoaching` and
  `counterThesisLine` explicitly zero out their 0DTE directional comparison whenever
  `is_condor === true` (a delta-neutral structure has no "aligned"/"conflict" fact to narrate) — no
  code path anywhere can ever narrate it. (2) `flowNarrative` early-returns `null` whenever the 6h
  HELIX tape has zero prints, BEFORE it ever reaches its own anomalies/notable-prints blocks — but
  `flowIntelSection`'s own "Flow anomalies"/"Notable prints" blocks gate only on `flow_feed_fresh`,
  independent of the 6h print count, so real 24h-anomaly or 48h-notable-print content can render
  with a quiet 6h tape and zero narrative counterpart.
- **"Macro tape"** — `macroTapeSection` renders whenever any of `yield_10_year`/
  `curve_10y_1y_spread`/`cpi` is present, OR `arsenal.breadth` is truthy. `macroTapeCoaching`
  never reads `cpi` at all (confirmed by direct read of the function body — no reference anywhere),
  and its breadth trigger requires `breadth?.tone` specifically, not bare object presence.
- **"Hold plan"** (`bucket === "open"` only) — the bare "Thesis health X% (rung)" bullet renders
  unconditionally whenever `play.thesisHealth` is present and calibrated. `thesisPillarCoaching`
  (the only narrative function that narrates a thesis-health %/rung at all) returns `null` for a
  healthy, stable position: no pillar lost/faded, no real moves (`h.moves` empty or the literal
  "unchanged" sentinel), and `health >= 55`. A second, narrower asymmetry on the same title: the
  Runner-fraction line triggers on `ep.runner_fraction != null` alone, while the narrative's own
  runner-fraction clause (`manageLifecycleCoaching`) is suppressed whenever the position is a full
  flatten (`manageAction` EXIT/STOP_OUT — "showing 'next trim'/'runner after trims' next to 'manage
  engine EXIT' reads as two contradictory plans," per that function's own doc comment).

### Evidence (RED → GREEN)

**Regression tests:**

- `src/lib/swing/play-brief-intel-collapse.test.ts` — 12 new unit tests on
  `collapseRedundantIntelSections`'s four new opts (`levelsOnChartFolded`, `flowIntelFolded`,
  `macroTapeFolded`, `holdPlanFolded`): each title kept + the drop-count note reflects only what
  was actually dropped when the flag is `false`; each omitted flag defaults to the same safe
  "keep" outcome as explicit `false`; each title still collapses normally (with the note) when the
  flag is `true`. Also updated two pre-existing tests whose assertions assumed the OLD
  unconditional-drop default for "Levels on chart"/"Hold plan"/"Flow & positioning" (now
  conditional) — moved the first two out of the generic "drops unconditionally" test, and passed
  `flowIntelFolded: true` explicitly to the "keeps Desk context" test that relies on "Flow &
  positioning" actually collapsing.
- `src/lib/swing/play-brief-intel.test.ts` — 4 new `buildIntelSections`-level integration
  regressions, one per title, each a genuinely-reachable live shape:
  - A real OPEN play with a fresh Vector-ladder GEX king strike → "Levels on chart" survives.
  - A real OPEN play with a committed 0DTE sold condor (`is_condor: true`) on the same session
    date, narrative rendering non-null via a real, independent 6h HELIX tape → "Flow &
    positioning" survives (proving the fix isn't just riding on `hasNarrative` being false).
  - A real OPEN play with only a bare CPI print in `arsenal.macro` (no yield/curve/breadth) →
    "Macro tape" survives.
  - A real OPEN play with a healthy (`health: 70`), unchanged-since-commit thesis → "Hold plan"
    survives.

**RED → GREEN proof:** `git stash push -u` isolating only the three source files
(`play-brief-intel-collapse.ts`, `play-brief-intel.ts`, `play-brief-narrative.ts`) back to their
pre-fix content, leaving the new/edited test files in place, then ran both test files:
- `play-brief-intel-collapse.test.ts`: **20 pass / 8 fail** — exactly the 8 new negative
  assertions (4 titles × kept-when-false + omitted-defaults-to-safe) failed as expected.
- `play-brief-intel.test.ts`: **360 pass / 4 fail** — exactly the 4 new integration regressions.

Restoring the fix (`git stash apply` + drop): **28/28** and **364/364** respectively, both GREEN.

**Full suite + typecheck post-fix:** `npx tsc --noEmit` clean. `src/lib/swing/*.test.ts` (86 files,
2280 tests): **2280/2280 pass**. Full `npm test` (Node 20, `scripts/run-tests.mjs`) run at write
time — see the PR for the final tally.

### Blast radius

Single call site for the fix — `buildIntelSections`'s one call to
`collapseRedundantIntelSections` (`play-brief-intel.ts`). No other caller of
`collapseRedundantIntelSections` exists repo-wide (same as the sibling "Lane rank"/"Wall dynamics"/
"Vector desk" fixes' own blast-radius notes). One additional surface: `flowNarrative`
(`play-brief-narrative.ts`) changed from module-private to `export` so `buildIntelSections` can
call it directly for the `flowIntelFolded` predicate, rather than re-deriving its early-return
condition a second, drift-prone way — no behavior change, the function body is untouched.

This closes the four remaining titles named (incorrectly, as "already fine") in #7587's finding
doc. "GEX posture" is confirmed genuinely unconditional (unchanged, post-#5998/#5994) and was left
untouched, per the standing single-issue-PR / scope-discipline policy.

### Fix rationale

Mirrors the established `laneRankFolded`/`wallDynamicsFolded`/`vectorDeskFolded` remediation shape
for three of the four: the caller (`buildIntelSections`) recomputes the exact same predicate each
narrative coaching function uses — a direct function call, never a string-match against
`narrative.body` — and passes the result down as a new opt. `macroTapeFolded`/`holdPlanFolded`
(and the condor/anomaly sub-cases of `flowIntelFolded`) follow this exactly.

"Levels on chart" is the one genuine exception, documented as such rather than silently
approximated: the real predicate is state-dependent on the full upstream bullet count at the point
the focal-levels loop runs, which isn't cheaply reconstructable without duplicating a large, easily
-drifting chunk of `tradeManagerNarrativeSection`. `levelsOnChartHasUnfoldableContent` (new,
`play-brief-intel.ts`, next to `chartLevelsSection`) instead mirrors only `chartLevelsSection`'s own
existence/staleness gates for the three at-risk facts and treats the fold as unproven whenever any
of them exist — this under-folds in the rare case the cap genuinely had room (the section stays
visible slightly more often than strictly necessary) but can never falsely claim a fold that
actually starved. Documented inline, and in `NARRATIVE_COVERED_TITLES`'s own doc comment, as an
intentional approximation rather than an exact predicate.

Every other title in `NARRATIVE_COVERED_TITLES` keeps its original behavior unchanged;
`chartLevelsSection`/`flowIntelSection`/`macroTapeSection`/`holdPlanSection`/`flowNarrative`/
`macroTapeCoaching`/`thesisPillarCoaching`/`manageLifecycleCoaching` themselves were not touched —
their own internal logic is correct and intentional per their own extensive doc comments. This fix
is only about `collapseRedundantIntelSections` trusting the static list for these four titles, not
about changing any side's actual rendering/narration behavior.
