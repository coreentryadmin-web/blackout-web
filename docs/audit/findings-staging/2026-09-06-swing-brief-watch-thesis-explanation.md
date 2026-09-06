> **kind:** FINDING

## Swing play-brief: WATCH lane skipped attachThesisExplanation — FIXED

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Area** | Night Hawk Swings / Ask Largo |
| **Contract** | LARGO evidence + coaching |

### Symptom

`loadOpenTerminalPlay` restored dossier factors/regime via `attachThesisExplanation`, but the WATCH lane fallback in `resolveSwingPlayForBrief` only overlaid `ivRank`. Pre-entry rows showed "No pillar breakdown" and thesis-health regime pillar stayed `unread` when the persisted lane snapshot was stale but a fresh dossier existed.

### Fix

Mirror the open-path enrichment on the WATCH lane branch: load `reads`, call `attachThesisExplanation` before `horizonRowToDeckSource`.

### Evidence

Regression test in `play-brief-resolve.test.ts` (`resolveSwingPlayForBrief: WATCH lane restores factors/regime`).
