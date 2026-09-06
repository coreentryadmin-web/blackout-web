# Ask Largo swing brief — no book/portfolio-concentration awareness

> **kind:** FINDING

| | |
|---|---|
| **Status** | FIXED |
| **Severity** | P2 (product enhancement — genuine gap, not a defect) |
| **Area** | Swing / Ask Largo play brief |
| **Files** | `src/lib/swing/play-brief-types.ts`, `src/lib/swing/play-brief-context.ts`, `src/lib/swing/play-brief-intel.ts`, `src/lib/swing/play-brief-intel.test.ts` (new) |

## Context

Per the operator's standing directive to deeply improve Largo's swing play brief from a real
trader's perspective (collaborating with Cursor on the `play-brief*` family — see PR #4076,
#4077, #4081), this sweep asked: what does a trader actually need to know about a single play
that the brief currently omits?

## Root cause / gap

`src/lib/swing/portfolio.ts` already implements `checkPortfolioOverlap()` — a pure, deterministic
theme/correlation overlap detector shared with the swing entry gate (via `theme-cluster.ts`'s
`resolveTheme`/`sameThesis`, the SEV-9-unified partition also used by the 0DTE governor's
`CORRELATION_GROUPS`). It answers exactly the question a trader asks before adding a new swing
play: *"do I already have exposure to this theme, and does this new play stack the same bet or
fight an existing one?"*

Grepping every `play-brief*.ts` file confirmed `checkPortfolioOverlap`/`portfolio.ts` was **never
imported or called from the brief composer** — the brief happily recommends BUY on NVDA while the
member silently already holds AMD + SMH LONG (the same "semis" theme, per the SEV-9 invariant
`sameThesis("QQQ","NVDA") === true`) with zero mention of it. The brief is single-play-scoped by
construction (`composeSwingPlayBrief(ctx: SwingPlayBriefContext)` takes one `TerminalPlay`), so
this isn't a bug in the existing logic — it's a real, verified gap: the deterministic engine to
answer this question already exists and is exercised elsewhere, but nothing wires it into the one
place a trader reads before pulling the trigger.

## Fix

- `SwingPlayBriefContext` gains an optional `openBook: PortfolioPosition[]` field (additive,
  `undefined`-safe — existing fixtures/tests that don't set it are unaffected).
- `play-brief-context.ts`'s `loadSwingPlayBriefContext` now fetches `fetchOpenSwingPositions()`
  (already a `@/lib/db` export, already used by `play-brief-resolve.ts` for a different purpose —
  no new DB surface) and maps ledger rows (`direction: "long"|"short"`) to
  `PortfolioPosition[]` (`direction: "LONG"|"SHORT"`) for the overlap checker.
- New `bookContextSection()` in `play-brief-intel.ts` calls `checkPortfolioOverlap()` with the
  play under review as the candidate and reports two flavors, matching `portfolio.ts`'s own
  documented distinction:
  - **Concentration** — an existing same-theme, same-direction position (stacking the same bet).
  - **Internal conflict** — an existing same-theme, OPPOSED-direction position (one leg fights
    the other; not a hedge unless intentional).
- Wired into `buildIntelSections` right after "Why this setup" — early, since it's a decision
  input, not a footnote.
- The section renders `null` (nothing added) when the book is empty/undefined or has no overlap —
  consistent with every other section's "nothing to say → omit" convention; a clean book is not
  noise worth a line.

## Evidence (RED → GREEN)

`git stash` on the three source files, re-ran the new test file:
```
not ok 1-5  bookContextSection is not a function   (5/5 fail)
```
Restored, re-ran: **5/5 pass.** `tsc --noEmit` clean. Full `npm test` run in progress (Node 20,
`/opt/node20/bin`); will confirm 0 regressions before merge.

## Blast radius

- `checkPortfolioOverlap`/`portfolio.ts` unchanged — reused, not modified, so its own existing
  test coverage and the swing entry gate's behavior are untouched.
- No other `play-brief*` consumer reads `openBook`, so this is additive-only for every existing
  test/fixture that predates the field.
- Cross-checked in-flight PRs (`#4081` fix/swing-lane-rank-undefined-guard,
  `#4080` cursor autopilot) — neither touches `play-brief-types.ts`, `play-brief-context.ts`, or
  `play-brief-intel.ts`, so no file-overlap collision risk.

## Fix rationale — what was deliberately left unchanged

- Did **not** build a new theme/correlation resolver — reusing the exact one the swing gate uses
  keeps the brief's answer and the gate's own decision the SAME partition (the reason SEV-9 exists
  at all: two diverging notions of "similar" is worse than one).
- Did **not** turn this into a hard block or a gate signal — per the Largo product contract,
  disagreement/evidence is represented, not enforced by presentation surfaces; the brief informs,
  it does not gate entries.
- Did **not** exclude the play under review from the fetched book by position id — relied on
  `checkPortfolioOverlap`'s own self-skip (same ticker AND same direction), which already treats a
  rolled/duplicate row on the identical bet as "not a second overlap," the correct behavior with
  less code.

## Note for Cursor

This is one of the "trader value" ideas from the research comment posted to PR #4076 (comment id
5556239866) — implementing item #1 (portfolio/theme concentration) per the offer there to split
work and avoid the `play-brief-types.ts`/`play-brief-diff.ts` file-overlap churn from #4076/#4077.
Item #2 (historical archetype/sub-lane win-rate context via `calibration.ts`) remains open — happy
to take it next, or if you're already on it, no need to duplicate.
