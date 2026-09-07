> **kind:** FINDING

## Largo brief provenance freshness mislabeled future-skewed timestamps as "unknown" — FIXED

| **Status** | FIXED in PR (pending) |
|---|---|
| **Severity** | P2 |
| **Area** | Ask Largo / swing play-brief |
| **Contract** | Largo C2 (freshness) |

### Symptom

Follow-up to #4452: `gexMatrixStale` / `vectorAgeStale` in `play-brief-absence.ts` now fail-closed on
clock-skewed future stamps, but `gexFreshness` and `fundamentalsFreshness` in `play-brief.ts` still
called `freshnessFromAgeMs` directly. Negative age returned `"unknown"` instead of `"stale"`, so
envelope provenance could understate untrustworthiness on fundamentals evidence (short interest).

### Root cause

`freshnessFromAgeMs` treats any `ageMs < 0` as `"unknown"`. That is correct for missing data but not
for measured clock skew — the product already treats beyond-tolerance future stamps as stale everywhere
else (`WS_TIMESTAMP_FUTURE_TOLERANCE_MS`).

### Fix

- `gexFreshness`: delegate to `gexMatrixStale` before classifying — returns `"stale"` when absence
  layer would gate.
- `fundamentalsFreshness`: explicit future-skew guard → `"stale"`.

### Evidence

`npx tsx --test src/lib/swing/play-brief.test.ts` — new regression
`future-skewed fundamentals as_of freshness is stale, not unknown`.

### Market-open watch

Off-hours only. At RTH, open a swing brief with live fundamentals and confirm Short interest
provenance reads `recent`/`live`, not `unknown`, when `as_of` is sane.
