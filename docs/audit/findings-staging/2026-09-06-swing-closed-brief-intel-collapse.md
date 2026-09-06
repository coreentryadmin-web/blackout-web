# Closed Ask Largo brief silently dropped GEX/flow intel

> **kind:** `FINDING`

| **Status** | FIXED (PR pending) |
|------------|-------------------|
| **Audit** | `docs/audit/SWING-SYSTEM-CTO-AUDIT-2026-09-06.md` finding **#2** |

## Symptom

CLOSED play-briefs showed a false "Desk detail for N sections folded into Trade manager read" note while GEX posture, Wall dynamics, Flow & positioning, and Macro tape sections were deleted — even though the closed-bucket narrative only runs `closedCoaching` (exit P&L / MFE capture), not dealer/wall/flow narration.

## Root cause

`collapseRedundantIntelSections()` accepted `bucket` but ignored it. Any brief with a non-empty Trade manager read triggered collapse for all buckets identically.

## Fix

Skip intel collapse when `bucket === "closed"` so frozen-at-close desk context survives as standalone sections.
