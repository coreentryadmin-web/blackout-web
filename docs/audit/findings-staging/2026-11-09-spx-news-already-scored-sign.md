# `newsAlreadyScored()` suppressed a real opposing-news conflict whenever ANY News-labeled factor existed, regardless of which side it agreed with — same bug class already fixed for GEX/VIX on 2026-11-01, missed for news

> **kind:** `FINDING`

### Summary
`computeWeightedConflicts` (`src/features/spx/lib/spx-play-conflicts.ts`, feeding
`SpxConfluence.weighted_conflicts` via both `computeSpxConfluence` and
`reclassifyConfluenceScore`, which in turn feeds `evaluatePlayGates`'s "Tape's mixed" hard block
and `entry_mode` sizing) ran two independent news-sentiment classifiers over the same
`desk.news_headlines`: `scoreNewsRisk` (`spx-signals.ts`, its own `NEWS_BEAR_WORDS`/
`NEWS_BULL_WORDS` word list over the first 10 headlines) builds the scored `"News risk"` factor,
while `newsSentiment`/`newsOpposed` (this file, a genuinely different `BEAR_NEWS`/`BULL_NEWS` word
list over only the first 5 headlines) decides whether news opposes the play direction. The guard
`newsAlreadyScored(factors)` only checked whether a News-labeled factor existed at all — never its
sign — so an unrelated, sign-AGREEING `"News risk"` factor (e.g. two stimulus-deal headlines
scoring +3 bullish under `scoreNewsRisk`'s word list) silently swallowed a real, independently-
detected bearish-news conflict from `newsOpposed()`.

### Root cause
`newsAlreadyScored` (line ~138) read:
```ts
function newsAlreadyScored(factors: SpxSignalFactor[]): boolean {
  return factors.some((f) => f.label === "News risk" || f.label.startsWith("News"));
}
```
This is the exact bug class this same file's own comments (lines 142-155, 186-205) describe as
fixed for `vixAlreadyScored`/`gexAlreadyScored` on 2026-11-01 — both of those now require
`factorOpposes(direction, f)`, not mere existence — but `newsAlreadyScored`, structurally
identical and predating both, was never updated in that pass.

### Evidence
Reproduced end-to-end against the real, unmodified `computeWeightedConflicts`:
- CONTROL (5 headlines bearish per `newsSentiment`'s `BEAR_NEWS` list only — recession/hawkish/
  lawsuit/probe/plunge, none of which appear in `scoreNewsRisk`'s `NEWS_BEAR_WORDS`):
  `weighted_conflicts: 2` (correct — `newsOpposed` fires, no News factor to suppress it).
- TREATMENT (same 5 headlines + factors carrying an agreeing `"News risk"` weight +3, exactly what
  `scoreNewsRisk` would produce from unrelated stimulus-deal headlines): `weighted_conflicts: 0` —
  the same real bearish-news conflict silently vanished, purely because an unrelated agreeing
  factor happened to exist.
- RED: new test fails pre-fix (`actual: 0`, expected `2`) — 14/15 pass. GREEN: 15/15 post-fix.
- Full `src/features/spx/lib/*.test.ts`: 953/953 pass. `npx tsc --noEmit` clean.

### Blast radius
`computeWeightedConflicts` is called from both `computeSpxConfluence` (spx-signals.ts) and
`reclassifyConfluenceScore` (spx-signals.ts); `weighted_conflicts` feeds `spx-play-gates.ts`'s
mixed-tape hard block and `entry_mode` sizing (`fullConflictMax`/`starterConflictMax`). Net effect
pre-fix: a setup with real conflicting bearish news gets an artificially LOWER
`weighted_conflicts` (more likely to pass the "Tape's mixed" gate, and to qualify for a larger
`entry_mode`) specifically because MORE unrelated bullish news headlines also appeared in the
feed — backwards from the gate's intent. `spx-play-confirmations.ts`'s separate `"News catalyst"`
factor is unaffected — it's pushed into its own confirmation-checklist array, never into the
`factors` array passed to `computeWeightedConflicts`.

### Fix
Gave `newsAlreadyScored` the same `direction` parameter and `factorOpposes` check already applied
to `gexAlreadyScored`/`vixAlreadyScored` in this same file. Added a regression test mirroring the
existing VIX "agreeing factor present, real opposition still fires" test, plus a no-regression
test confirming the pre-existing genuinely-opposing-factor case is unaffected.

### Evidence detail
- RED: `npx tsx --experimental-test-module-mocks --test src/features/spx/lib/spx-play-conflicts.test.ts` — 14/15 pass pre-fix.
- GREEN: 15/15 pass post-fix.
- Full `src/features/spx/lib/*.test.ts`: 953/953 pass.
- `npx tsc --noEmit` clean.

| **Status** | FIXED — this PR. |
