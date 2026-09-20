## GEX matrix has the same weekend-self-warm freshness gap Vector had — FIXED

> **kind:** `FINDING`

| Field | Detail |
|---|---|
| **Status** | FIXED |
| **Area** | `src/lib/bie/market-session-disclosure.ts` (new), `src/lib/swing/play-brief-absence.ts` (`gexMarketSessionNote`), `src/lib/swing/play-brief.ts` (`evidenceFromContext`), `src/lib/bie/vector-state-freshness.ts` (refactor only, no behavior change) |

### How found

PR #5306/#5307 (this same cycle) shipped Vector's `market_session`/`market_session_note`
disclosure for the "compute is fresh but the market is CLOSED" combination. That work — and the
sibling session's own #4076 follow-up comment (5750099882) — explicitly named a SECOND,
independent mechanism producing the identical symptom: the GEX matrix. `gexFreshness`/
`gexMatrixStale` (`play-brief.ts`/`play-brief-absence.ts`) classify `gex.asof`, which traces to
`polygon-options-gex.ts`'s own `calculatedAt = new Date(now).toISOString()` — a pure wall-clock
compute stamp that never calls `describeVectorFreshness` at all. A weekend/holiday self-warm can
compute a genuinely fresh GEX matrix off Friday's closing chain while the market itself has been
shut for hours — same symptom as Vector's gap, different, entirely independent code path. Claimed
via an explicit #4076 offer-to-split comment (this session's own 5750312954) before starting, to
avoid duplicate work with the sibling session that shipped the Vector half.

Live-caught the underlying risk directly this cycle too: pulled a real Sunday (2026-09-20, market
CLOSED) `GET /api/market/swing/play-brief` for LITE right after #5307 merged and confirmed via
`describeVectorFreshness`/`etSessionFacts` reproduction that the exact misleading combination
(fresh compute + CLOSED market) is a real, reachable state on live data, not just a hypothetical.

### Root cause

`gexMatrixStale`/`gexFreshness` answer "how old is this GEX-matrix compute" and nothing about
whether the market session it describes has moved since. Exactly the same gap
`describeVectorFreshness`'s own module doc named for Vector, but in a structurally separate
function with no shared code path — fixing Vector alone left this one untouched.

### Fix

1. **Extracted the shared "is this misleading" logic** out of `describeVectorFreshness`
   (`vector-state-freshness.ts`) into a new, source-agnostic module,
   `src/lib/bie/market-session-disclosure.ts` — `marketSessionDisclosure(freshness, ageSec,
   marketSession)` (the exact ternary that used to live inline in `describeVectorFreshness`) plus
   `formatFreshnessAge` (the `"42s"`/`"3m"`/`"1.2h"` formatter both note strings already used).
   This is a **pure refactor of `vector-state-freshness.ts`** — same inputs produce the same
   outputs; its own 24 tests pass unchanged before and after. Avoids the exact risk PR #5306's own
   description named for this follow-up: a second, independently-drifting copy of the same
   conditional at the GEX call site.
2. **New `gexMarketSessionNote(gex, readMs)`** in `play-brief-absence.ts`, next to the existing
   `gexMatrixAgeMs`/`gexMatrixStale` it shares logic with: computes GEX's own age/freshness the
   same way `gexFreshness` does, reads `market_session` via `etSessionFacts(new Date(readMs))`
   (the same shared, holiday-aware derivation Vector's fix reuses), and delegates the actual
   disclosure decision to `marketSessionDisclosure`. Returns `null` whenever `gexMatrixStale` is
   already true (that verdict's own staleness already covers it) or age is unreadable.
3. **Wired into `evidenceFromContext()`** (`play-brief.ts`), immediately after the just-shipped
   Vector market_session_note block: pushes a `BieEvidence` (`source: "GEX"`) whenever
   `gexMarketSessionNote(...)` is non-null, gated `!gexStale` — the identical pattern the Vector
   block uses, for the identical reason (never disclose a caveat about a GEX read the rest of the
   function has already excluded as untrustworthy).

### Blast radius

- `vector-state-freshness.ts`: refactor only, verified behavior-identical (same 24/24 tests,
  unchanged assertions, before and after).
- `play-brief-absence.ts`: one new exported function, additive; nothing else in this file changed.
- `play-brief.ts`: one new evidence push in `evidenceFromContext`, additive; no existing evidence
  line's gating, ordering, or content changed.
- No other call site of `gexFreshness`/`gexMatrixStale` touched — the fix is scoped to the single
  new evidence line, per the Largo product contract's additive rule (wrap, never flatten).

### Verification

New tests:
- `src/lib/swing/play-brief-absence.test.ts` — 4 direct unit tests for `gexMarketSessionNote`
  (fresh + CLOSED discloses; fresh + real RTH OPEN is null; already-stale GEX suppresses; null/
  unreadable input never throws or fabricates).
- `src/lib/swing/play-brief.test.ts` — 2 integration tests via `composeSwingPlayBrief` (clock
  frozen to a real Sunday with `mock.timers`): the note surfaces as GEX-attributed evidence on a
  closed-market self-warm; it is suppressed when the GEX matrix is already stale.

RED→GREEN proven via `git stash` on the three source files (`vector-state-freshness.ts`,
`play-brief-absence.ts`, `play-brief.ts`) with the new market-session-disclosure.ts module set
aside, test files kept:
- `play-brief.test.ts`: 1 failure without the fix (the new positive integration test), 0 with it
  (96/96).
- `play-brief-absence.test.ts`: 4 failures without the fix (the new direct unit tests, isolated —
  nothing else in the file affected), 0 with it (76/76).

Full `npm test` (Node 20) and `npx tsc --noEmit`: run before opening the PR, results recorded in
the PR description.

Per CLAUDE.md's rescinded Cursor-sign-off carve-out (2026-09-10): merges on green CI + clean
mergeable state, no Cursor review wait required. Collaboration claimed and disclosed on #4076
(comments 5750312954 claiming the split, this finding documents the delivered half) so the sibling
session that shipped Vector's half (#5306/#5307) can independently verify this one the same way I
verified theirs.
