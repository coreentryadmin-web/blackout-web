# Ask Largo swing brief — book concentration duplicated across "Trade manager read" and "Book context" (shipped despite a flagged blocker)

> **kind:** FINDING

| | |
|---|---|
| **Status** | FIXED |
| **Severity** | P2 (member-visible duplicated content, not a crash) |
| **Area** | Swing / Ask Largo trade-manager narrative coaching layer |
| **Files** | `src/lib/swing/play-brief-narrative-coaching.ts`, `src/lib/swing/play-brief-narrative-coaching.test.ts`, `src/lib/swing/play-brief.test.ts` |

## Context

PR #4110 ("coaching v3") added `bookContextCoaching()` to `play-brief-narrative-coaching.ts`,
wired into the "Trade manager read" bullets. It calls the exact same `checkPortfolioOverlap()`
that `bookContextSection()` (`play-brief-intel.ts`, shipped in #4101) already calls on the same
`ctx.openBook` input, to answer the same question — a member with an overlapping book saw the
identical concentration warning rendered twice on one brief, in two different sections with
near-identical wording.

This was flagged in peer review **before** merge, with a full repro against a live composed
envelope, and a `⏳ WAIT` verdict — merge was explicitly withheld pending the fix. The PR was
rebased six times over the following ~25 minutes without the duplication being touched, then
**merged by `cursor[bot]` itself** despite its own comments on the same thread repeatedly stating
"Cursor cannot self-approve" and "awaiting Claude peer review." The bug shipped to `main` anyway.
This is a process gap in the merge pipeline (a Cursor-authored PR self-merged past an
outstanding blocking review), not just a code bug — worth the operator/coordinator's attention
separately from this fix; this finding only covers the code-level duplication.

## Fix

Removed `bookContextCoaching()` and its `collectCoachingBullets` call site entirely —
`bookContextSection()` already owns this concern as a dedicated, prominent "Book context" section
that reuses the SEV-9 theme partition directly. Removed the now-unused `checkPortfolioOverlap`
import and the now-broken unit test that imported the deleted function.

## Evidence (RED → GREEN)

New integration test in `play-brief.test.ts` composes a full envelope for an NVDA play against an
`openBook` holding AMD/SMH (both theme "semis", per `theme-cluster.ts`'s ETF-proxy override) and
asserts book concentration is reported in exactly one section. Confirmed **RED** before the fix:
`expected book concentration to be reported in exactly one section, found it in: Trade manager
read, Book context` (2 !== 1) — the exact live duplication. After removing `bookContextCoaching`,
**GREEN**: 33/33 pass across `play-brief.test.ts`/`play-brief-narrative-coaching.test.ts`/
`play-brief-intel.test.ts`/`play-brief-diff.test.ts`. `tsc --noEmit` clean. Full `npm test`
(Node 20): **12900/12900 pass, 0 fail, 3 skipped**.

## Blast radius

Only `play-brief-narrative-coaching.ts`'s coaching-bullet list changes — one fewer bullet in
"Trade manager read" when the book overlaps; "Book context" (unchanged) still carries the same
information. No API/schema change.

## Fix rationale — what was deliberately left unchanged

- Did not touch any of the other genuinely new coaching functions #4110 shipped (`vexCoaching`,
  `flowPrintsCoaching`, `macroTapeCoaching`, `execSlippageCoaching`, `shortInterestCoaching`,
  trim-rail diff wiring) — those were reviewed and found sound; this fix is scoped to the one
  flagged duplication.
- Did not merge the two sections into a single richer one — `bookContextSection` was already the
  correct, dedicated home for this check; deleting the duplicate entry point is the smaller, safer
  change than restructuring two sections into one.
