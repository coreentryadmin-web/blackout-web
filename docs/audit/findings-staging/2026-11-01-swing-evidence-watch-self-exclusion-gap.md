> **kind:** FINDING

## Swing `evidenceFromContext` book-overlap feeder silently self-excludes a WATCH candidate's own concentration row — FIXED

| | |
|---|---|
| **Status** | Fixed |
| **Severity** | P2 |
| **Surface** | Ask Largo swing play-brief (`envelope.evidence[]`, `GET /api/market/swing/play-brief`) |
| **Found by** | Ask Largo standing mandate, cycle-66 follow-up fork — audited `bookContextSection` against the full live committed book, found this by reading `evidenceFromContext`'s independent re-implementation of the same `checkPortfolioOverlap` call |

### Root cause

`evidenceFromContext` (`src/lib/swing/play-brief.ts`, the sole feeder of `envelope.evidence[]`)
and `bookContextSection` (`src/lib/swing/play-brief-intel.ts`, the section that renders the
member-visible "Book context" narrative) each independently call `checkPortfolioOverlap` on the
same `openBook` to detect theme/direction concentration. `bookContextSection` was fixed on
2026-09-21 to pass `excludeSelfMatch: false` whenever the reviewed play has no real ledger
`positionId` AND is still a pending entry decision (`status === "WATCH"`) — a WATCH play's `id`
never carries a `positionId` suffix (`banger-lane-merge.ts`'s own stamping convention), so a
matching book row in that case can only be a genuine distinct position, never "the candidate
re-reading itself."

`evidenceFromContext`'s own call (added 2026-09-15, Largo C7) never ported that branch. It still
passes `undefined` whenever `positionId` is null, which defaults `checkPortfolioOverlap` to
`excludeSelfMatch: true`. For a WATCH candidate on a ticker the trader already holds in the SAME
direction, that default treats the one existing book row as "self" and drops it entirely — so
when that is the ONLY overlapping row, `overlap.hasOverlap` reads `false` here while
`bookContextSection` (seeing `excludeSelfMatch: false`) correctly renders a "Concentration — same
underlying" sentence in the section body for the exact same fact.

This is precisely the divergence the Largo C7 doctrine comment directly above
`evidenceFromContext`'s overlap block claims is structurally impossible: *"Same gating as the
sections themselves... so this can never disagree with what the member reads in the section
body."* It can, for this one shape (WATCH + no positionId + exactly one same-ticker/same-direction
book row) — the narrative body asserts a concrete concentration claim with zero backing evidence
entry, a Largo C7 violation.

This is a sibling gap to, but a distinct bug from, two already-fixed issues in the same area:
- `#6421` fixed `evidenceFromContext`'s SIBLING-COUNT feeder (`siblingPositionsNote`'s "Other
  concurrent position(s)" claim) missing a `positionId` self-test — a different feeder, a few
  lines above this one in the same file.
- The 2026-10-21 same-ticker/other-ticker SPLIT fix (display framing, both same-direction and
  opposed-direction buckets) is present and correct in current source — that fix sharpens HOW an
  already-detected overlap is worded; this bug is about whether the overlap is DETECTED at all for
  a WATCH candidate in the first place.

### Fix

Mirror `bookContextSection`'s exact WATCH-candidate branch in `evidenceFromContext`'s
`checkPortfolioOverlap` call: pass `excludeSelfMatch: false` whenever `positionId` is null AND
`ctx.play.status === "WATCH"`.

### Blast radius

Single call site (`evidenceFromContext`'s book-overlap block, `play-brief.ts`). No other function
independently re-derives this evidence fact.

### Tests

`src/lib/swing/play-brief.test.ts` — new test: `composeSwingPlayBrief: a WATCH candidate already
held in the book carries a matching Book overlap evidence entry, not a silent self-exclusion
(Largo C7)`. Fixture: a WATCH play on AAPL LONG with one open-book row already holding AAPL LONG
(a real `positionId`, no `positionId` suffix on the candidate's own `play.id`). Asserts both that
the section body renders the "same underlying" concentration sentence (sanity — already worked)
AND that `envelope.evidence[]` carries a matching "Book overlap:" entry (the actual bug).

RED→GREEN verified: the test fails with `AssertionError` ("the section body's concentration claim
must carry a matching evidence entry... must not be silently self-excluded for a WATCH candidate")
before the fix, passes after it. Full `src/lib/swing/play-brief.test.ts` (195 tests) and
`npx tsc --noEmit` both clean after the fix.
