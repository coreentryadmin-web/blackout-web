## 2026-09-05 — [FINDING, P4 GEO/SEO] `llms.txt` missing the `/methodology` page — FIXED

> **kind:** `FINDING`

| **Status** | FIXED in PR (this branch) |
|---|---|
| **Severity** | P4 — no functional break, but a GEO gap: `llms.txt` is the file this repo built specifically for AI-answer-engine crawlers (per CLAUDE.md's GEO mandate), and it was missing one of the highest-priority public pages |
| **Root cause** | `src/app/llms.txt/route.ts`'s hand-written "Product" link list and `src/lib/seo/sitemap-urls.ts`'s `marketing` array (used by `sitemap.xml`) are two independently maintained lists of the same canonical marketing pages. `/methodology` (`src/app/(marketing)/methodology/page.tsx`, sitemap priority 0.85 — higher than every marketing page except `/` and `/pricing`, `changeFrequency: "weekly"`) was added to the sitemap list but never added to `llms.txt`'s list, so it never appeared. `route.test.ts`'s own hand-listed path assertions had the identical gap baked in, so the drift wasn't caught by CI. |
| **Fix** | Added `/methodology` to `llms.txt`'s Product section (with a short description pulled from the page's own `PageHero` copy: "how BlackOut grades every setup... with live aggregate stats and no blended win rates") and to `route.test.ts`'s canonical-page assertion list. Verified every other page/link already referenced in `llms.txt` still resolves to a real route (`/vs/others`, `/why-blackout`, `/tools/gamma-snapshot`, `/about`, `/contact`, `/feed.xml`, `/sitemap.xml`) — no other gaps found on this pass. |
| **Blast radius** | `llms.txt` only. Did not touch `sitemap-urls.ts` or unify the two lists — that would pull in `/terms`/`/privacy`/etc. (present in the sitemap's `legal` array but deliberately not product-relevant for an AI-crawler content index) and is a larger behavior change than this fix warrants. |
| **Evidence** | `route.test.ts` — confirmed RED pre-fix (`git stash` route.ts only, keep the new test assertion: `not ok — missing link to /methodology`) → GREEN post-fix (4/4 pass). |
