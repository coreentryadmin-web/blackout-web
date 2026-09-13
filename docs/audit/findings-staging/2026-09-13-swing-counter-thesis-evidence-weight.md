> **kind:** FINDING

## Ask Largo's counter-thesis line rendered a single signal and a triple-corroborated one with identical prose weight — feat/swing-counter-thesis-evidence-weight — 2026-09-13

- **What was broken (not a correctness bug — every reason cited was already real and honestly
  gated; a presentation gap, part of the standing Ask Largo × Night Hawk Swings ownership
  mandate's open item "steelmanning the counter-thesis"):** `counterThesisLine()`
  (`src/lib/swing/play-brief-narrative.ts`) gathers up to 3 independent reasons a swing thesis
  could be wrong (HELIX flow, Night Hawk/0DTE desk disagreement, Vector desk bias, structural
  walls, EMA stack, dealer posture, a genuinely faded thesis pillar) and always rendered them the
  same way: `**Counter-thesis (bear case)** — <reason(s)>. If this wins, honor invalidation —
  don't hope.` A member reading this had no way to tell whether the counter-thesis was one
  isolated signal or three independent desks/reads agreeing — both cases produced prose of
  identical weight and confidence.
- **Live evidence (2026-09-13, `GET /api/market/swing/play-brief` across the live board):**
  AAPL's counter-thesis carried 3 corroborating reasons (call wall overhead, bear EMA stack,
  dealer long-gamma posture); NRG, NN, and META each carried exactly 1. All four rendered with the
  identical `**Counter-thesis (bear case)** — <reason(s)>.` shape — a member could not distinguish
  the well-corroborated AAPL case from the single-signal NN case without manually counting the
  `·`-separated clauses themselves.
- **What changed:** the line now names the real evidentiary weight before the reasons: `a single,
  uncorroborated signal —` when exactly 1 reason qualifies, or `corroborated across N independent
  reads —` when 2 or more do. `N` is `reasons.length` — the exact count already computed by the
  existing, already-gated reason-gathering logic above it — so this labels real evidence honestly
  rather than fabricating a new score; consistent with the Largo product contract's confidence
  discipline (state real weight, never invent it, never flatten it away either).
- **Blast radius:** single function, single call site (`tradeManagerNarrativeSection`, same file).
  No other consumer reads `counterThesisLine`'s exact string (repo-wide grep confirmed) — only
  substring/regex assertions in the existing test suite, none of which depended on the surrounding
  template, so no other test needed changes beyond the two new ones added for this behavior.
- **Fix rationale:** did not touch which reasons qualify, how many are shown (still capped at 3),
  the staleness/uncalibrated-pillar anti-fabrication guards, or the Vector-conflict dedup with
  `crossDeskCoaching` — all of that logic is untouched and already correct. This fix is scoped
  purely to how the already-gathered evidence is presented.
- **Evidence:** two new tests in `play-brief-narrative.test.ts` — a single-reason case asserts `"a
  single, uncorroborated signal"` and NOT `"corroborated across"`; a 3-reason case (HELIX put-led +
  Night Hawk bearish + bear EMA stack, live-shaped fixture) asserts `"corroborated across 3
  independent reads"` and NOT the single-signal phrase. RED→GREEN confirmed via `git stash` on
  `play-brief-narrative.ts` (both new tests failed pre-fix, passed post-fix). Full suite
  14106/14106 pass (3 pre-existing unrelated skips), `tsc --noEmit` clean.
- **Not attempted here:** the other two genuinely open narrative items from the same standing
  mandate — narrating the live "what changed" diff in trade-manager voice instead of raw numeric
  deltas, and narrating cross-desk disagreement as connected prose instead of a list — both remain
  open, separate follow-ups.

| **Status** | Fixed — PR opened, CI pending |
