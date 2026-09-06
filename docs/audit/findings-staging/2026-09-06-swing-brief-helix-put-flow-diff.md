# Swing play-brief HELIX put-only flow diff — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Priority** | P2 |
| **Area** | Night Hawk Swings / Ask Largo |
| **Contract** | C7 evidence (live diff) |
| **Status** | FIXED in `fix/swing-brief-helix-put-flow-diff` |

## Root cause

`diffBriefSnapshots()` only entered the HELIX flow-shift branch when **call** premium moved >$50k. Put-building detection was nested inside that branch, so flat call + surging puts (common on SHORT-conflict setups) emitted zero diff lines.

## Fix

Independent `putMoved` check mirrors call logic; put-only builds now emit `HELIX tape: put flow building`.

## RTH validation

On `/nighthawk` Swings OPEN tab during RTH, refresh a SHORT play where put premium is building but call premium is flat — Trade manager read pulse should include `HELIX tape: put flow building`.
