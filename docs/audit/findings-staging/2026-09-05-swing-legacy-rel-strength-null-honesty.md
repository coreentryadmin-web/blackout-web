> **kind:** FINDING

# Legacy swing promotion fabricated REL_STRENGTH via `?? 0` — FIXED

| **Status** | FIXED in PR (pending) |
|------------|----------------------|
| **Pri** | P1 |
| **Area** | swing / legacy-confirm-promote |

## Symptom

Every Night Hawk CONFIRMED name promoted onto the Swings tab was scored with REL_STRENGTH
`present: true` at the worst possible value (0/0 relative strength), even though
`swingReadsForLegacy` intentionally sets `returnPct10d` and `spyReturnPct10d` to `null`.

## Root cause

`buildLegacySwingArtifacts` passed `relStrength: { nameReturnPct: reads.returnPct10d ?? 0, ... }`.
`relStrengthSignal` treats `0` as present, so `relativeStrengthScore(0, 0) = 0` landed in the
pillar denominator instead of omitting REL_STRENGTH.

## Fix

Only pass `relStrength` when both 10d returns are grounded; otherwise omit the cluster so
`buildSwingDossier` marks REL_STRENGTH absent.

## Evidence

- `src/lib/swing/legacy-confirm-promote.test.ts` — REL_STRENGTH null + missing list
- Swing V2 deep-dive Q4 (`docs/audit/SWING-V2-DEEPDIVE-QUESTIONS-2026-09-05.md`)

## RTH validation

After deploy: promote path is morning-confirm only — on next weekday open, confirm a legacy-promoted
Swings row shows REL_STRENGTH absent (not dragging dossier score with a fabricated 0).
