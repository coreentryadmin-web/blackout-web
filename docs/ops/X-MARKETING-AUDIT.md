# X Marketing CTO Audit (@BlackOutTrade)

**Updated:** 2026-07-21 · **Status:** pay-per-use API aligned

## Executive summary

~**1,908 followers** but recent posts average **~8–40 impressions** and **~0 likes**. Reach is algorithm-cold after legacy spam. Growth on the **pay-per-use (PPU) X API** is **your timeline + summoned @mention replies** — not automated FinTwit quotes.

| Symptom | Root cause |
|---------|------------|
| No new followers | Low impressions; API cannot quote FinTwit on PPU |
| No likes | Posts barely shown; need desk PNG + question hooks |
| 403 on growth | Old stack tried API quotes — **Enterprise-only** on self-serve |

## Pay-per-use API (current model)

Official docs: [X API pricing](https://x-preview.mintlify.app/x-api/getting-started/pricing), [Manage Posts](https://x-preview.mintlify.app/x-api/posts/manage-tweets/introduction).

| Action | Self-serve (PPU) | Cost (approx.) |
|--------|------------------|----------------|
| Desk post **without URL** in body | ✅ | **$0.015** / post |
| Desk post **with URL** in body | ✅ | **$0.20** / post |
| Summoned @mention reply | ✅ | **$0.01** / post |
| Quote-post via API | ❌ Enterprise only | — |
| Cold reply to FinTwit thread | ❌ unless they @you | — |
| Like / follow | ✅ (no bulk spam) | **$0.015** / action |

**Env (Secrets Manager / ECS):**

| Variable | Default | Meaning |
|----------|---------|---------|
| `X_API_ACCESS_TIER` | `ppu` | `enterprise` enables FinTwit quote/reply in `x-growth` |
| `X_DESK_POST_INCLUDE_URL` | off on PPU | `1` = pricing URL in tweet ($0.20/post) |
| `X_MARKETING_POSTS_PAUSED` | off | `1` = skip autopost + mention replies |
| `X_GROWTH_SILENT_ONLY` | off | `1` = likes/follows only |

**Cost example (7 desk posts/day):** ~$3.15/mo without URL in tweet vs ~$42/mo with URL (bio carries link).

## What the stack does on PPU

| Cron | Behavior |
|------|----------|
| `x-autopost` | RTH desk card + question; footer `@BlackOutTrade · link in bio` |
| `x-growth` | Likes, follows, selective RT — **no API quotes** |
| `x-replies` | Reply when someone @mentions us (summoned) |
| `x-analytics` | Daily follower/impression snapshot |

**Manual FinTwit discovery:** quote-tweet from the **X app** 2–3×/day at RTH open (API cannot on PPU).

## Manual ops

```bash
npm run x-marketing:audit
npm run x-cleanup -- --dry && npm run x-cleanup
npm run x-profile:optimize
npm run x-marketing:run desk-post
npm run x-marketing:run engage-all   # likes + @mention replies
npm run x-marketing:run growth       # likes/follows (PPU)
npm run x-marketing:run engage-silent
```

## KPI targets (30 days)

| Metric | Now | Target |
|--------|-----|--------|
| Avg impressions/post | ~8–40 | **500+** |
| Avg likes/post | ~0 | **5+** |
| New followers/week | ~0 | **10+** |
| Summoned replies/week | varies | **10+** |

## P1

- CI gate for `validate:x-marketing`
- Track `utm_source=x` → signups
- Pin best desk post manually after each strong autopost
