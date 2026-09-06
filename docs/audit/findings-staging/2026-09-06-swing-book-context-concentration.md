# Ask Largo swing brief — no book/portfolio-concentration awareness

> **kind:** FINDING

| | |
|---|---|
| **Status** | FIXED |
| **Severity** | P2 (product enhancement — genuine gap, not a defect) |
| **Area** | Swing / Ask Largo play brief |
| **Files** | `src/lib/swing/play-brief-types.ts`, `src/lib/swing/play-brief-context.ts`, `src/lib/swing/play-brief-intel.ts`, `src/lib/swing/play-brief-intel.test.ts` (new) |

## Context

Per the operator's standing directive to deeply improve Ask Largo's swing play brief from a real
trader's perspective (collaborating with Cursor on the `play-brief*` family — see PR #4076,
#4077, #4081/#4093, #4084), this sweep asked: what does a trader actually need to know about a
single play that the brief currently omits?

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
`sameThesis("QQQ","NVDA") === true`) with zero mention of it.

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
  input, not a footnote. Coexists cleanly with Cursor's `tradeManagerNarrativeSection` (#4084,
  already merged) — no overlap in fields read or sections emitted.
- The section renders `null` when the book is empty/undefined or has no overlap.

## Evidence (RED → GREEN)

`git stash` on the four source files, re-ran `play-brief.test.ts` + `play-brief-intel.test.ts`:
5/11 pass without the change (the failures are exactly the new/dependent tests). Restored:
11/11 pass. `tsc --noEmit` clean. Full `npm test` in progress at write time.

## Blast radius

- `checkPortfolioOverlap`/`portfolio.ts` unchanged — reused, not modified.
- No other `play-brief*` consumer reads `openBook`, so this is additive-only.
- Rebased fresh against `main@b78270d99` (post #4084/#4093) — no file-overlap with Cursor's
  narrative work (`play-brief-narrative.ts` is a separate file; `buildIntelSections` insertion
  point is a different line than where `tradeManagerNarrativeSection` was inserted).

## Note for Cursor

This PR was previously opened as #4087, closed 2026-09-06 because it stacked a now-superseded
dealer/dark-pool narrative section on top of this one (your #4084 shipped an equivalent, richer
version — `tradeManagerNarrativeSection`/`play-brief-narrative.ts`). This is a clean re-fork
containing ONLY the book-context/concentration piece, rebased on current `main`, no narrative
duplication. One observation worth a look when you have capacity: `gexPostureSection` and
`wallDynamicsSection` in `play-brief-intel.ts` are still both present alongside your new
`tradeManagerNarrativeSection` — worth checking whether they're now fully redundant with it (the
operator's original complaint was exactly "three lists of the same numbers"; if your narrative
already covers gamma posture/wall dynamics, those two could likely be retired).
