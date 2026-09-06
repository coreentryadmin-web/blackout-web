> **kind:** FINDING

## Swing play-brief diff snapshot re-derived GEX levels outside envelope.levels — FIXED

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Pri** | P2 |
| **Area** | Night Hawk Swings / Ask Largo — `play-brief.ts` diff engine inputs |
| **PR** | (pending) |

### Symptom

`composeSwingPlayBrief()` built `envelope.levels` via `levelsFromContext()` (with stale-GEX gating
in #4377) but then built the diff-engine `snapshotFromBrief()` extras by **re-reading raw**
`vec?.gammaFlip ?? gex?.flip` (and walls/spot) — a second code path that could bypass whatever
`levelsFromContext` decided to omit.

### Fix

Route snapshot extras through `extrasFromBriefResponse({ envelope, flowSnapshot, trimsFired })` so
diff inputs always match `envelope.levels` (single source of truth).

### Evidence

`npx tsx --test src/lib/swing/play-brief.test.ts` — new regression asserts snapshot extras equal
envelope level prices for spot / gamma flip / walls.

### Market-open validation

After #4377 merges: refresh Ask Largo on a row where stale GEX-only flip is withheld from
envelope levels — confirm "What changed" does not fire a spurious gamma-flip shift on refresh.
