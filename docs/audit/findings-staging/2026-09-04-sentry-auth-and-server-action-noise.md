## 2026-09-04 — [NOISE, P3 telemetry] Clerk benign auth messages + stale Server Action IDs polluted Sentry — FIXED

> **kind:** `FINDING`

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Severity** | P3 — error-rate / telemetry noise, not member-visible product defect |
| **Found by** | Autopilot `validate:deploy` Sentry sample + standing 24/7 sweep |

### Root cause

1. **`ClerkAuthFailure: You're already signed in`** — `AuthFailureObserver` reported every Clerk error DOM string, including the normal "already signed in" state when an authenticated user visits `/sign-in`.
2. **`UnrecognizedActionError: Server Action … was not found`** — same deploy-race class as `ChunkLoadError`: tabs open across ECS rollouts keep stale Server Action IDs. The chunk-reload guard did not match this error, so members saw failures and Sentry logged noise instead of a one-shot reload.

### Fix

- `auth-failure-detect.ts`: `isBenignClerkAuthMessage()` denylist; `shouldReportAuthFailure` skips benign strings.
- `chunk-reload.ts` + `layout.tsx` inline guard: extend `CHUNK_ERROR_PATTERN_SOURCE` with `UnrecognizedActionError` / `Server Action … was not found`.

### Evidence

- `npx tsx --test src/components/auth/auth-failure-detect.test.ts src/lib/chunk-reload.test.ts` — GREEN
- `npx tsc --noEmit` — clean

### Market-open validation

Confirm Sentry top issues no longer include `ClerkAuthFailure: You're already signed in` or `UnrecognizedActionError` during/after a deploy rollout (logged in `docs/audit/MARKET-OPEN-VALIDATION.md`).
