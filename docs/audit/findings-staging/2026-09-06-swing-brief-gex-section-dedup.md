> **kind:** FINDING

## Swing Ask Largo brief — duplicate GEX posture + wall dynamics sections — FIXED

| Field | Value |
|-------|-------|
| **Status** | FIXED (PR pending) |
| **Priority** | P2 |
| **Area** | Swing / Ask Largo play brief |
| **Discovered** | 2026-09-06 (Claude #4101 peer note + Cursor sweep) |

### Symptom

When Vector spot + GEX data were present, the swing play brief rendered **three** overlapping reads of the same dealer gamma posture and wall bead data:

1. `Trade manager read` (rich narrative — `play-brief-narrative.ts`)
2. `GEX posture` (flat list — `gexPostureSection`)
3. `Wall dynamics` (flat list — `wallDynamicsSection`)

Members saw repeated numbers/lists — the original operator complaint that motivated the trade-manager narrative.

### Root cause

`buildIntelSections()` always appended legacy `gexPostureSection` + `wallDynamicsSection` even when `tradeManagerNarrativeSection` already reads `gamma_posture`, nearest walls, and the latest `wallEvents` bead.

### Fix

Skip the legacy list sections when the trade-manager narrative is present. Keep them as fallback when narrative cannot build (no spot / no vector read).

### Evidence

`play-brief.test.ts` OPEN+vector fixture: asserts `Trade manager read` present and `GEX posture` / `Wall dynamics` titles absent. 9/9 swing brief tests pass; `tsc --noEmit` clean.

### RTH validation

Open a swing OPEN/HOLD row with Vector + GEX on `/terminal` → Ask Largo → confirm one dealer-posture read under **Trade manager read**, no separate **GEX posture** / **Wall dynamics** section headers.
