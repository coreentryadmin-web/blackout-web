# Swing brief — drop duplicate GEX posture / wall dynamics when spot is known

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **ID** | BO-P2-2026-09-06-swing-gex-dedup |
| **Status** | FIXED |
| **Area** | Swing Ask Largo play brief |
| **PR** | (this branch) |

## Symptom

OPEN swing briefs with Vector spot wired showed three overlapping gamma/wall surfaces: the new **Trade manager read** narrative (posture + wall beads) plus legacy **GEX posture** and **Wall dynamics** list sections — the operator complaint that motivated the narrative work.

## Fix

`buildIntelSections` skips `gexPostureSection` / `wallDynamicsSection` when spot is known (same spot resolution as the narrative). When spot is missing, the narrative only emits entry/manage degraded copy, so the legacy GEX sections still render.

## Evidence

`npx tsx --test src/lib/swing/play-brief.test.ts` — OPEN+vector case asserts no duplicate titles; WATCH-without-spot case asserts GEX posture still present alongside degraded narrative.
