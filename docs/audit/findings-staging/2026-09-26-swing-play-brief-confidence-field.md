## Swing play-brief never populated Largo C6 `confidence` — a real, calibrated signal existed and went unsurfaced

> **kind:** `FINDING`

| | |
|---|---|
| **Area** | Night Hawk Swings — Ask Largo play-brief (`GET /api/market/swing/play-brief`, `get_swing_play_brief`) |
| **Severity** | P3 (product enhancement — no correctness defect, no trading-path change) |
| **Status** | FIXED |
| **Files** | `src/lib/swing/play-brief-confidence.ts` (new), `src/lib/swing/play-brief.ts`, `src/lib/swing/play-brief-confidence.test.ts` (new), `src/lib/swing/play-brief.test.ts` |

**Root cause.** `BieAnswerEnvelope.confidence` (`answer-envelope.ts`) is a real, already-designed,
deliberately-optional field — and `buildRichEnvelope` (`rich-narrative.ts`) already forwards it
correctly. Swing's play-brief composer (`composeSwingPlayBrief`, `play-brief.ts`) simply never
passed one in, so every swing play-brief omitted `confidence` unconditionally (a regression test,
`play-brief.test.ts`, explicitly asserted this omission as correct — written when it genuinely was,
since no calibrated signal existed to report).

**Why this wasn't caught earlier**: an enhancement idea raised on PR #4076 (comment 5849016880,
2026-09-26) proposed mapping `computeSwingThesisHealth`'s % directly into `confidence` — but tracing
`BieConfidence`'s two other real producers in this codebase (`verdict-core.ts`'s
`assembleVerdictEnvelope`, `cortex-read.ts`'s `buildPinnedCortexEnvelope`) showed the established,
load-bearing semantic is **evidence coverage/record solidity** ("how much do we actually know to
answer this"), never a directional health or win-probability score. Thesis-health% answers a
different question ("is the original thesis still intact") — mapping it directly would have been a
NEW C6 violation (conflating two distinct concepts under one label), not a fix for the omission.

**The fix.** `swingPlayBriefConfidence()` (new, pure, `play-brief-confidence.ts`) derives confidence
from three ALREADY-EXISTING, ALREADY-THRESHOLDED inputs — zero new numeric thresholds invented:
1. `bucket === "closed"` → `high` (a closed play's outcome is the ledger record, mirrors
   cortex-read.ts's exact "pinned record" reasoning — checked first, dominates over #2).
2. `play.entryPresentPillars != null` → `low` (reuses dossier.ts's existing
   `MIN_PRESENT_PILLARS`/`CRITICAL_PILLAR` degraded gate, already rendered elsewhere in the same
   brief as "Evidence at entry: thin read — N/7 pillars grounded").
3. `unavailableSources.length === 0 ? "high" : "moderate"` (existence check, not a tuned count —
   mirrors verdict-core.ts's own `substantive >= 1` presence floor). `unavailableSources` is the
   SAME array already computed once and shared with the envelope's own `unavailableSources` chips,
   so confidence and the chips members already see can never drift apart.

Wired into `composeSwingPlayBrief` via the existing `confidence?: BieConfidence` param
`buildRichEnvelope` already accepted (no new plumbing needed there), through `safeCompose` for the
same defensive consistency every other envelope field in this composer gets.

**Blast radius.** Read-only addition to one output field. Never reads `direction`/`score`/exit-policy
fields; never mutates `play`; does not touch trade selection, entries, stops, targets, or
`liveStatus`/`manageAction` — proven by dedicated tests, not just asserted (see below). The Largo
tool path (`swingPlayBriefForLargo` → `run-tool.ts`'s `get_swing_play_brief` case) gets it for free
since it calls the same `composeSwingPlayBrief`.

**Evidence.**
- `npx tsx --experimental-test-module-mocks --test src/lib/swing/play-brief-confidence.test.ts` — 8/8
  pass (branch coverage: closed/thin-entry/full-coverage/some-unavailable/WATCH-bucket, plus purity —
  never mutates `play`, never reads direction/score).
- `npx tsx --experimental-test-module-mocks --test src/lib/swing/play-brief.test.ts` — 110/110 pass,
  including 4 new integration tests: two round-trip checks (`brief.envelope.confidence` always
  byte-equal to an independent recomputation from the same inputs — the literal "confidence shown to
  members matches the underlying calculated confidence" proof), one CLOSED-always-high check, and
  one explicit "adding confidence changes nothing else" check (bias/invalidation/structureLadder
  identical across a thin-vs-full-entry pair that differ ONLY in confidence-relevant inputs; `ctx.play`
  itself byte-identical before/after compose in both cases). Also updated one now-superseded test
  (`omits envelope.confidence` → `populates envelope.confidence with a real evidence-coverage read`)
  whose premise (no calibrated signal exists) this fix intentionally changes.
- `npx tsx --experimental-test-module-mocks --test src/lib/swing/*.test.ts` — 1543/1543 pass (whole
  swing directory, no other regression).
- `npx tsx --experimental-test-module-mocks --test src/lib/largo/swing-play-brief-read.test.ts` —
  4/4 pass (the Largo tool wrapper, unaffected).
- `npx tsc --noEmit` — clean.
- `npx next lint` on all four changed/added files — clean.

**Fix rationale — what was deliberately left unchanged.** Did NOT touch
`computeSwingThesisHealth`/`thesis-health.ts` at all (that function's % is correct for its own
purpose — thesis-intactness — and stays exactly as-is). Did NOT introduce a WATCH-lane live
`dataQuality.presentPillars` read (the dossier isn't currently propagated onto
`SwingPlayBriefContext` for the composer to reach) — WATCH plays instead fall through to the
same live-source-coverage rule OPEN plays use when their entry hasn't committed yet
(`entryPresentPillars` is always `null` pre-commit), which is correct, just less granular; adding
that plumbing is separate, larger scope. Did not deduplicate the pre-existing, unrelated
`statusBucket()` duplication between `play-brief.ts` and `play-brief-intel.ts` — out of scope for
this change.
