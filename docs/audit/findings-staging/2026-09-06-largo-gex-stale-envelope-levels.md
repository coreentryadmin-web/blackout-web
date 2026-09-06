> **kind:** FINDING

## Largo C2 (freshness) — stale GEX-only walls/posture reached Largo envelope levels + evidence — FIXED

**Status:** FIXED (this PR)

### Root cause

`levelsFromContext` and `evidenceFromContext` in `src/lib/swing/play-brief.ts` build the
`BieAnswerEnvelope.levels` / `.evidence` arrays that Largo's desk read renders directly
(`BieKeyLevelsTable`, `BieEvidencePanel`, `ladderFromLevels`). They cited call/put walls, gamma
flip, GEX king strike, and dealer `gamma_posture` from `gex_positioning` with no staleness gate
when Vector was absent — the same Largo C2 class already fixed in `gexPostureSection` (#4360),
`counterThesisLine` (#4364), `watchForSection` (#4367), `chartLevelsSection` (#4372), and
king/magnet narration (#4375), but missed on the envelope path because it predates the intel-section
audit sweep.

### Evidence

- `levelsFromContext` pushed GEX-only walls/flip/king with only a `freshness` label — Largo still
  rendered them as actionable key levels.
- `evidenceFromContext` emitted `Dealer posture: γ long · net GEX …` off `matrix_age_sec: 200`
  with no Vector desk present.
- Three new regression tests in `play-brief.test.ts` — stale suppression + Vector-regime override.
- `npx tsx --test src/lib/swing/play-brief.test.ts` — pass.

### Fix

Per-side stale GEX gating in `levelsFromContext` (mirrors #4372). `evidenceFromContext` uses live
Vector `regime.posture` when present; GEX-only posture and supplementary net_gex/wall/flip fields
require `!gexMatrixStale()`.

### Blast radius

`play-brief.ts` envelope builders only. No API/schema changes.

### Market-open validation

Pull `GET /api/market/swing/play-brief` for an open swing with stale `gex_positioning`
(`matrix_age_sec` > 120) and no Vector snapshot — envelope key levels must omit call/put wall,
gamma flip, and GEX king; dealer posture evidence must be absent unless Vector regime is live.
