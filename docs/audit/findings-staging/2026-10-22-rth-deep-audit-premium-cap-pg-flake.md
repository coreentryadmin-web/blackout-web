> **kind:** FINDING

## RTH deep audit false RED — Night Hawk premium cap + Postgres flake — FIXED

| **Status** | FIXED (PR pending) |
|------------|-------------------|

**Observed (2026-10-22 ~19:02 UTC, commit `7b0f46b`, workflow RTH deep audit):**

1. `full-site-deep-audit.mjs` flagged `[nighthawk] PREMIUM-CAP: CRL entry $27.35 > $20 cap` (P1). Production gate is `MAX_OPTION_PREMIUM_PER_SHARE = 35` in `src/features/nighthawk/lib/constants.ts` — verifier already aligned elsewhere; deep audit was stale at $20.
2. Postgres section failed with `read ECONNRESET` while `rth-open-check` / `pg-audit.mjs` already treat that as unreachable (skip). `gha-rth-audit.mjs` did not import `isPrivateDbUnreachableError`.
3. `socket-health` returned HTTP 503 once during cron HTTP checks (likely rollout blip).

**Fix:**

- Sync deep audit cap to $35/share constant.
- Use `isPrivateDbUnreachableError` in `gha-rth-audit` Postgres catch (skip, not fail).
- Single 2.5s retry on cron route fetch for 502/503.

**Verify:** Next scheduled `RTH deep audit` on `main` GREEN after merge.
