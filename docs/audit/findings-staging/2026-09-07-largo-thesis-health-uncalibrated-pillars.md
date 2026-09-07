## 2026-09-07 — [FINDING, P1 Largo] Uncalibrated thesis-health pillars showed misleading default labels — FIXED

> **kind:** `FINDING`

### Symptom

On OPEN swing plays where `thesisHealthUncalibrated()` is true (committed rows missing `setupState`/`entryStatus`/`signalKinds`), the Ask Largo "Thesis health" section correctly withheld the aggregate **%** score but still rendered pillar rows like `Persistence — unknown (Δ -8.0 pts)` built from generic defaults. Users could read those rows as live calibrated reads.

### Root cause

`thesisHealthSection()` in `play-brief.ts` gated only the headline on `uncalibrated`; pillar rows were always rendered from `h.pillars` regardless.

### Fix

When `thesisHealthUncalibrated(h)` is true, return a single honest absence line — aggregate score **and** pillar breakdown withheld — with no pillar bullet list.

### Evidence

- RED→GREEN: existing `composeSwingPlayBrief: OPEN play emits management + thesis health` fixture uses `currentLabel: "unknown"` pillar; new assertion fails pre-fix, passes post-fix.
- `npx tsx --test src/lib/swing/play-brief.test.ts` — see PR.

| **Status** | FIXED — PR opened |
