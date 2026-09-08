## 2026-09-06 — [FINDING, X/social autopilot, P4] Dead legacy engagement-limit constants — FIXED

> **kind:** `FINDING`

### Symptom

Found during a DISCOVERY-lane sweep of general shared `src/lib/*.ts` utilities for the population/
cohort-mismatch and mutate-in-place bug classes already fixed repeatedly elsewhere this session.
This sweep came back clean on both target bug classes (every `.sort()` call site checked operates
on a freshly-built local array or explicitly copies a caller-supplied array first; the one pair of
near-duplicate implementations found, `flow-raw-fields.ts`'s SSE-path field extraction vs `db.ts`'s
REST-path SQL, were compared field-by-field and currently agree exactly — recently and carefully
kept in sync, not drifted) — but surfaced dead code.

### Root cause

`src/lib/x-engage-config.ts` carried two unused exported constants:

- `ENGAGE_LIMITS` — labeled "Legacy export — prefer x-rate-budget.ts caps" in its own doc comment.
- `ENGAGE_LIMITS_CRON` — labeled `@deprecated use X_CRON_RUN_CAPS in x-rate-budget.ts`.

Both were confirmed zero-caller repo-wide (`grep -rn "ENGAGE_LIMITS"` matches only their own
definition lines). `X_CRON_RUN_CAPS` in `x-rate-budget.ts` is the live constant actually consumed
(`x-rate-budget.ts:163`) — these two were already fully superseded and correctly documented as
such; they were just never deleted after the migration.

### Fix

Removed both constants. Every other export in the file (`ENGAGEMENT_TARGETS`,
`ENGAGEMENT_TARGET_SET`, `isEngagementTarget`, `SEARCH_QUERIES`, `DISCOVERY_SEARCH_QUERIES`,
`MIN_IMPRESSIONS_FOR_DISCOVERY_RT`, `MAX_TWEET_AGE_HOURS`, and siblings) is untouched.

### Evidence

- `grep -rn "ENGAGE_LIMITS\b"` / `grep -rn "ENGAGE_LIMITS_CRON\b"` before the fix: 1 file each (the
  definition). Same greps after: 0 files.
- No test file exists for `x-engage-config.ts` (confirmed via `ls`), so no test changes needed.
- `npx tsc --noEmit`: clean.
- Full `npm test` (Node 20): see PR for final count.

### Blast radius

`src/lib/x-engage-config.ts` only — a single-file, two-constant removal with no other consumer.

| **Status** | FIXED — PR opened, merge pending CI/peer-review per standing policy |
