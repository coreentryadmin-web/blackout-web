> **kind:** FINDING

## `/learn/[slug]` article branch rendered `FAQPageJsonLd` with no empty-list guard — FIXED

| **Status** | Fixed |
|---|---|

**Found:** 2026-10-20, DISCOVERY-lane SEO/GEO sweep (`docs/audit/FULL-LIFECYCLE SCOPE EXPANSION`
mandate), via a background Explore-agent audit of structured-data completeness on marketing pages.

**Root cause:** `src/app/(marketing)/learn/[slug]/page.tsx`'s article branch rendered
`<FAQPageJsonLd items={getArticleFaqs(article.slug)} />` unconditionally. The sibling guide branch
36 lines above it correctly guards the identical pattern: `{faqs.length > 0 && <FAQPageJsonLd
items={faqs} />}`. `getArticleFaqs()` (`src/lib/learn/article-faqs.ts`) falls through to `[]` for
any slug not present in `ARTICLE_FAQS` — today all 52 current article slugs have an entry (verified
by diffing `LEARN_ARTICLES` slugs against `ARTICLE_FAQS` keys, and independently guarded by
`article-faqs.test.ts`'s own "every learn article has an FAQ set" assertion), so the bug wasn't
live yet. The next article added without a matching `ARTICLE_FAQS` entry would have silently
emitted `"mainEntity": []` on its FAQPage JSON-LD, which is invalid per Google's structured-data
guidelines (a FAQPage requires at least one Question) — likely a Rich Results validation error on
that page.

**Fix:** added the identical `articleFaqs.length > 0 &&` guard the guide branch already uses,
hoisting `const articleFaqs = getArticleFaqs(article.slug);` above the JSX the same way the guide
branch hoists `const faqs = guideFaqs(guide.sections);`.

**Blast radius:** single call site — the article branch is the only other place
`getArticleFaqs`/`FAQPageJsonLd` are paired; the guide branch's own pairing was already correctly
guarded and untouched.

**Test:** `src/app/learn-slug-404.test.ts` — new regression test asserting the article branch's
source carries the `articleFaqs.length > 0 && <FAQPageJsonLd` guard (same source-inspection style
this file's own existing `dynamicParams`/`generateStaticParams` tests use, since the route is an
async server component with heavy content-view dependencies that make a full render-based test
disproportionate to the fix). RED→GREEN proven via `git stash` on the page file alone (fails
without the guard, 1/3 failing in this file; passes with it, full file + `article-faqs.test.ts`
green, 6/6). Repo-wide `npx tsc --noEmit` clean.
