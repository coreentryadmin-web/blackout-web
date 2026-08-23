# FULL PRODUCT CERTIFICATION — SEO, SEARCH & AUTHORITY

Ordered directly by the user, relayed by the coordinator, adapted to your lane's actual shape —
you're not a trading desk, so treat "product" as the public marketing site's search-facing surface,
not panels/charts. Do not assume anything is complete or correct because a PR merged or CI is green.

## 1. Inventory everything
Every indexed/indexable page, every piece of structured data (JSON-LD types, OG tags), every meta
title/description, every internal link, every image alt text, every sitemap entry, every robots
directive, every redirect. Build this as a real list, not a description of the categories.

## 2. Validate every number and claim
Every ranking/traffic/CWV number you report: where does it come from (GSC service account,
PageSpeed, your own crawler), how fresh, can it be independently re-pulled and does it match. Every
marketing claim on public pages ("X% win rate", testimonials, feature claims) — is it current,
sourced, and not contradicted by what the product actually does today (a stale claim is a
correctness bug, not just a copy problem).

## 3. Validate every label
Does a page's title/meta actually describe what's on it? Does structured data claim a type the
content doesn't support? Does a claimed statistic still hold given the product may have changed
since it was written?

## 4. Validate every page/component
For each indexable page: why does it exist, what should search traffic land on it looking for, does
it deliver that, is metadata/schema correct, is it fast (re-run `cls-measure.cjs` on every page, not
just the homepage — #2453 was desktop-only and easy to miss).

## 5. Test every interaction
Crawl the site as Google would (robots.txt, sitemap.xml, follow internal links), and as a human
visitor would (via `proxy-browser.cjs`, cache-purged first per the Cloudflare edge-cache trap already
documented). Confirm signed-in vs anonymous chrome is actually correct post-#2358/#2387's mini-panel
changes, and that the `__session` cookie-bypass on edge-cached HTML still works.

## 6. Validate the logic
Crawlability rules, redirect logic, sitemap generation, structured-data generation code — trace it,
don't just spot-check output.

## 7. Audit the architecture
Cloudflare cache rules (hand-made in the dashboard, not terraform — still true?), CWV pipeline,
build-time vs request-time generation of SEO surfaces.

## 8. Performance certification
Measure actual CWV (LCP/CLS/INP) per page, not assumed. `cls-measure.cjs` is your instrument —
extend it to every page rather than just homepage/pricing.

## 9. Product & UX review
Think like an organic visitor landing from a search result — is the page they land on immediately
useful, does it make the case to sign up, is it fast, is it not confusing about auth state.

## 10. Find new features / opportunities
USER PROBLEM, PROPOSED CAPABILITY, WHY EXISTING PAGES DON'T SOLVE IT, DATA REQUIRED, EXPECTED VALUE
(traffic/conversion), COMPLEXITY, RISK, HOW MEASURED. Classify P0/P1/P2/P3.

## 11. Competitive review
What do the best trading-intelligence/fintech marketing sites do for SEO that BLACKOUT doesn't?
What's a content/backlink opportunity unique to BLACKOUT's actual data (a public gamma snapshot, a
public track record) that a generic competitor can't replicate?

## 12. Find what wasn't asked about
What haven't you crawled? What would an SEO consultant flag that this checklist doesn't cover? What
page exists that shouldn't be indexed, or should be indexed and isn't?

## 13. Evidence — certification matrix
Commit `docs/audit/SEO-CERTIFICATION.md`: COMPONENT | FIELD/CLAIM | SOURCE | VALIDATION PERFORMED |
RESULT | ISSUE | SEVERITY | ACTION | EVIDENCE | STATUS (NOT TESTED/TESTING/FAILED/FIXING/DEPLOYED/
LIVE VERIFIED). Nothing is LIVE VERIFIED without production evidence.

## Reporting back
Every real defect gets the standard fix/branch/test/findings-staging/PR treatment per CLAUDE.md —
P0s first (you already have #2453's CLS regression flagged as land-first — confirm it actually
landed and re-measure). The coordinator pulls status on its own cycle — front-load anything P0 into
a PR. No permanent DONE.
