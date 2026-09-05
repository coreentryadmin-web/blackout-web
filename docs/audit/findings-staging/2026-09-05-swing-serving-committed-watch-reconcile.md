# 2026-09-05 — Swing WATCH rail desync after live commit (deep-dive Q3)

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Severity** | P2 |
| **Area** | Swing discovery → serving snapshot |
| **Status** | FIXED |

## Symptom

When `swing-discovery` opened a real position on a scan, the persisted serving snapshot still listed the same thesis on the WATCH rail and in `playSet.SWING` as an ordinary pre-entry idea — indistinguishable from names the desk had not acted on.

## Root cause

`watchCandidates` / `playSet` were computed before the LIVE COMMIT block and never reconciled after `executeSwingCommits` succeeded. Gate blocks were stamped onto blocked plays only; successful commits were left unmarked.

## Fix

`reconcileServingAfterCommit()` drops opened thesis keys from `watchCandidates` and `playSet.SWING` before the cron persists the snapshot. Live rows continue to surface via `fetchOpenPositions` on the member route.

## Evidence

- `src/lib/swing/discovery.test.ts` — LIVE seam test asserts NVDA absent from watch + playSet after open.
- `reconcileServingAfterCommit` unit path covered by the same scan test.

## RTH validation

After a swing commit during RTH, reload Swings tab — the committed name should appear only in MANAGING/SCALING_OUT (live sections), not duplicated on the WATCH rail from the same scan snapshot.
