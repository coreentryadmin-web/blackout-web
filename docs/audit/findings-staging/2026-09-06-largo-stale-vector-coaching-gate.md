> **kind:** FINDING

## Stale Vector coaching bullets still read live after #4402 — FIXED

| Field | Value |
|-------|-------|
| **ID** | BO-P2-largo-stale-coaching |
| **Pri** | P2 |
| **Area** | Ask Largo / Night Hawk Swings |
| **Status** | FIXED (PR pending) |

### Symptom

After #4400–#4402 gated `vectorPlayCoaching`, `technicalsCoaching`, and wall/desk sections, `collectCoachingBullets()` still pushed VEX, magnet, confluence, expected-move, wall-integrity, flow-print, and wall-dynamics coaching from stale Vector snapshots. `tradeManagerNarrativeSection()` also narrated `proximity` and `wallEvents` without a stale check.

### Root cause

#4402 scoped stale gating to walls/desk/play-coaching helpers but did not extend the same `vectorSnapshotStale()` early-return pattern to the remaining Vector-sourced coaching helpers in `play-brief-narrative-coaching.ts`.

### Fix

- Early `vectorSnapshotStale()` return in `vexCoaching`, `flowPrintsCoaching`, `magnetCoaching`, `confluenceCoaching`, `expectedMoveCoaching`, `wallIntegrityCoaching`, `wallDynamicsCoaching`.
- Gate `proximity` / `wallEvents` bullets and `wallDynamicsSection()` on live Vector.
- Stale Vector `spot` no longer wins envelope/narrative spot — falls through to live GEX spot (mirrors #4401 wall null-at-source pattern).

### Evidence

`npx tsx --test src/lib/swing/play-brief*.test.ts` — new regression tests for coaching null returns + proximity suppression + GEX spot fallthrough.
