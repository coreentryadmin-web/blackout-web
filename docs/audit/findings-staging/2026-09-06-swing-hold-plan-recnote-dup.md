# Swing play brief — Hold plan duplicated Management content

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Area** | Night Hawk Swings / Ask Largo play-brief |
| **PR** | (this branch) |

## Symptom

OPEN/HOLD swing briefs with `expandIntel` or without Trade manager read narrative showed the same `recNote`, desk stance, trim ladder, rails, and manage-engine line twice — once under **Management** and again under **Hold plan**.

## Root cause

`holdPlanSection` copied the same management fields that `managementSection` (`play-brief.ts`) already owns. Same duplication class as #4257 (`whyThisSetupSection` repeating `recNote`).

## Fix

`holdPlanSection` now carries only hold-specific coaching: DTE/theta, earnings window, session time stop, runner fraction, thesis-health fade/giveback — not Management-owned stance/note/rails.

## RTH validation

Open a live HOLD swing with `recNote` and DTE on the contract; confirm the note appears once under Management, Hold plan shows time/theta/earnings only.
