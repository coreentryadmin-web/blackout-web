# Welcome sequence cron (steps 2–5)

Step **1** of the 5-email welcome drip fires inline from the Clerk `user.created` webhook
(`startWelcomeSequence` in `src/lib/welcome-sequence.ts`).

Steps **2–5** (days 2/4/6/8) are sent by `GET /api/cron/welcome-sequence`, which must run
**hourly** via EventBridge → Lambda → hit-cron.

## Repo checklist (already on `main`)

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

## Production: provision EventBridge (one-time)

**Preferred:** sync from `blackout-infra/scripts/sync-cron-schedules.mjs` (reads `railway.*.toml`).

**Manual fallback** (only if infra sync is blocked):

```bash
aws events put-rule \
  --name blackout-production-welcome-sequence \
  --schedule-expression 'cron(0 * * * ? *)' \
  --region "$AWS_DEFAULT_REGION"

aws events put-targets \
  --rule blackout-production-welcome-sequence \
  --region "$AWS_DEFAULT_REGION" \
  --targets 'Id=1,Arn=arn:aws:lambda:ACCOUNT_ID:function:blackout-production-hit-cron,Input={"key":"welcome-sequence","path":"/api/cron/welcome-sequence"}'
```

Run only when the ECS web fleet is at steady state (one deployment, `COMPLETED`) so a mid-rollout
task without the staleness cutoff does not flush a stale backlog.

## Verify after first hour

1. Admin → Operations → cron health: **Welcome Sequence** should show recent `ok` runs.
2. Postgres: `welcome_sequence_state` rows with `steps_sent > 1` and advancing `next_send_at`.
3. CloudWatch: `[welcome-sequence]` logs — `sent` count, not only `retired` backlog rows.

## Requirements

- `RESEND_API_KEY` in ECS secrets (marketing sends)
- `RESEND_TOPIC_MARKETING_ID` for one-click unsubscribe on drip mail
- `CRON_SECRET` on the hit-cron Lambda (same as all crons)
