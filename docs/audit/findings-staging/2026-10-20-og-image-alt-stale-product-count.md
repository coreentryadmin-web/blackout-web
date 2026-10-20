> **kind:** FINDING

## Root layout's default OG image alt text hand-typed a stale product count — FIXED

| **Status** | Fixed |
|---|---|

**Found:** 2026-10-20, DISCOVERY-lane SEO/GEO sweep (`docs/audit/FULL-LIFECYCLE SCOPE EXPANSION`
mandate), via a background Explore-agent audit of structured data / meta-tag completeness on
marketing surfaces.

**Root cause:** `src/app/layout.tsx`'s root `metadata.openGraph.images[0].alt` was the literal
string `"BlackOut — 6 live engines, institutional-grade trading desk"`. The product catalog grew
to 7 live products (`manifestProductCount()` in `src/lib/marketing/product-manifest.ts`, confirmed
`7` by the existing `product-manifest-consistency.test.ts` assertion) a full product-launch cycle
ago — every other public surface (homepage, pricing, FAQ, `/vs/others`, welcome-sequence emails)
already derives its product count from `manifestProductCount()`/`manifestProductCountWord()`
specifically so this class of drift can't happen, but this one literal in the root layout was never
migrated and wasn't covered by `product-manifest-consistency.test.ts`'s `PUBLIC_SURFACES` scan
(which doesn't include `src/app/layout.tsx`). This is the exact same bug class `FINDINGS.md` already
documents for the Pricing page's SEO description (fixed 2026-09-04, driven off
`manifestProductCountWord()`) — that fix did not reach this second, independent hardcoded literal.

**Live impact:** any route that doesn't override `openGraph.images` (noindex/app pages, raw link
shares, and the root metadata's own fallback) serves an OG image whose alt text claims "6 live
engines" while the site's own manifest, homepage, pricing page, FAQ, and welcome emails all say 7 —
a product-count contradiction visible to any crawler, social-preview renderer, or AI answer engine
reading the page's metadata. Low severity (alt text, not visible UI copy) but a genuine, user-facing
drift bug, not a cosmetic nit.

**Fix:** `src/app/layout.tsx` now imports `manifestProductCount` and builds the alt text as a
template literal (`` `BlackOut — ${manifestProductCount()} live engines, institutional-grade
trading desk` ``), matching the Pricing-page fix's pattern exactly.

**Blast radius:** single call site — `layout.tsx`'s OG image metadata is root-level and not
duplicated elsewhere; no other file carried this same literal (confirmed by grep for "6 live
engines" repo-wide, zero other hits).

**Test:** `src/lib/marketing/product-manifest-consistency.test.ts` — new regression test asserting
the root layout's OG alt text derives from `manifestProductCount()` and carries no hardcoded
stale-count digit. RED→GREEN proven via `git stash` on `layout.tsx` alone (fails without the fix,
1/17 failing; passes with it, 17/17). Full-file test run and repo-wide `npx tsc --noEmit` both
clean.
