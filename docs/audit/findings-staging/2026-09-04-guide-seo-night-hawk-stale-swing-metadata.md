## 2026-09-04 — [P3, SEO/IA] Night Hawk's Learn-chapter SEO metadata still said "Swing Trading Setups" — FIXED

> **kind:** `FINDING`

| | |
|---|---|
| **Severity** | P3 — SEO/onboarding copy, not a data-correctness bug. Highest-visibility instance of a recurring class: this is the literal `<title>` tag and SERP snippet a prospective member sees in Google results before ever loading the page. |
| **Found by** | Coordinator sweep, while gathering context for the related Academy IA fix (same-day user report on Night Hawk positioning) |
| **Status** | FIXED |

### Root cause

`GUIDE_SEO["night-hawk"]` (`src/lib/learn/guide-seo.ts`) — the SEO metadata for the `/learn/night-hawk`
chapter route — read:

> `metaTitle: "Night Hawk Guide — Swing Trading Setups Explained"`
> `metaDescription: "Learn how Night Hawk grades swing trading setups and runs its evening
> scanner to surface the next day's best opportunities after the market closes."`

This is a **third independent copy** of the exact same stale "evening/swing-only" framing already
found and fixed today in two other places:
- `PRODUCT_MANIFEST.hawk` (`product-manifest.ts`) — fixed previously, and that file carries a
  standing comment: *"Never describe Night Hawk as swing-only."*
- `LEARN_NAV`'s `night-hawk` descriptor (`nav.ts`) — fixed earlier today (PR #3784).

`GUIDE_SEO` is a third, separate hand-authored object with no shared source with either of the
other two — so both prior fixes left this one untouched. It's arguably the most consequential
copy of the three: it is what search engines index and what a prospective member reads in a
Google result snippet, before the homepage's correct "not a swing-only product" positioning is
ever seen.

### Evidence

RED (`git stash` on `guide-seo.ts` only, test kept applied): 1/2 tests in `guide-seo.test.ts`
fail — the new test correctly flags the "Swing Trading Setups" title. GREEN after restoring: 4/4
pass across `guide-seo.test.ts` + `metatitle-length.test.ts`. `npx tsc --noEmit` clean. Re-ran
`CourseJsonLd.ssr.test.ts` and `learn-slug-404.test.ts` (both consume `GUIDE_SEO`) — 3/3 pass, no
regression.

### Fix

Updated `metaTitle` to "Night Hawk Guide — 0DTE Command & Evening Edition" (49 chars, within the
60-char SERP-truncation guard) and `metaDescription` to "Learn how Night Hawk works: 0DTE Command
scans the market intraday with graded plays, then Evening Edition preps the next session after the
close." (146 chars, within the 160-char guard) — matching the same 0DTE-Command-first, Evening-
Edition-secondary framing already established and tested for `PRODUCT_MANIFEST.hawk` and
`LEARN_NAV`. Bumped `dateModified` to today. Added a regression test to `guide-seo.test.ts`
asserting the night-hawk entry doesn't match "swing trading"/"evening scanner" and does mention
"0DTE".

### Blast radius

Two string fields in one `GUIDE_SEO` entry plus one new test. `GUIDE_SEO` feeds the `/learn/[slug]`
route's page metadata and the Course JSON-LD structured-data chapter list — both inherit the
correction automatically. No other guide's SEO entry was touched.

### Fix rationale

Match the exact framing already established and tested twice today (manifest, then nav) rather
than invent new copy a third time, keeping all three Night Hawk descriptions substantively
consistent even though they remain three separate hand-authored strings with no shared source.

### What was deliberately left unchanged

Did not centralize `GUIDE_SEO`, `LEARN_NAV`, and `PRODUCT_MANIFEST` into one shared source for
Night Hawk's positioning — as noted in the PR #3784 finding, that is a real architectural change
(three different shapes/consumers: SEO metadata needs `metaTitle`/`metaDescription` length
constraints the other two don't have) worth scoping as its own follow-up rather than folding into
a third consecutive P3 copy fix. Given three independent instances of the identical staleness
found in one day across three unrelated files, that follow-up is now a stronger candidate than it
was after the first fix alone — noted here for whoever picks it up next.
