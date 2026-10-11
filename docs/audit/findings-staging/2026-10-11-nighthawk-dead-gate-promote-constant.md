> **kind:** FINDING

## Night Hawk Legacy — dead `GATE_PROMOTE_MIN_SCORE` static alias — FIXED

**Symptom:** `publish-gates.ts` exported `GATE_PROMOTE_MIN_SCORE`, a static alias to
`MIN_PUBLISH_SCORE`, with a doc comment claiming the live gate-promote rescue path is
"Locked to MIN_PUBLISH_SCORE so rescue cannot re-admit the diversity-hedge noise class
(live AI@26 / SNDQ@20)." It had zero importers anywhere in the repo — only its own
definition and a historical `docs/audit/FINDINGS.md` mention referenced the name.

**Root cause:** The real gate-promote score floor is **dynamic**, not static. The one
real call site, `promoteTopBlocked` (same file), reads `gatePromoteMinScore()`
(`edition-quality.ts`), which returns `effectiveMinPublishScore()` — an env-overridable
(`NH_MIN_PUBLISH_SCORE`) floor that also shifts to the measured overnight PRIME band
(`NH_SCORE_PRIME_MIN`) under `legacyGlobalStrongest()`. The static constant was left
behind, presumably from before the floor became dynamic, and nothing was ever updated to
read it — not a correctness regression (the real mechanism is already correctly dynamic
and well-tested), just a dead, stale-commented export.

**Evidence:** `grep -rn "GATE_PROMOTE_MIN_SCORE"` (repo-wide) before the fix: only
`publish-gates.ts:422` (its own definition) and one historical `FINDINGS.md` line. The
real floor's call site (`publish-gates.ts:437`, `const minScore = gatePromoteMinScore();`)
and its dynamic definition (`edition-quality.ts:88-90`) are both confirmed live and tested
(`edition-quality.test.ts:93`, `assert.equal(gatePromoteMinScore(), 40)`).

**Fix:** Removed `GATE_PROMOTE_MIN_SCORE` and its now-orphaned `MIN_PUBLISH_SCORE` import
(the only other use of that import in this file). No other code change — the real,
dynamic floor the rescue path actually uses is untouched.

**Fix rationale:** Pure deletion — a dead static alias beside its own correctly-dynamic
live replacement, with no caller to redirect.

**Blast radius:** `src/features/nighthawk/lib/publish-gates.ts` only. No test referenced
the removed export (`publish-gates.test.ts` already tests `promoteTopBlocked`'s real
score-floor behavior directly — see "promoteTopBlocked rejects score-below-floor filler
(AI@26 / SNDQ@20 class)").

**Regression guard:** None needed beyond the existing `promoteTopBlocked`
score-floor test, which already exercises the real `gatePromoteMinScore()` path this
dead constant never touched.
