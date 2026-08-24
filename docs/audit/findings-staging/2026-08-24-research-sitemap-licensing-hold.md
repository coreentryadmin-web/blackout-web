# 2026-08-24 — Research gamma-levels submitted in sitemap before licensing clearance — FIXED

> **kind:** FINDING

## Summary

`/research/gamma-levels/*` programmatic pages (56 tickers + hub) were added to `sitemap.xml` after the
2026-08-21 SEO baseline (72 URLs → 128). They publish derived dealer-gamma statistics from vendor
recordings — exactly the category blocked in `docs/agents/SEO-SEARCH-AUTHORITY.md` until the operator
answers the open Polygon/UW redistribution question.

Deep crawl (`seo-deep-crawl.mjs`) flagged 26 issues: many ticker URLs returned `200` with
`noindex` and empty `<title>` (thin/unpublishable sessions), while the hub and publishable tickers
were fully indexable with live derived level tables in the HTML.

## Status

| **Status** | FIXED in PR — research routes noindex via layout; all `/research/gamma-levels/*` paths
removed from `publicSitemapEntries()` until licensing clears. `/tools/gamma-snapshot` unchanged
(pre-existing; escalated in baseline §6). |

## Fix

- `src/app/(marketing)/research/layout.tsx` — `robots: noindex,nofollow` on the whole research tree.
- `src/lib/seo/sitemap-urls.ts` — omit research entries from sitemap + IndexNow URL set.
- `next.config.mjs` — `/favicon.ico` → `/icon-192.png` permanent redirect (baseline P3-1).
