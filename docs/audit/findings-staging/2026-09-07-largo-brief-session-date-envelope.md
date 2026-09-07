# Largo swing brief — session_date missing from envelope (C1)

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Area** | Largo / Night Hawk Swings |
| **PR** | fix/largo-brief-session-date-diff-persist |

## Symptom

`composeSwingPlayBrief` computed `ctx.sessionDate` and returned it on the API wrapper (`SwingPlayBriefResult.sessionDate`), but `BieAnswerEnvelope` only carried `asOf`. Cross-product session gating helpers (`zerodteLiveForSession`, `nighthawkLiveForSession`) and future Largo tool parity need the ET session join key on the envelope the UI binds to.

## Fix

- Add optional `session_date` to `BieAnswerEnvelope`
- Set `session_date: ctx.sessionDate` in `composeSwingPlayBrief`
- Persist brief diff snapshots in `sessionStorage` keyed by `playId:session_date` so "since last read" survives remounts

## Verify at RTH

Open Night Hawk Swings → select a row → Ask Largo rail → refresh tab → return to same row: header should still show update count if marks moved during the session.
