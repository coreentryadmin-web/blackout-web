# X Marketing CTO Audit (@BlackOutTrade)

**Date:** 2026-07-20 · **Status:** P0 remediation in progress

## Executive summary

We have **~1,910 followers** but recent posts average **~20 impressions** and **0–2 likes**. The autonomous stack is **technically healthy** (`npm run validate:x-marketing` passes), but **growth is broken at the content + distribution layer**:

| Symptom | Root cause |
|---------|------------|
| No followers | Silent likes only — **zero public thread presence** until this patch |
| No likes | Low impressions + **generic/spammy recent timeline** (ticker bots, placeholder threads) |
| No site signups | Footer went **Whop-only** — no `blackouttrades.com` funnel; X traffic never hits marketing site |
| Flat reach | Legacy **@tag spam + broken threads** (`flip —, put —`) train algorithm to suppress us |

## What was working

- Crons: `x-autopost`, `x-growth`, `x-replies`, `x-analytics` on EventBridge
- Rate budget (no 429s)
- New desk voice pipeline (human hooks, live desk card PNG, dedup guards)
- Mention reply AI when @BlackOutTrade is tagged

## What was broken (P0)

1. **`x-growth` only liked silently** — FinTwit never saw us; `pickEngagementReply()` existed but was **never called**
2. **Showcase / agent posts** flooded timeline with generic ticker copy (NVDA/AMD/MSFT) — **no questions, no images in analytics sample**
3. **Placeholder thread** (`Live read: flip —, put —`) — credibility killer; now blocked in `x-post-guard`
4. **Conversion link** pointed at Whop checkout only — bypasses product marketing + Clerk sign-up path
5. **Claude draft often falls back** in prod (`draftBody: "(fallback)"`) — still OK copy but check `ANTHROPIC_API_KEY` / AI kill-switch

## P0 fixes (this PR)

| Fix | File |
|-----|------|
| Public FinTwit replies (1/cron run) | `src/lib/x-engage-engine.ts` |
| Footer → `blackouttrades.com/pricing?utm_*` | `src/lib/x-whop-link.ts` |
| Block + cleanup low-quality posts | `x-post-guard.ts`, `scripts/x-cleanup-low-quality.mjs` |
| Showcase copy: question + site link | `scripts/x-showcase-post.mjs` |
| Audit command | `npm run x-marketing:audit` |

## Manual ops (run now)

```bash
# Audit snapshot
npm run x-marketing:audit

# Preview deletions
node scripts/x-cleanup-low-quality.mjs --dry
node scripts/x-cleanup-low-quality.mjs

# Manual momentum (likes/follows — higher caps)
npm run x-marketing:run engage

# Quality showcase (screenshots + collage)
node scripts/x-showcase-post.mjs --ticker SPX --dry
```

## KPI targets (30 days)

| Metric | Now | Target |
|--------|-----|--------|
| Avg impressions/post | ~20 | **500+** |
| Avg likes/post | ~0.5 | **5+** |
| Profile replies/week | ~0 | **20+** |
| `utm_source=x` site sessions | unknown | Track in analytics |

## Still needed (P1)

- Admin dashboard tile for `x_marketing_analytics_*` in platform_meta
- CI workflow for `validate:x-marketing` on `main`
- A/B: desk card vs module collage posts
- Whop webhook ↔ `utm_campaign` join for true X → paid attribution
