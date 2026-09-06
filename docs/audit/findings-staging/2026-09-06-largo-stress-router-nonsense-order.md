> **kind:** FINDING

## Largo nightly stress — router misclassified `???` as compound_lookup — FIXED

| Field | Value |
|-------|-------|
| **ID** | BO-ops-4233-router |
| **Status** | FIXED |
| **Area** | Largo stress harness |
| **Issue** | #4233 |

### Root cause

`scripts/largo-stress-run.mjs` checked `isCompoundQuestion()` before `isNonsenseQuestion()`. The stress-bank entry `{ q: "???", intent: "clarify_read" }` has three `?` characters, so the compound heuristic fired first — unlike production `classifyBieIntent`, which returns `clarify_read` via `isNonsenseQuestion`.

Secondary: Largo stress runs ~32–45 minutes while `STALE_USER_MS` was 30 minutes. A concurrent harness sweep could delete the in-flight stress temp user (`sign_in_tokens` → HTTP 404), causing 13 transport SKIPs at the end of the nightly run.

### Fix

1. Mirror production router ordering: out-of-scope → nonsense → compound → classify.
2. Export shared `isCompoundQuestion()` in `question-focus.ts` with `isNonsenseQuestion` guard; stress harness imports it.
3. Set `AUDIT_STALE_USER_MS=3600000` for live stress runs; honor env override in `prod-clerk-session.mjs`.
4. Intent-aware `honestyIssues()` exemptions for scenario, concept_read, platform_read; skip `concept_read` in scoring.

### Evidence

- Nightly run 34029670177: `router_mismatch: 1` on `???`; `live_skipped_transport: 13` after user 404.
- `LARGO_STRESS_LIMIT=109 node --import tsx scripts/largo-stress-run.mjs` → `router_mismatch: 0` post-fix.
