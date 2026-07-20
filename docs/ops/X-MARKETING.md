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

## Showcase posts (manual, ticker-scoped)

Multi-product collage for a **single ticker** — Vector 0DTE chart, Helix flow tape, Thermal GEX, Largo read. SPX/SPXW adds Slayer + Night Hawk. Non-SPX posts **never** include SPX-only surfaces.

**Policy:** default is dry-run. Review `/opt/cursor/artifacts/x-showcase/showcase-<TICKER>-collage.png` and `manifest.json` before any live post. Do not auto-post from agents without human approval.

```bash
# Screenshots + collage + manifest only (default)
npm run x-showcase:dry -- --ticker NVDA

# Live post — requires explicit --post; verifies tweet on timeline before success
npm run x-showcase:post -- --ticker NVDA
```

Artifacts: `/opt/cursor/artifacts/x-showcase/` (`manifest.json`, panel PNGs, collage).

**Gotchas**

- Thermal has no URL ticker param — script searches the combobox (defaults to SPY).
- Helix must filter `#helix-ticker-search` and wait until tape rows match the ticker.
- X may accept a tweet (HTTP 201) then remove it within minutes — the script polls the timeline (~90s) and **fails closed** if the tweet is not visible.
