# 2026-09-05 — Swing WATCH rail desync after same-scan commit

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Severity** | P2 |
| **Area** | Swing discovery → serving snapshot |
| **Status** | FIXED |

## Symptom

When `swing-discovery` opened a real position in the same scan pass, `watchCandidates` and `playSet.SWING` still presented the thesis as an ordinary WATCH idea in the persisted serving snapshot — even though the ledger row existed. The horizons route eventually reconciled via `fetchOpenPositions`, but the snapshot itself was wrong until the next scan.

## Root cause

`runSwingDiscoveryScan` computed `watchCandidates` and `playSet` before the commit block and returned them unchanged after `executeSwingCommits`.

## Fix

`reconcileServingAfterCommits` — after a successful insert, remove committed thesis keys from `watchCandidates` and stamp matching plays `status: "COMMIT"`.

## Evidence

- `src/lib/swing/discovery-serving-reconcile.test.ts` — RED→GREEN on reconcile helper.
- Deep-dive Q3 in `docs/audit/SWING-V2-DEEPDIVE-TRIAGE-RESPONSES-2026-09-05.md`.

## RTH validation

After a swing commit during POST_CLOSE discovery, inspect persisted `swing:serving:latest:v1` (admin) or Swings lane: a name the desk just opened should not also appear on the WATCH rail in the same snapshot.
