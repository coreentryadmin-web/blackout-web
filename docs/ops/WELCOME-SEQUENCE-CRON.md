# Welcome sequence cron (steps 2–5)

Step **1** of the 5-email welcome drip fires inline from the Clerk `user.created` webhook
(`startWelcomeSequence` in `src/lib/welcome-sequence.ts`).

Steps **2–5** (days 2/4/6/8) are sent by `GET /api/cron/welcome-sequence`, which runs
**hourly** via EventBridge → Lambda → hit-cron.

## Production status — LIVE (verified 2026-08-12)

| Check | Result |
|-------|--------|
| EventBridge rule `blackout-production-welcome-sequence` | **ENABLED** — `cron(0 * * * ? *)` |
| Lambda target | `blackout-production-hit-cron` with `{"key":"welcome-sequence","path":"/api/cron/welcome-sequence"}` |
| Lambda invoke permission | `events-welcome-sequence` on hit-cron |
| Invocations (last 24h) | **24/24** hourly fires (CloudWatch `AWS/Events` Invocations) |

No further one-time provisioning needed unless the rule is deleted.

## Repo checklist

| Artifact | Path |
|----------|------|
| HTTP route | `src/app/api/cron/welcome-sequence/route.ts` |
| Registry + staleness watchdog | `src/lib/cron-registry.ts` (`welcome-sequence`) |
| Schedule catalog | `railway.welcome-sequence.toml` (`0 * * * *`) |
| Service map | `scripts/railway-cron-services.mjs` |
| Unit tests | `src/lib/welcome-sequence.test.ts`, `src/lib/email-captures.test.ts` |

Validate locally:

```bash
node scripts/validate-railway-cron-manifest.mjs   # welcome-sequence must align
npx tsx --test src/lib/welcome-sequence.test.ts
```

## Re-provision (only if rule missing)

**Preferred:** sync from `blackout-infra/scripts/sync-cron-schedules.mjs` (reads `railway.*.toml`).

**Manual fallback:** create rule `blackout-production-welcome-sequence` on schedule
`cron(0 * * * ? *)` targeting Lambda `blackout-production-hit-cron` with input
`{"key":"welcome-sequence","path":"/api/cron/welcome-sequence"}` (same shape as
`blackout-production-membership-reconcile`).

Run only when the ECS web fleet is at steady state (one deployment, `COMPLETED`) so a mid-rollout
task without the staleness cutoff does not flush a stale backlog.

## Verify ongoing

1. Admin → Operations → cron health: **Welcome Sequence** should show recent `ok` runs.
2. Postgres: `welcome_sequence_state` rows with `steps_sent > 1` and advancing `next_send_at`.
3. CloudWatch: `[welcome-sequence]` logs — `sent` count, not only `retired` backlog rows.
4. AWS Console → EventBridge → Rules → `blackout-production-welcome-sequence` (ENABLED, hourly).

## Requirements

- `RESEND_API_KEY` in ECS secrets (marketing sends)
- `RESEND_TOPIC_MARKETING_ID` for one-click unsubscribe on drip mail
- `CRON_SECRET` on the hit-cron Lambda (same as all crons)
