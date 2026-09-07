## 2026-09-07 — [FINDING, P4 docs/hygiene] `isCronAuthorized`'s doc comment hardcoded a stale cron count ("23 cron writers"); real count is 53 — FIXED

> **kind:** `FINDING`

### Symptom

Found during a DISCOVERY-lane sweep of generic/shared API-route plumbing (`src/lib/market-api-auth.ts`, the single auth gate every `src/app/api/cron/*/route.ts` handler calls). Its own doc comment read:

```ts
// Constant-time compare — this is the single auth gate for all 23 cron writers (every
// route under api/cron/*), so the `===` early-exit shouldn't leak the secret
// byte-by-byte via response timing.
```

`find src/app/api/cron -maxdepth 1 -type d | wc -l` → **53** directories today, not 23. The comment's actual *claim* (this function gates every cron route) was verified still true — `grep -rL "isCronAuthorized" src/app/api/cron/*/route.ts` returned zero routes missing the call — only the hardcoded number had drifted as the cron fleet grew.

### Root cause

A specific count was written into a doc comment describing an open-ended, growing set (every route under `api/cron/*`). The count was accurate when written but had no mechanism keeping it in sync as new crons were added over time — nothing re-derives or checks it.

### Fix

Dropped the hardcoded number entirely ("all 23 cron writers" → "every cron writer") so the comment can't go stale on the same axis again — it now states the invariant, not a snapshot of it.

Added a **drift-guard test** in `src/lib/market-api-auth.test.ts` that reads every `src/app/api/cron/*/route.ts` file and asserts each one actually contains a call to `isCronAuthorized` — this is the meaningful, durable version of what the old comment was trying to claim: not "the count is N," but "every cron route is actually gated." A future cron route that's added without this call now fails a test instead of silently shipping unauthenticated, and the comment's claim can never again silently drift from reality.

### Evidence

- RED→GREEN: temporarily renamed `isCronAuthorized` → `REMOVED_AUTH_CHECK` in one live cron route (`src/app/api/cron/data-correctness/route.ts`), confirmed the new drift-guard test fails (2 pass / 1 fail) — restored the file, confirmed 3/3 pass.
  - First attempt at this proof used a substring-preserving mutation (`isCronAuthorized` → `XisCronAuthorizedX`) which did NOT fail the test, because the assertion regex has no word boundaries and `isCronAuthorized` is still a substring of `XisCronAuthorizedX` — caught and corrected before treating the guard as proven.
- `npx tsc --noEmit`: clean.
- Full `npm test` (Node 20): see PR for final count.

### Blast radius

`src/lib/market-api-auth.ts` (comment only, no behavior change) and `src/lib/market-api-auth.test.ts` (new drift-guard test). No other file touched, no runtime behavior changed.

| **Status** | FIXED — PR opened, merge pending CI/peer-review per standing policy |
