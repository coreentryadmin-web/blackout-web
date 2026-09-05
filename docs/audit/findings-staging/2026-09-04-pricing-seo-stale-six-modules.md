## 2026-09-04 — [P3, technical-SEO/conversion] Pricing's SEO description still said "six trading modules" after the catalog grew to seven — FIXED

> **kind:** `FINDING`

| | |
|---|---|
| **Severity** | P3 — acquisition-layer staleness, not a data-correctness bug. Users arriving from Google/Bing could see an outdated product count before ever reaching the (already-correct) rendered Pricing page; search/answer engines could ingest the six-product description as the canonical commercial summary. |
| **Found by** | User report (operator) |
| **Status** | FIXED |

### Root cause

`src/app/(marketing)/pricing/page.tsx` hardcoded the same stale sentence in two places:
`publicPageMetadata()`'s `description` argument (line 11 — drives `<meta name="description">`,
canonical-adjacent title/description, **and** OpenGraph/Twitter title+description+OG-image text,
since `publicPageMetadata()` builds all of those from the same two strings) and `WebPageJsonLd`'s
`description` prop (line 22 — the JSON-LD structured-data copy). Both read: *"Get BlackOut's SPX
0DTE desk from \$49/mo, or all six trading modules plus Discord from \$199/mo."*

The visible, rendered Pricing page content had already been updated to describe all 7 products
(confirmed: `SoftwareApplicationJsonLd`'s `featureList` already derives from
`manifestSchemaFeatureList()`, fully dynamic and already correct) — only these two hand-typed SEO
strings were never updated when the catalog grew from six products to seven. This is the same
"hand-duplicated copy with no link back to the manifest" pattern behind three other P3 findings
shipped today (Vector/Thermal guide, Meridian manifest, Night Hawk nav/SEO) — `BANNED_PUBLIC_MARKETING_PHRASES`
already banned "six modules" and "Six engines" from a prior pass, but not this exact phrase
variant ("six trading modules"), and `pricing/page.tsx` was never added to the `PUBLIC_SURFACES`
list that scan runs against.

### Evidence

`grep -rn "six trading module" src` (pre-fix) found exactly the two lines in `pricing/page.tsx`.
RED (`git stash` on `pricing/page.tsx` + `product-manifest.ts`, tests kept applied): 1/12 tests in
`product-manifest-consistency.test.ts` fail — the new test correctly flags the stale copy. GREEN
after restoring: 12/12 pass. Re-ran `products.test.ts` (`manifestModulesHeadline()` still returns
the exact pre-existing `"Seven products."` string — the refactor that introduced
`manifestProductCountWord()` did not change its behavior), `upsell-features.test.ts`,
`plan-matrix.test.ts`, `faq/content.test.ts`, `JsonLd.ssr.test.ts` — 35/35 pass total, no
regression. `npx tsc --noEmit` clean. `eslint` clean on every touched file.

### Fix

Added `manifestProductCountWord()` to `product-manifest.ts` — a small exported helper returning
the lowercase spelled-out word for the live product count ("seven"), falling back to the digit for
counts without a spelled-out mapping (5/6/7/8) so a future launch can't silently print
`"undefined"`. Refactored the pre-existing `manifestModulesHeadline()` to build its sentence from
this same helper (verified byte-identical output via the existing `products.test.ts` assertion —
no behavior change, pure DRY).

Rewrote `pricing/page.tsx`'s description to interpolate `manifestProductCountWord()` instead of a
hardcoded word — per the user's own recommendation, this can't go stale the same way again without
the manifest itself changing. Both the `publicPageMetadata()` call and the `WebPageJsonLd` call now
read from one shared `PRICING_DESCRIPTION` constant (previously two independently-typed copies of
the same string) so they can't drift from each other either.

Added `"six trading modules"` to `BANNED_PUBLIC_MARKETING_PHRASES` and `pricing/page.tsx` to the
`product-manifest-consistency.test.ts` `PUBLIC_SURFACES` scan list, plus a dedicated test asserting
the page's source references `manifestProductCountWord()` (not a literal count) and contains no
stray "six".

### Blast radius

Two files: `product-manifest.ts` (one new helper, one banned phrase, one refactored function with
verified-identical output) and `pricing/page.tsx` (one shared description constant replacing two
duplicated hardcoded strings). Because `publicPageMetadata()` builds `<title>`, `<meta
name="description">`, canonical URL, OpenGraph (title/description/url/image), and Twitter
(title/description/image) all from the same two arguments, this single fix corrects every one of
those surfaces at once — verified by reading `publicPageMetadata()`'s implementation directly
(`src/lib/page-metadata.ts`), not assumed.

### Fix rationale

Derive from the manifest rather than hand-type "seven" — the user's own recommendation, and
consistent with how every other product-count-dependent string in this codebase already works
(`manifestPremiumIncludes().length`, `manifestModulesHeadline()`, `manifestSchemaFeatureList()`).
A hardcoded "seven" would only move the staleness bug to the next product launch instead of fixing
its root cause (no link back to what actually ships).

### What was deliberately left unchanged

**Did not request a Search Console/Bing Webmaster Tools recrawl** — that's a live, post-deploy
operational action (the fix has to actually ship to production first), not something to do from a
PR. Noting it here so whoever validates this fix at the next market-open pass remembers the
verification step the user specifically asked for: confirm the *rendered* HTML (not just source)
carries the corrected description, then request a recrawl and verify the refreshed SERP snippet
once Google/Bing re-index. Did not audit every other marketing page for a similar hand-typed
product count beyond what `BANNED_PUBLIC_MARKETING_PHRASES` already covers (`about/page.tsx` was
already covered by an earlier fix today) — a broader page-by-page SEO metadata audit is a
reasonable next sweep but out of scope for this specific P3.
