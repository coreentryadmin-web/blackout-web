## 2026-10-12 — [FINDING, P4 SEO/tooling] Dead code: `academyShareUrl`/`ACADEMY_X_POSTS`/`formatXPost` (zero real callers) — FIXED
> **kind:** `FINDING`

| **Area** | **Severity** | **Status** |
|---|---|---|
| SEO / Academy social-sharing tooling | P4 — dead code, no runtime impact | FIXED |

**What's wrong.** `src/lib/seo/academy-share.ts` exported an operator-facing "ready-to-post X
copy" generator for Academy articles: `academyShareUrl()` (builds a UTM-tagged share link),
`ACADEMY_X_POSTS` (7 hand-written post drafts for specific `/learn/*` articles), and
`formatXPost()` (combines a draft's text with its share URL). Added 2026-08-03 (`#1539`, a bulk
SEO PR covering "homepage ISR, OG compression, 3 Academy articles + social UTM"). Repo-wide grep
(`academyShareUrl|formatXPost|ACADEMY_X_POSTS`, across `.ts`/`.tsx`/`.mjs`/`.cjs`, excluding
`node_modules`) found zero callers anywhere — including scripts, admin pages, and slash commands —
outside the file's own test. The posting workflow this was built to serve (an operator tool, a
script, or an admin-page button to copy/post one of the 7 drafts) was never built; the generator
has sat inert for over two months.

**Fix.** Deleted `src/lib/seo/academy-share.ts` and its test (`academy-share.test.ts`, which only
tested the now-deleted functions). `tsc --noEmit` clean — confirms no other file imports from this
module.

**Why delete rather than wire up.** Building the missing posting workflow (a script, an admin
button) is a feature decision, not a bug fix — it needs a call on where/how an operator would
actually use it (a one-off script? a recurring admin-page action? which 7 articles, and should the
list grow?), none of which this sweep has standing to decide unilaterally. Same judgment already
applied twice this session to the identically-shaped `learnIndexNowUrls` and
`formatFlowStrikeStacksSection`/`flowStackSignature` dead-code findings (both 2026-09-06,
re-verified still absent earlier this cycle) — delete confirmed-dead code, write up (don't build)
anything requiring a product decision.

**Blast radius.** `src/lib/seo/academy-share.ts` + its test only. `appendUtmParams`/
`AttributionParams` (imported from `@/lib/analytics/utm`, not exported by this file) are untouched
and have other real callers.

Found via a background Explore-agent sweep of SEO structured-data/sitemap plumbing,
independently re-verified (repo-wide grep across all four relevant extensions, confirmed only the
definition + its own test matched) before deleting.
