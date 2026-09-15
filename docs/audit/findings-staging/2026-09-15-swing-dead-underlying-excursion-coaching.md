> **kind:** FINDING

## `underlyingExcursionCoaching` was called unconditionally in every swing coaching pass but was structurally guaranteed to always return null — and its one live-computable remainder was fully redundant with already-shipped content — FIXED (dead-code removal)

| **Status** | FIXED (this commit) |
|---|---|

**Root cause:** `underlyingExcursionCoaching(play)` (`src/lib/swing/play-brief-narrative-coaching.ts`)
gated on `play.stockMovePct`/`play.stockPeakPct`/`play.stockTroughPct` — fields written in exactly
one place repo-wide, `src/features/nighthawk/command-deck/use-legacy-quotes.ts`, a client-side React
hook that is Night Hawk **Legacy**-only. `terminalPlayFromHorizon` (the SWING/LEAPS adapter) never
sets any of the three, and `play-brief-resolve.ts` never patches them in either. Called
unconditionally in the swing coaching assembly, so the function's early-return gate (`if (stock ==
null && peak == null && trough == null) return null`) was always true for every swing row —
structurally guaranteed dead, the fourth instance of this exact pattern found this session
(`scorecardCoaching`, `morningConfirmCoaching`, `progressRatchetCoaching`).

**Sharper than the prior three:** unlike those, this function had a second internal computation
(`mfeCaptureOutcome(play.pnlPct, play.peak, null)`, producing an "option round-tripped past
breakeven" / "option gave back X% from peak" aside) that DOES read genuinely live swing fields
(`play.pnlPct`, `play.peak`) — so on paper it looked like a partially-alive function whose dead gate
was merely blocking a real signal, rather than pure dead code. Investigated whether that remainder
deserved a rewired gate instead of outright removal: grepped every call site of `mfeCaptureOutcome`
across `src/lib/swing/` and found the identical call — `mfeCaptureOutcome(play.pnlPct, play.peak,
null)`, same three arguments — already live in `play-brief-intel.ts:906` and
`play-brief-narrative.ts:412`/`:750`, both predating this function. The "live remainder" was
byte-for-byte redundant with content already shipped elsewhere in the same brief, not a unique
signal — settling the question in favor of removal rather than a gate rewrite.

**`TerminalPlay.stockMovePct`/`stockPeakPct`/`stockTroughPct` themselves are genuinely alive** —
confirmed extensive real consumers across Legacy UI (`LegacyPlayTechnicalsRail.tsx`,
`LegacyPlayManageRail.tsx`, `LegacyPlayDetailPanel.tsx`, `legacy-board-columns.tsx`,
`legacy-primary-pnl.ts`, `play-card-display.ts`). Only the swing-side coaching consumer was dead —
the type fields and their Legacy-side writer/readers are untouched by this fix.

**Blast radius:** none on member-facing output — same as the three prior removals, the call always
evaluated to `null` (the dead gate) and `push()` silently drops nulls; even the theoretically-live
`optGive` fragment inside could never have added new information, since its exact computation was
already surfacing elsewhere.

**Fix:** removed the dead function, its call site, its three now-orphaned regression tests (all
exercising the same `mfeCaptureOutcome` relative-retracement math already covered by
`mfe-capture.test.ts`, `play-brief-intel.test.ts`, and `play-brief-narrative.test.ts` — no coverage
lost), and the now-unused import.

**Fix rationale:** deletion over a gate rewrite, since a rewrite would have shipped a bullet
duplicating content the member already sees elsewhere in the same brief — that's scope creep
disguised as a fix, not a genuine gap like the earlier `play.trough` (PR #5004) finding where the
data truly reached nowhere else.

**Test:** the three existing tests for this function were removed along with it (their regression
coverage is preserved via the sibling call sites' own tests). Full `src/lib/swing/*.test.ts` suite
(1141 tests, down 3 from removing the dead tests) green, `tsc --noEmit` and `eslint` clean on both
changed files.
