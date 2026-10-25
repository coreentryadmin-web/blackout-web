> **kind:** FINDING

## Swing play-brief: a committed OPEN position's own entry price and exit-policy stop/target rails never reached `envelope.evidence[]` — FIXED

| **Status** | FIXED (PR #TBD, this branch) |
|---|---|

### Root cause

`evidenceFromContext()` in `src/lib/swing/play-brief.ts` is the sole feeder of the typed,
provenance-bearing `envelope.evidence[]` array (and, downstream, `evidence_numbers`, derived 1:1
from it) — confirmed repeatedly by this lane's own prior fixes for the identical bug class (the
peers/`arsenal.related` gap fixed in PR #6480 and the `play.score`/`play.factors` gap fixed in PR
#6481, both in this same function).

For a committed, OPEN swing position, two more numbers are rendered prominently in brief prose but
never mirrored into that function:

- `pnlSection()` (`play-brief.ts`, the "Position" section) renders `` `Entry: **${fmtUsd(play.entry)}**` ``
  off `play.entry`.
- `managementSection()` (`play-brief.ts`, the "Management" section) renders
  `` `Rails: stop ${stopLabel} · target ${targetLabel}` `` off `play.exitPolicy.stop_premium` /
  `play.exitPolicy.target_premium`.

`evidenceFromContext()` never read `play.entry` or `play.exitPolicy.stop_premium`/`target_premium`
at all (confirmed by grep: the only other call sites of `stop_premium`/`target_premium` in the
file are inside `managementSection()` itself). So a structured/machine consumer of the brief —
exactly the audience `evidence[]`/`evidence_numbers` exist to serve — had no typed, citable way to
learn the position's own entry price or its stop/target rails, even though a member reading the
rendered markdown sees both prominently. Same "rendered-in-prose-but-never-mirrored-to-evidence[]"
defect class as the peers/score fixes above.

### Evidence

Live repro (per the audit that raised this finding): `GET /api/market/swing/play-brief?playId=
SWING:FLY&ticker=FLY&expandIntel=1` —

- "Position" section: `"Entry: **$0.55**\nMark: **unknown**..."`
- "Management" section: `"...Rails: stop $0.22 · target $1.10"`
- `envelope.evidence[]` (7 items) carried no entry/stop/target fact; `evidence_numbers` (derived
  1:1 from `envelope.evidence`) likewise carried none.

RED→GREEN proof via a temporary local revert of the source change alone (test file left in place,
the fix then restored via `git checkout` — this worktree's git history is private to this branch,
so no shared stash was used): reverting just the `evidenceFromContext()` addition in `play-brief.ts`
made the new positive-case test fail (`not ok 49`, "expected a citable entry-price evidence
entry"), while the rest of `play-brief.test.ts` passed 176/177; restoring the fix brought the suite
back to 177/177. `npx tsc --noEmit` clean. The broader swing play-brief suite
(`play-brief.test.ts` + `play-brief-intel.test.ts` + `play-brief-narrative.test.ts` +
`play-brief-narrative-coaching.test.ts` + `play-brief-absence.test.ts`, 778 tests combined) is
778/778 green post-fix.

### Blast radius

Single call site: `evidenceFromContext()` in `play-brief.ts` is the only consumer of
`play.entry`/`play.exitPolicy` that needed a new mirror. `pnlSection()`'s and
`managementSection()`'s own prose rendering are untouched and correct — they were always the
source of truth this fix mirrors, not the defect. No other function in the swing play-brief lane
independently renders these two fields from scratch.

### Fix rationale

Added two new, additive evidence facts at the end of `evidenceFromContext()`, gated on
`statusBucket(ctx.play) === "open"` — the EXACT bucket `managementSection()`/`pnlSection()`
themselves are built under in `composeSwingPlayBrief()` (the `bucket === "open"` branch). This
means the new facts can never cite a number for a WATCH or CLOSED bucket whose brief carries no
matching Management/Position section to back it: `play.entry` is `null` for every WATCH candidate
until commit (per `siblingPositionsNote()`'s own doc comment — "a WATCH row is never itself
committed"), and a CLOSED play gets an "Outcome" section instead (`closedSection()`), never
Position/Management. Each fact is only pushed when its own field is genuinely present (`entry`
finite, and at least one of `stop_premium`/`target_premium` non-null) — never fabricated for a
degraded row. Provenance source is `"Swing ledger"` (matches the sibling book-overlap/sibling-count
facts a few lines above in the same function, the correct source label for ledger-resident
position state), `freshness: "recent"` (these are live position fields refreshed on every tick by
`swing-active-refresh`, not a commit-time snapshot like the score fact above it — so they do not
need the `committedAt`-anchored freshness treatment that fact required). Deliberately left
unchanged: `pnlSection()`/`managementSection()`'s own rendering, the trim-ladder/runner-trail
disclosure logic inside `managementSection()`, and every other evidence fact in the function.

### Tests

Added to `src/lib/swing/play-brief.test.ts`: a positive-case test (OPEN position with a real
`entry`/`exitPolicy.stop_premium`/`target_premium` — proves both new facts are emitted with the
exact rendered dollar values and `"Swing ledger"` provenance) and a negative-case test (WATCH with
no entry/exitPolicy, and CLOSED with both present — proves neither fact is fabricated outside the
`open` bucket). RED→GREEN confirmed (1 new failure pre-fix on the positive-case test, 177/177 green
post-fix). `npx tsc --noEmit` clean. Broader swing play-brief suite (778 tests across 5 files)
green post-fix.
