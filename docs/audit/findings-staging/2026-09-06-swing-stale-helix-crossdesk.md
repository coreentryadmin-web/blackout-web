> **kind:** FINDING

## Stale HELIX flow coached cross-desk friction and counter-thesis — FIXED

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Pri** | P2 |
| **Area** | Ask Largo / swing play-brief |
| **PR** | (pending) |

### Symptom

When `flow_feed_fresh === false`, Ask Largo still cited stale `recent_flow` in `crossDeskCoaching` (`HELIX call-led` / `HELIX put-led`) and `counterThesisLine`, contradicting the C2/C3 absence contract already enforced in `flowNarrative`, `flowIntelSection`, and `collectBriefUnavailableSources`.

### Root cause

#4181 introduced `trustedHelixFlow()` but only wired it into `flowNarrative` / intel sections — `crossDeskCoaching` and `counterThesisLine` kept reading raw `eco.recent_flow`.

### Fix

Route both paths through `trustedHelixFlow(eco)`. Regression tests in `play-brief-narrative-coaching.test.ts`, `play-brief-narrative.test.ts`, and extended integration assertion in `play-brief.test.ts`.
