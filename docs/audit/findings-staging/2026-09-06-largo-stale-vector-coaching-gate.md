> **kind:** FINDING

## Largo swing brief — stale Vector desk bias still drives coaching friction — FIXED

| Field | Value |
|-------|-------|
| **ID** | BO-P2-largo-stale-vector-coaching-gate |
| **Pri** | P2 |
| **Area** | Night Hawk Swings / Ask Largo |
| **Status** | FIXED |

## Symptom

`counterThesisLine` already gates Vector `play.bias` on `vectorSnapshotStale()` (regression test in `play-brief-narrative.test.ts`), but the coaching bullets members see in **Trade manager read** did not:

- `crossDeskCoaching()` cited Vector bearish/bullish friction from stale snapshots ("Size down until desks agree").
- `vectorPlayCoaching()` emitted "Vector desk: **…** — aligned/cross-check" from stale `vec.play`.

Structured absence already adds `{ source: "Vector snapshot", reason: "stale — levels may lag spot" }` via `collectBriefUnavailableSources` while coaching still treated Vector bias as live — C2/C3 contradiction.

## Fix

- `vectorPlayCoaching`: return `null` when `vectorSnapshotStale(vec, Date.now())`.
- `crossDeskCoaching`: resolve `vec = vectorOf(ctx)` and only read `vec.play` when snapshot is fresh.

## Evidence

`npx tsx --test src/lib/swing/play-brief-narrative-coaching.test.ts` — stale Vector cases pass; existing fresh Vector friction test unchanged.

| **Status** | FIXED — PR opened, merge pending CI/peer-review |
