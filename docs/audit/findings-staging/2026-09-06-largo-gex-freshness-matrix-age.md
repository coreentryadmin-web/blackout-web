> **kind:** FINDING

## Largo C2 (freshness) — envelope GEX provenance ignored matrix_age_sec — FIXED

**Status:** FIXED (this PR)

### Root cause

`gexFreshness()` in `src/lib/swing/play-brief.ts` derived envelope provenance freshness only from
`gex.asof` vs read time. The shared GEX matrix age used everywhere else on the swing read path
(`gexMatrixAgeMs` / `gexMatrixStale` in `play-brief-absence.ts`) prefers `matrix_age_sec` when
present. When those disagree — a recent `asof` timestamp with `matrix_age_sec` > 120s — narrative
sections correctly treated the matrix as stale while the BIE envelope still labeled dealer-posture
evidence and level provenance as **live**.

### Evidence

- New regression test `"GEX evidence freshness honors matrix_age_sec over recent asof"`: with
  `matrix_age_sec: 300` and `asof: new Date().toISOString()`, pre-fix freshness was `"live"`; post-fix
  is `"recent"` (300s age honored).
- `npx tsx --test src/lib/swing/play-brief.test.ts` — 24/24 pass.

### Fix

Route `gexFreshness()` through `gexMatrixAgeMs()` so envelope provenance uses the same age source as
`gexMatrixStale()` / `collectGexStalenessAbsence()`.

### Blast radius

`composeSwingPlayBrief` envelope evidence + level provenance freshness for GEX-sourced fields only.
