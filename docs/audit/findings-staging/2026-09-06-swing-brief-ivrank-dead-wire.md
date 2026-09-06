> **kind:** FINDING

## Swing play-brief: ivRank never reached TerminalPlay — FIXED

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Area** | Night Hawk Swings / Ask Largo |
| **Contract** | LARGO evidence + coaching |

### Symptom

`ivRankCoaching()` in `play-brief-narrative-coaching.ts` reads `play.ivRank`, but `loadOpenTerminalPlay()` / lane resolution never set it on `TerminalPlay`. IV rank exists on `SwingDossier.ivRank` and on committed rows as `feature_vector.iv_rank`, so coaching silently never fired.

### Fix

`resolveBriefIvRank()` overlays dossier IV rank (fresh) or commit-pinned `feature_vector.iv_rank` onto the resolved `TerminalPlay` for both open-ledger and lane paths.

### Evidence

Regression tests in `play-brief-resolve.test.ts` and `play-brief-narrative-coaching.test.ts`.
