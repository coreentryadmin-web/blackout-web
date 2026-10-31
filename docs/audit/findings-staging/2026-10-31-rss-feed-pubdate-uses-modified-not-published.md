> **kind:** `FINDING`

## `/feed.xml` RSS `<item><pubDate>` used each article's last-EDITED date instead of its original publish date — FIXED

| | |
|---|---|
| **Severity** | P3 (SEO/GEO surface defect — no financial-correctness impact, but misrepresents content age to every RSS reader/aggregator and any AI crawler that reads feed freshness as a publish signal) |
| **Surface** | `src/lib/seo/sitemap-dates.ts` (`feedPubDateForArticle`) and its one caller, `src/app/feed.xml/route.ts` |
| **Status** | FIXED |

### Root cause

`feedPubDateForArticle(slug)` builds the RSS 2.0 `<item><pubDate>` for every `/learn/*` article in
the site's `/feed.xml` feed. Per the RSS 2.0 spec, `<pubDate>` states **when the item was
published**. The function instead read each article's `dateModified` field:

```ts
export function feedPubDateForArticle(slug: string): string {
  if (isLearnGuideSlug(slug)) {
    return new Date(`${GUIDE_SEO[slug].dateModified}T12:00:00Z`).toUTCString();
  }
  return new Date(`${getArticleDates(slug).dateModified}T12:00:00Z`).toUTCString();
}
```

Both `GUIDE_SEO` (`src/lib/learn/guide-seo.ts`) and `ARTICLE_DATES`
(`src/lib/learn/article-dates.ts`, git-history-derived) already carry a genuinely distinct
`datePublished` alongside `dateModified` — and the per-article page's own JSON-LD structured data
(`src/app/(marketing)/learn/[slug]/page.tsx`) correctly uses both fields for their respective
schema.org properties. The RSS feed was the one surface that collapsed the two into one, using only
the edit date.

Because every content fix bumps `dateModified` (`scripts/seo/generate-article-dates.mjs` regenerates
it from the latest git-blame on the article's block), this meant a routine copy edit on a
months-old, already-published article silently moved its RSS `<pubDate>` forward. Measured against
the real generated data on `main`: `dealer-gamma-options-flow-guide` was published 2026-07-31 but
last edited 2026-09-01 — a 32-day jump the feed reported as the item's publish date — and the
curriculum guide `getting-started` (published 2026-01-15, last edited 2026-08-01) shows the same
198-day gap. This is not a rounding difference; it is the wrong fact entirely, on every item in the
feed whose `datePublished` and `dateModified` differ (which `git log --diff-filter=A` vs the full
history makes true for most real articles that have ever been touched post-launch).

### Evidence

New tests in `src/lib/seo/sitemap-dates.test.ts`, asserting against the real, live data (not
literals, to avoid the exact staleness trap this file's own existing tests already guard against):

```
feedPubDateForArticle
  ✓ uses datePublished, not dateModified, for a regular learn article
  ✓ uses datePublished, not dateModified, for a curriculum guide slug
feedLastModifiedForArticle
  ✓ uses dateModified for a regular learn article
  ✓ uses dateModified for a curriculum guide slug
```

RED→GREEN confirmed via `git stash` of just the two source files (`sitemap-dates.ts`,
`feed.xml/route.ts`), keeping the new/edited test file in place:

- **Before the fix**: 4/7 tests in the file fail — the two `feedPubDateForArticle` tests fail with
  `actual: 'Tue, 01 Sep 2026 12:00:00 GMT'` where `'Fri, 31 Jul 2026 12:00:00 GMT'` was expected
  (the dateModified value leaking into pubDate, exactly the bug), and the two
  `feedLastModifiedForArticle` tests fail with `TypeError: ... is not a function` since that
  function didn't exist yet pre-fix.
- **After the fix**: 7/7 pass.

Full repo `tsc --noEmit` clean on Node 20. Full `npm test` run on Node 20 (see PR for result).

### Blast radius

`feedPubDateForArticle` had exactly one caller, `src/app/feed.xml/route.ts`, used in two places:
the per-item `<pubDate>` (the actual bug — every item in the feed) and the channel-level
`<lastBuildDate>` (computed as `Math.max` across all items' dates). No other file imports this
function (verified by grep). No database writes, no other product surface, no member-facing page —
this is purely the public RSS feed's own XML output.

### Fix rationale

The channel-level `<lastBuildDate>` legitimately wants "most recent edit across the whole feed" —
the rendered feed content really did change on that date, even for an already-published article —
so that half of the original behavior was correct and is preserved, just under its own clearly-named
function (`feedLastModifiedForArticle`, added to `sitemap-dates.ts`). Only the per-item `<pubDate>`
needed to change, to `datePublished`. Splitting into two functions (rather than, say, overloading
one function with a `field` parameter) keeps each call site self-documenting about which semantic
question it's actually asking, and keeps the existing `GUIDE_SEO`/`ARTICLE_DATES` data model
completely untouched — this is purely a read-side fix.

### Tests

`src/lib/seo/sitemap-dates.test.ts` — 4 new tests (2 for `feedPubDateForArticle`'s corrected
behavior, 2 pinning `feedLastModifiedForArticle`'s unchanged `dateModified` behavior so the two
functions don't silently converge on the same field again), all passing post-fix. `npx tsc --noEmit`
clean repo-wide.
