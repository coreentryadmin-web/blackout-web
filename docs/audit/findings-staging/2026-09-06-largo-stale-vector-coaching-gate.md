## 2026-09-06 — [FINDING, Largo/Swings, P2] Stale Vector desk still coached confluence/VEX/magnet/walls — FIXED

> **kind:** `FINDING`

### Symptom

`collectCoachingBullets()` pushed Vector-sourced coaching (VEX, confluence, expected move, wall integrity, magnet, wall dynamics, technicals, vector play) even when `vectorSnapshotStale()` was true — only `technicalsCoaching` and `crossDeskCoaching` gated internally.

### Root cause

Largo C2 staleness gates were applied per-function inconsistently. The assembly site called every Vector helper unconditionally after spot was known.

### Fix

Gate the entire Vector coaching block in `collectCoachingBullets()` behind `vectorLive = !vectorSnapshotStale(vec, readMs)`.

### Evidence

- RED→GREEN: new `collectCoachingBullets` stale/live tests in `play-brief-narrative-coaching.test.ts` — 33/33 pass on Node 20.

| **Status** | FIXED — PR opened |
