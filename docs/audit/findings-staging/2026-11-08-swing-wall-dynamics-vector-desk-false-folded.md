> **kind:** FINDING

## Ask Largo swing play-brief: `collapseRedundantIntelSections` drops "Wall dynamics" and "Vector desk" and falsely claims they were "folded into Trade manager read" — FIXED

| | |
|---|---|
| **Area** | Night Hawk Swings — Ask Largo swing play-brief narrative pipeline |
| **Status** | FIXED |
| **File** | `src/lib/swing/play-brief-intel-collapse.ts` (`collapseRedundantIntelSections`), `src/lib/swing/play-brief-intel.ts` (`buildIntelSections`, call site) |

### Root cause

Direct sibling of the same-day "Lane rank" fix
(`docs/audit/findings-staging/2026-11-08-swing-lane-rank-disclosure-gap.md`, PR #7580), which
disclosed this exact pair in its own blast-radius section as unfixed follow-ups. Same mechanism:
`collapseRedundantIntelSections` drops every section whose title is in the static
`NARRATIVE_COVERED_TITLES` set whenever a narrative ("Trade manager read") is present for a
non-closed bucket, then unconditionally claims the dropped content was "folded into Trade manager
read above." Two more titles in that set carry the identical false assumption:

- **"Wall dynamics"** — `wallDynamicsSection` (`play-brief-intel.ts`) renders real content
  whenever `vec.wallEvents.length >= 1` (after a staleness gate exempted only for a CLOSED
  bucket). The narrative's `wallDynamicsCoaching` (`play-brief-narrative-coaching.ts`) requires
  BOTH a fresh snapshot AND `events.length >= 2`. A ticker with exactly one real wall-transition
  event on a fresh Vector read gets a real "Wall dynamics" section with nothing in the narrative
  to fold into.
- **"Vector desk"** — `vectorDeskSection` renders real content (last-snapshot grade/conviction)
  for a stale-but-not-closed read too (its "Last snapshot ... may lag spot" branch, gated only on
  `vec.play` existing at all). The narrative's `vectorPlayCoaching` returns `null` outright on ANY
  stale Vector snapshot, no exception. Same false-fold shape, one level off: staleness instead of
  event count.

Both mismatches only matter for the OPEN/WATCH buckets — `collapseRedundantIntelSections` has its
own unconditional early return for `bucket === "closed"` (verified, unchanged, pre-dating this
fix: "Closed post-mortem narrative only runs closedCoaching... Collapsing those intel sections
would delete real frozen-at-close context"), so a CLOSED brief never reaches the filter at all and
both titles already survive there regardless of this fix.

### Evidence (RED → GREEN)

**Regression tests** (mirroring the "Lane rank" fix's test shape exactly):

- `src/lib/swing/play-brief-intel-collapse.test.ts` — 6 new unit tests on
  `collapseRedundantIntelSections`'s two new opts (`wallDynamicsFolded`, `vectorDeskFolded`): each
  title kept + the drop-count note reflects only what was actually dropped when the flag is
  `false`; each omitted flag defaults to the same safe "keep" outcome as explicit `false`; each
  title still collapses normally (with the note) when the flag is `true`.
- `src/lib/swing/play-brief-intel.test.ts` — 2 new `buildIntelSections`-level integration
  regressions:
  - A real OPEN play with exactly 1 fresh wall event → "Wall dynamics" survives the collapse.
  - A real OPEN play with a stale Vector snapshot and real `vec.play` data (headline/grade/
    invalidation) → "Vector desk" survives the collapse.
  (A CLOSED-bucket variant of the "Vector desk" case was considered and deliberately NOT added —
  it would pass vacuously both before and after this fix, since `bucket === "closed"` bypasses
  the whole collapse filter; see Fix rationale.)

**RED → GREEN proof:** reverted only `src/lib/swing/play-brief-intel-collapse.ts` and
`src/lib/swing/play-brief-intel.ts` to their pre-fix (HEAD) content via `git show HEAD:...`
(source only — the new/edited test files were left as the fixed-version tests), then ran
`src/lib/swing/play-brief-intel-collapse.test.ts` + `src/lib/swing/play-brief-intel.test.ts`:
**366 pass / 6 fail** — exactly the 6 new negative assertions (both titles' `false`/omitted-flag
cases at both the unit and integration level) failed as expected; the two `true`-flag unit tests
passed vacuously (old code drops unconditionally regardless of any option), same vacuous-pass
shape the sibling "Lane rank" fix's own RED proof documents. Restoring the fix: **372/372 pass**.

**Full suite + typecheck post-fix:** `npx tsc --noEmit` clean. Full `npm test` run in progress at
write time (Node 20, `scripts/run-tests.mjs`) — see the PR for the final tally.

### Blast radius

Single call site for the fix — `buildIntelSections`'s one call to
`collapseRedundantIntelSections` (`play-brief-intel.ts`). No other caller of
`collapseRedundantIntelSections` exists repo-wide (same as the sibling "Lane rank" fix's own
blast-radius note).

This closes both of the two disclosed-but-not-fixed follow-ups named in
`docs/audit/findings-staging/2026-11-08-swing-lane-rank-disclosure-gap.md`'s blast-radius section.
No new mismatch of this shape was found while working this fix in the other five
`NARRATIVE_COVERED_TITLES` entries ("Levels on chart", "GEX posture", "Flow & positioning",
"Macro tape", "Hold plan") — each of those was independently re-verified elsewhere to have its
narrative-side coaching function cover the SAME structural condition its section-builder uses to
render (unlike this pair and "Lane rank"), so they correctly stay on the unconditional-drop path
and were left untouched, per the standing single-issue-PR policy.

### Fix rationale

Mirrors the established `laneRankFolded` remediation shape exactly: the caller
(`buildIntelSections`) recomputes the exact same predicate each narrative coaching function uses
— a direct function call, not a string-match against `narrative.body` — and passes the result
down as a new opt (`wallDynamicsFolded`, `vectorDeskFolded`). The collapse function defaults to
the *safe* outcome (keep the section, never claim an unproven fold-in) when either flag is omitted
or `false`.

One real plumbing gap, handled with the same safe-default philosophy the sibling fix's own doc
comment establishes rather than a larger refactor: `vectorPlayCoaching`'s 4th parameter
(`conflictAlreadyNoted`) is, in the real narrative composer, `vectorConflictAlreadyNoted` —
derived from cross-desk evidence-weight tallying against `crossDeskCoaching`'s own output, not
cheaply reconstructable from `buildIntelSections`'s scope without a materially larger plumbing
change. The fold-check recomputation passes the literal `true` for this parameter only (never for
the real narrative composition itself, which is untouched) — this only makes `vectorPlayCoaching`
*more* likely to return `null` (suppressing the headline clause when it would otherwise render),
which biases the resulting `vectorDeskFolded` flag toward `false` ("don't claim folded"), never
toward a false-positive fold claim. Documented inline at the computation site so a future reader
does not mistake the literal `true` for the real value the narrative composer uses.

Every other title in `NARRATIVE_COVERED_TITLES` keeps its original unconditional-drop behavior
unchanged; `wallDynamicsCoaching`/`vectorPlayCoaching`/`wallDynamicsSection`/`vectorDeskSection`
themselves were not touched — their own internal logic is correct and intentional per their own
extensive doc comments. This fix is only about `collapseRedundantIntelSections` trusting the
static list for these two titles, not about changing either side's actual behavior.
