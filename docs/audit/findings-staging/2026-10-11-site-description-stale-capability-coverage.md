## SITE.description — the root meta description, every JSON-LD block, the RSS feed, and llms.txt's summary — never mentioned catalyst intelligence or AI chat — FIXED

> **kind:** `FINDING`

| | |
|---|---|
| **Area** | SEO/GEO — `src/lib/site.ts` |
| **Severity** | P3 (SEO/GEO content-completeness, no functional impact) |
| **Status** | FIXED |

### Root cause

`SITE.description` is a single string reused across a surprisingly wide surface:
`src/app/layout.tsx:83` (the root `<meta name="description">` — inherited by every page without
its own override), `src/components/seo/JsonLd.tsx` (×3 — `OrganizationJsonLd`,
`WebSiteJsonLd`, `SoftwareApplicationJsonLd`), `src/app/feed.xml/route.ts` (RSS description), and
`src/app/llms.txt/route.ts` (the summary line AI answer engines read first). It named only 4
capability areas — options flow, dealer positioning, SPX structure, Night Hawk 0DTE — and never
mentioned catalyst intelligence (Meridian) or the AI chat layer (Largo) at all. Flagged for
awareness, but deliberately NOT fixed, by the earlier SEO/GEO background sweep this session (it
asserts no explicit product count, so it isn't factually false the way the FAQ/email bugs were —
just incomplete next to the current 7-product lineup) — picked up now as a separate, deliberate
decision rather than a drive-by edit, per that sweep's own recommendation.

### Evidence

`grep -rn "SITE\.description"` confirmed all 5 real consumers listed above (plus the existing
`llms.txt/route.test.ts`, which already asserts `llms.txt` quotes `SITE.description` verbatim —
proving it's the single real source, not a duplicate). Direct read of `src/lib/site.ts:7-8`
confirmed the exact pre-fix text.

### Blast radius

One string, one file — but 5 real consumers, all fixed by the same single-line change. No other
SEO/GEO surface carries this specific staleness; the earlier sweep already checked `llms.txt`,
structured-data builders, `sitemap.ts`, `robots.ts`, and manifest-count usage on
home/pricing/vs-others/FAQ and found everything else either manifest-derived or static.

### Fix rationale

Rewrote the description to cover capability areas (options flow, dealer positioning, SPX/0DTE
structure, catalyst intelligence, AI-grounded chat) rather than naming specific products — same
philosophy as the FAQ fix earlier this session (`#5866`): a description that names products by
name goes stale at the next product launch; one that names capabilities doesn't need to change
when a product is renamed or a new one ships with an existing capability shape. Kept it under
the ~160-char SERP truncation ceiling (146 chars) — this field sits outside
`marketing-meta-description-length.test.ts`'s scope (that guard only covers routes under
`(marketing)` using `publicPageMetadata()`; this is set directly in `layout.tsx`).

### Test

Extended the existing `src/lib/site.test.ts` (had 1 pre-existing test, the Discord-invite
single-source-of-truth guard) with 2 new tests: `SITE.description` mentions flow, dealer
positioning, SPX, 0DTE, catalyst, and AI (keyword coverage, not exact product names — so this
guard itself can't go stale the same way); and it stays within the 160-char SERP ceiling. Proven
RED→GREEN via `git stash` against the pre-fix string — the coverage test failed on the old text
(missing catalyst/AI), passed once restored. Full `src/lib/site.test.ts` +
`llms.txt/route.test.ts` + `marketing-meta-description-length.test.ts` (8/8) and
`tsc --noEmit` clean.
