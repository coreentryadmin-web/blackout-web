> **kind:** FINDING

## Largo: unanimous or single-system "neutral" reads were reported as a fabricated cross-product "conflicted" verdict — FIXED

Seventh product in the "check product by product" audit sweep (SPX Slayer #3192, Helix #3193, Vector #3194, Meridian #3195, Night Hawk #3196, Thermal #3197). Confirmed by hand against source before any fix, not taken on a subagent's word.

| Field | Detail |
|---|---|
| **Symptom** | `extractConsensusFromTools`'s verdict logic (`src/lib/largo/consensus-read-extract.ts`) computed `verdict = "conflicted"`, `direction = null` whenever `Math.abs(bullishCount - bearishCount) <= 1` — including the case `bullishCount = 0, bearishCount = 0` (every consulted system reads neutral), which trivially satisfies `abs(0-0) = 0 <= 1`. |
| **Root cause** | The tie-break branch was meant to catch a genuine near-even bull/bear fight but never checked that either count was actually non-zero. A unanimous (or all-but-one) neutral read is agreement, not disagreement, but the guard couldn't tell the two apart. |
| **Why this matters** | This module's own header states its purpose: "Surfaces disagreements without reconciling them... A system that averages them into 'neutral' has destroyed the signal." This bug is the mirror-image defect — it INVENTS disagreement where there is none, handing the model a fabricated "conflicted" market read instead of the true unanimous "neutral." That's arguably worse than an obviously-wrong number, since "conflicted" is a believable state for a real market and doesn't announce itself as broken. `visual-component-builder.ts`, `follow-up-question-generator.ts`, `adaptive-response-orchestrator.ts`, and `desk-read-decision.ts` all consume this module's output and would render/reason from a false "systems disagree" narrative on a session where every product actually agrees there's no signal. |
| **Fix** | Added a guard requiring `bullishCount + bearishCount > 0` before entering the "conflicted" branch — a near-even split with no actual bullish or bearish votes now falls through to the existing `verdict = "neutral"` branch instead. |
| **Blast radius** | `consensus-read-extract.ts` (`extractConsensusFromTools`) and its four consumers listed above. |
| **Why not caught earlier** | No test file existed for this module at all (`consensus-read-extract.test.ts` was absent), unlike most other `core/*` Largo modules. |
| **Regression guard** | New `consensus-read-extract.test.ts`, 3 tests: unanimous-neutral must read `neutral` (fails against pre-fix code, which returned `conflicted`); a single neutral system must read `neutral`; a genuine near-even bull/bear split (one real bullish vote, one real bearish vote) must still read `conflicted` — proving the fix narrows the false-positive case without suppressing a true conflict. |
| **Gates** | `npx tsc --noEmit` clean. `node --import tsx --test` on the new test file: 3/3 pass (Node 20). |
| **Status** | FIXED — PR pending. |
