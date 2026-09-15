> **kind:** FINDING

## Swing play-brief evidence array never backed portfolio-overlap/sibling-position claims (Largo C7) — FIXED

**Status:** FIXED — `fix/swing-evidence-portfolio-overlap`

### Root cause

`evidenceFromContext` (`src/lib/swing/play-brief.ts`) is the sole feeder of `envelope.evidence`
(`buildRichEnvelope({..., evidence: evidenceFromContext(ctx, readMs)})`). Every other data-sourced
narrative claim in the swing play brief (scan freshness, option-mark freshness, dealer/GEX
posture, HELIX flow, earnings date, short interest) gets a matching `evidence[]` entry — but two
sections that assert concrete, checkable member-book facts had none:

- `bookContextSection` (`play-brief-intel.ts:150`) — "Concentration — already holding N
  same-direction positions in theme X: TICKER DIRECTION, ..." — reads `ctx.openBook` via
  `checkPortfolioOverlap`.
- `siblingPositionsNote` (`play-brief.ts:172`) — "TICKER carries N concurrent live position(s) ...
  entered DATE, entry $X, P&L Y%" — reads `ctx.laneRows`.

`evidenceFromContext` already has both `ctx.openBook` and `ctx.laneRows` in scope but never
touched either — an inconsistency with the function's own established pattern (every other
in-scope data source gets an entry), not a documented design choice.

### Evidence

- Live production sampling (CRWD:39 OPEN, AAPL:38/AAPL:37 two concurrent LONGs, TSM WATCH)
  confirmed the pattern on real briefs: `envelope.evidence` carried exactly 5 possible entry
  kinds (scan, mark, dealer posture, HELIX flow, earnings, short interest) while the narrative
  body text asserted the two book-overlap facts above with zero backing entry, on every brief
  checked.
- Repo-wide read of `evidenceFromContext` confirmed both `ctx.openBook`/`ctx.laneRows` were
  already parameters in scope, just never read there.

### Blast radius

Single function (`evidenceFromContext`), the sole `envelope.evidence` producer for this brief. No
other product surface reads this function's output.

### Fix

Added two branches to `evidenceFromContext`:
1. A "Book overlap: ..." entry, computed via the same `checkPortfolioOverlap` call
   `bookContextSection` already makes (same `excludePositionId` exclusion, same CLOSED-play
   gating via `statusBucket(ctx.play) !== "closed"`) — so the evidence entry can never disagree
   with, or outlive, the section it backs.
2. A "TICKER carries N concurrent live position(s) ..." entry, computed via the identical sibling
   filter `siblingPositionsNote` already uses (same ticker, `liveStatus`, entry-premium delta
   > 0.005 threshold), gated the same way (`bucket === "open"`, `play.entry` finite).

Both are `kind: "fact"` with `provenance: { source: "Swing ledger", asOf: ctx.asOf, freshness:
"recent" }`, matching the HELIX-flow entry's provenance shape (a live, request-time-computed read,
not a separately-timestamped upstream fetch).

### Fix rationale

Reused the sections' own gating and overlap-computation logic verbatim rather than writing new
detection logic, so the evidence entry structurally cannot drift from what the section body says.
Left every other evidence branch and both narrative sections completely untouched — this is
additive only.

### Tests

- `src/lib/swing/play-brief.test.ts`: extended the existing sibling-disclosure test to also assert
  a matching evidence entry; added a no-siblings-no-evidence counterpart; added a new
  Book-overlap-evidence test (NVDA/AMD/SMH "semis" theme, mirroring `bookContextSection`'s own
  test fixtures) and a CLOSED-play gating test.
- RED→GREEN proof: `git stash` on `play-brief.ts` reproduced 2 failing tests against the pre-fix
  tree; restoring the fix returned the suite to green (66/66).
- `npx tsc --noEmit`: clean.
