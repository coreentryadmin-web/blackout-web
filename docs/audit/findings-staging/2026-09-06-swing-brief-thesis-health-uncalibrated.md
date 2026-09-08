# Swing play brief — uncalibrated thesis health % presented as calibrated

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Priority** | P1 |
| **Area** | Night Hawk Swings / Ask Largo |
| **Contract** | Largo C3 (absence), C6 (confidence) |

## Symptom

Every OPEN/HOLD/TRIM swing position showed thesis health ~46–51% with rung labels like "Degraded", driving hold-plan and trade-manager coaching — even on rows with +129% peak P&L. The aggregate % read as a calibrated score comparable across plays.

## Root cause

`computeSwingThesisHealth()` is real math, but `livePlayFromSwingPosition` never supplies `setupState`, `entryStatus`, or `signalKinds` for committed rows. Three of five weighted pillars always hit generic defaults (`unknown` / `n/a` / `no signals`), collapsing the composite to a constant band. The brief rendered that as authoritative and never surfaced the missing inputs in `unavailableSources`.

## Fix

- `thesisHealthUncalibrated()` detects default pillar labels on persistence/entry/flow pillars.
- Thesis health section, hold plan, and narrative withhold aggregate `%` when uncalibrated.
- `collectBriefUnavailableSources()` emits `{ source: "thesis health", reason: "setup/entry/signal inputs unavailable for committed positions" }`.

## Verify at RTH

On any OPEN swing row in Ask Largo: Thesis health section should show pillar rows without a headline `%` when inputs are unwired; `UnavailableChip` should list thesis health absence.
