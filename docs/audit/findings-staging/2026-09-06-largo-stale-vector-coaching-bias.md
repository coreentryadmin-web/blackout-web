## 2026-09-06 — [FINDING, Largo Swings, P2] Stale Vector play.bias still drove cross-desk coaching — FIXED

> **kind:** `FINDING`

### Symptom

`counterThesisLine()` in `play-brief-narrative.ts` was gated with `vectorSnapshotStale()` (Largo C2),
but `crossDeskCoaching()` and `vectorPlayCoaching()` in `play-brief-narrative-coaching.ts` still read
`vec.play.bias` from stale Vector snapshots — emitting **"Cross-desk friction — Vector bearish"** or
**"aligned with swing lane"** as if the desk read were live.

### Root cause

Partial fix from `2026-09-06-largo-stale-vector-play-bias-counter-thesis.md` only patched the
counter-thesis steelman path; sibling coaching call sites were missed.

### Fix

Import `vectorSnapshotStale` in `play-brief-narrative-coaching.ts` and gate Vector bias usage in
`crossDeskCoaching` and `vectorPlayCoaching` the same way as `counterThesisLine`.

### Evidence

- Regression tests: stale Vector no longer invents cross-desk friction or alignment claims.
- `npx tsx --test src/lib/swing/play-brief-narrative-coaching.test.ts` — all pass.

| **Status** | FIXED — PR opened, merge pending CI/peer-review per standing policy |
