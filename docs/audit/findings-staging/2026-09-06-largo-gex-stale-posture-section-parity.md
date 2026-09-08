# Largo swing brief — stale GEX posture still rendered in gexPostureSection + evidence — FIXED

> **kind:** `FINDING`

| Field | Value |
|-------|-------|
| **ID** | BO-P2-largo-gex-stale-posture-section-parity |
| **Pri** | P2 |
| **Area** | Night Hawk Swings / Ask Largo |
| **Status** | FIXED |

## Symptom

After #4372/#4375 aligned king/magnet/chartLevels/watchFor to **suppress** stale GEX-only values, `gexPostureSection` and `evidenceFromContext` still rendered `gamma_posture` mechanic text whenever the matrix was stale — only prefixing "Last snapshot". Same Largo C2 dishonesty class, weaker UX than the stricter pattern now on `main`.

`dealerPostureLine` was already fixed via `resolveGammaPosture` in #4375; tests still expected the old prefix-only behavior for stale GEX-only reads.

## Fix

- `gexPostureSection`: skip `gamma_posture` line when `gexMatrixStale()`; stale warning + net GEX/wall fields may still render.
- `evidenceFromContext` (`play-brief.ts`): gate dealer posture evidence bullet on `!gexMatrixStale()`.
- Tests updated for suppress-not-prefix parity.

## Evidence

`npx tsx --test` on `play-brief-intel.test.ts`, `play-brief-narrative.test.ts`, `play-brief.test.ts` — stale-parity cases pass.

| **Status** | FIXED — PR opened, merge pending CI/peer-review |
