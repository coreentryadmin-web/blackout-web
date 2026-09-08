# SPX warming false-RED in four-engine audit

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Severity** | P2 |
| **Area** | RTH audit harness |

## Symptom

`npm run validate:rth-four-engines` reported **RED — critical play issues** during healthy RTH when SPX play was in cross-replica lock wait (`degradedPlayPayload`: `assessed:false`, `available:false`, action `SCANNING`).

## Root cause

`analyzeSpx` treated any `degraded: true` as RED. The member play route intentionally returns `degradedPlayPayload()` while another ECS replica holds the eval lock — transient, not a product defect.

## Fix

`scripts/audit/lib/rth-spx-play-flags.mjs` classifies warming (`assessed:false` + `available:false`) as **AMBER WARMING**; evaluated-but-degraded stays **RED**.

## RTH validation

Re-run `npm run validate:rth-four-engines` during RTH when SPX is SCANNING — verdict should not be RED solely from a warming payload.
