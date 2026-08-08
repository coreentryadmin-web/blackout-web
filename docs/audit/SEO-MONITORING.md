# SEO Ongoing Monitoring

The 2026-08-08 SEO sweep (see `docs/audit/FINDINGS.md`) fixed every bug the audit passes could
find — the audit-able technical SEO surface was clean and shipped. What that sweep could **not**
cover, because it isn't a bug to find and fix but ongoing state to watch, are two things:
Core Web Vitals drifting over time, and Search Console index coverage / query performance. These
two scripts turn that into a recurring, evidence-based check instead of relying on the next
one-off audit to catch a regression.

## `scripts/audit/seo-cwv-monitor.mjs` (`npm run validate:seo-cwv`)

Runs the real **PageSpeed Insights v5 REST API** (not local Lighthouse/Playwright — this
sandbox's Chromium can only reach the network through the manual proxy tunnel documented in
`LIVE-UI-CONNECTION.md`, and PSI's plain HTTPS GET sidesteps that entirely) against 5 key public
URLs (homepage, pricing, learn hub, one representative `/learn` article, the free gamma-snapshot
tool), pulls Performance/Accessibility/Best-Practices/SEO scores plus LCP/CLS/TBT/FCP/Speed
Index, and compares against a committed baseline (`docs/audit/cwv-baseline.json`). Flags a
regression when a category score drops more than 0.03 or a timing metric increases more than
15% versus the baseline. Exits non-zero on any regression. Pure comparison logic lives in
`scripts/audit/lib/cwv-regression-eval.mjs` (unit-tested, `npx tsx --test`).

`--write-baseline` overwrites the baseline with the current run's numbers — use once,
deliberately, after a real improvement lands and you want the new numbers to be the floor. Never
run it reflexively to silence a regression; that defeats the point of having a baseline.

Baseline captured 2026-08-08 (mobile): homepage perf 0.72, pricing 0.76, learn hub 0.69, learn
guide 0.60, gamma-snapshot 0.49 (highest TBT — the live GEX widget's client JS). Accessibility
1.0 and best-practices 1.0 across all 5, matching the color-contrast and hardening fixes from
the same sweep. `gamma-snapshot` scores `seo: 0.91` in Lighthouse specifically because it's
`force-dynamic` — `next.config.mjs`'s own comment documents that Next 15.2+ streams metadata to
`<body>` for any crawler UA not in `htmlLimitedBots` (Googlebot etc. ARE covered; Lighthouse's
synthetic crawler isn't, and doesn't need to be — it's not a real search engine). Confirmed by
curling the page with a generic UA and finding `<meta name="description">` after `</head>`,
while the same check on the homepage (not `force-dynamic`) finds it inside `<head>`. Not a bug —
don't "fix" it by adding Lighthouse's UA to `htmlLimitedBots`; that allowlist is specifically for
crawlers that don't execute JS, and Lighthouse does.

## `scripts/audit/seo-search-console-monitor.mjs` (`npm run validate:seo-search-console`)

Two parts, both **read-only** (`webmasters.readonly` scope):

1. **Index coverage sweep** — calls the URL Inspection API once per canonical URL from
   `publicSitemapEntries()` (`src/lib/seo/sitemap-urls.ts` — the same source of truth
   `sitemap.xml` uses, so this can never drift from what's actually submitted), rate-limited to
   ~1 req/sec per Search Console's own limit (~66 URLs ≈ 75s — use `--skip-inspect` for a faster
   query-only check). Flags any canonical URL whose `coverageState` isn't
   `"Submitted and indexed"`.
2. **Search performance** — `searchAnalytics.query` by `query` and by `page`, last 28 days, so a
   human (or the next scheduled run) can see real impressions/clicks/position without opening
   the GSC UI.

Exits non-zero if any canonical URL is not indexed.

First live run (2026-08-08) found 6 pages the sweep's own new/renamed content had left
un-indexed (`/about`, `/learn/glossary`, `/learn/implied-volatility-explained`,
`/learn/spx-slayer-dashboard-guide`, `/learn/thermal-heatmap-reading-guide`,
`/learn/largo-ai-market-analysis-tips`) — resubmitted via the Google Indexing API immediately
(all 6 accepted, `200`). Also surfaced `staging.blackouttrades.com/terminal` still carrying
impressions/clicks in the 28-day window — verified `staging.blackouttrades.com` returns `HTTP
530` (Cloudflare origin-DNS error), confirming CLAUDE.md's note that staging was fully
decommissioned 2026-07-25; this is residual GSC history within the lookback window, not a live
issue, and will fall out of the index on its own as Google recrawls and gets errors.

At this stage (site is ~2 weeks old per `git log`), query-level data is thin — most tracked
queries sit at position 40-85 with 1-3 impressions and 0 clicks; the one exception is "is 0dte
gambling" at position 11.5 / 4 impressions. This is normal for a young site and not yet a
statistically meaningful signal for content-gap analysis — that needs another few weeks of
indexing/ranking time to accumulate before query data can drive real content decisions, rather
than acting on noise.

## Secrets checklist (literal values, not `${{shared.*}}` refs)

| Env var | Purpose | Notes |
|---|---|---|
| `PAGESPEED_API_KEY` | PageSpeed Insights v5 quota | Google Cloud API key, PageSpeed Insights API enabled |
| `GSC_SERVICE_ACCOUNT_JSON` | Search Console auth | the **full service-account JSON** as a literal string (not a file path) — the service account must be added as a user in Search Console → Settings → Users and permissions for the `blackouttrades.com` domain property |

## Scheduled trigger (weekly, Monday)

Configure a **Claude Code scheduled trigger** on this repo, weekly Monday ~14:00 UTC (after the
weekend's crawl activity has settled). Use this prompt:

> Run the weekly SEO monitoring pass for blackouttrades.com.
> 1. Confirm env has literal `PAGESPEED_API_KEY` and `GSC_SERVICE_ACCOUNT_JSON` (full service-account JSON, not a `${{...}}` placeholder or file path). If either is missing/unresolved, stop and report it.
> 2. Run `npm run validate:seo-cwv` and `npm run validate:seo-search-console`.
> 3. For any Core Web Vitals regression, read the page/component that changed since the last baseline and identify root cause before touching the baseline — do not `--write-baseline` to silence a real regression.
> 4. For any un-indexed canonical URL, resubmit via the Google Indexing API (same auth, `indexing` scope) and note it.
> 5. Read `docs/audit/FINDINGS.md`'s `## How to read this file` section for the current entry format (every entry needs a `> **kind:** \`FINDING\`` tag) before logging anything new.
> 6. Reply with a concise pass/fail summary — what regressed, what got resubmitted, what's still fine.

### Operational caveats
- **Rate limits**: URL Inspection is ~1 req/sec; the full 66-URL sweep takes ~75s. Search
  Console's daily URL Inspection quota is limited — don't run the full sweep more than a few
  times a day.
- **Ephemeral sessions**: each triggered run starts clean. `docs/audit/cwv-baseline.json` is
  committed, so it persists across runs; nothing else does unless committed.
- **Do not commit `GSC_SERVICE_ACCOUNT_JSON`'s value anywhere** — env only, exactly like
  `POLYGON_API_KEY`/`UW_API_KEY`/`CLERK_SECRET_KEY` elsewhere in this repo's audit toolkit.
