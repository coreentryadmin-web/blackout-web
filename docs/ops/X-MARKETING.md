# X Marketing (@BlackOutTrade)

Autonomous growth stack — prod only (`blackout-web` `main`).

## Crons (EventBridge → Lambda → `/api/cron/*`)

| Job | Schedule | Role |
|-----|----------|------|
| `x-autopost` | Even ET hours 8–20 (UTC-aligned) | 1 desk post / 2h — live SPX, human voice, live desk card PNG, Whop UTM |
| `x-growth` | Hourly weekdays | Silent likes/follows — **budget capped** |
| `x-replies` | Hourly :20 weekdays | @mention replies — AI + dedup |
| `x-analytics` | Daily | Follower + tweet metrics snapshot |

**Not scheduled:** `x-engage` (manual alias of growth with `?manual=1`).

## Rate limits (never hit 429)

Central budget in `src/lib/x-rate-budget.ts` + Postgres `platform_meta`:

- **Daily caps (ET):** 48 likes · 12 follows · 24 replies · 2 RTs · 7 posts
- **Per cron run:** 3 likes · 1 follow · 2 replies · 0 RTs
- **On any 429:** 15-minute global pause for all X write actions
- **Jitter:** 2–4.5s between actions

Manual runs: `npm run x-marketing:run engage` hits `?manual=1` (higher per-run cap, still daily bounded).

## Validate

```bash
npm run validate:x-marketing
```

## Infra

X crons live in `blackout-infra` `cron-jobs.json`. **Requires production Terraform apply** to create EventBridge rules.

## Cleanup legacy @tag spam

```bash
node scripts/x-cleanup-tag-spam.mjs --dry
node scripts/x-cleanup-tag-spam.mjs
```
