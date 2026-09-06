# Swing Ask Largo brief — thesis-health inputs not wired for committed rows

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Area** | Night Hawk Swings / Ask Largo |
| **Severity** | P2 — product correctness (uncalibrated thesis-health band) |

## Symptom

Committed swing positions opened via Ask Largo (`loadOpenTerminalPlay`) showed the generic uncalibrated thesis-health band (~46% Degraded) even when a matching dossier existed. Factors/regime were restored by `attachThesisExplanation`, but `setupState`, `entryStatus`, and `signalKinds` were not — so `computeSwingThesisHealth` fell back to default pillar labels (`unknown` / `n/a` / `no signals`).

## Root cause

1. `attachThesisExplanation` intentionally skips setup/entry lifecycle fields (live rows must not be mis-routed on the main board).
2. The play-brief path never had a brief-only enrichment step for thesis-health inputs.
3. Ledger fallback reads omitted `contract`, so `entryStatus` could not derive.
4. `discoveryPathHintForArchetype` only mapped four archetypes; fresh dossier re-classification (e.g. `PULLBACK_CONTINUATION`) returned empty paths even when the commit-pinned archetype (`BREAKOUT`) would map to `STRUCTURE`.

## Fix

- Added `attachPlayBriefThesisInputs` (brief-only): restores setup/entry/signalKinds from dossier + ledger levels + play contract without touching `getSwingServingLane`.
- Wired in `play-brief-resolve.ts` for open ledger and WATCH lane paths.
- Expanded archetype→Tier-0 path map; commit-pinned `play.archetype` wins for signal kinds.

## Evidence

- `src/lib/swing/play-brief-resolve.test.ts` — committed row asserts `thesisHealthUncalibrated === false`
- `src/lib/swing/serving-lane.test.ts` — unit test for ledger fallback + commit archetype

## Live validation (RTH)

On a committed swing with an open dossier: open Ask Largo → thesis health should show calibrated pillar labels (not the generic 46% band) and regime pillar not `unread`.
