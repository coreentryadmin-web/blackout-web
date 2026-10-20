## 2026-10-20 — [FINDING, P2 SEO/GEO] Night Hawk's public/AI-crawler copy omitted the shipped Swing Command tab everywhere — FIXED

> **kind:** FINDING

**Context.** DISCOVERY-lane SEO/GEO sweep (standing full-lifecycle scope-expansion mandate).
A background sweep agent checked `llms.txt`, `sitemap.ts`/`robots.ts`, JSON-LD coverage, and
meta description quality across the marketing site. Four of five categories checked clean
(verified by reading, not absence-checked); one genuine, well-corroborated defect found.

**Root cause.** `/nighthawk` shipped a third tab — **Swing Command** — alongside ZERO_DTE
(0DTE Command) and LEGACY (Evening Edition), confirmed live in
`src/features/nighthawk/command-deck/` (`SwingAnalyticsPanel.tsx`,
`SwingThesisHealthPanel.tsx`, `SwingLargoInsightsPanel.tsx`, `swing-section-groups.ts`, etc.)
and documented correctly in the deep Learn-guide body itself
(`src/lib/learn/guides/instruments/night-hawk.ts:11`: *"Route `/nighthawk` hosts three views
behind a single tab selector (ZERO_DTE / SWING / LEGACY)..."*). But every **summary/index
layer** that feeds SEO + GEO surfaces was never updated when Swing Command shipped and still
described Night Hawk as a two-part product:
1. `src/lib/marketing/product-manifest.ts`'s `hawk` entry — the canonical single source for
   pricing bullets, FAQ, structured data, and Academy cross-links (per the file's own header).
   `positioning`, `lifecycle`, `capabilities` (4 bullets), `faqAnswer`, and `planInclude` all
   omitted Swing. This feeds `SoftwareApplicationJsonLd`'s `featureList` via
   `manifestSchemaFeatureList()` — i.e. the pricing page's own schema.org markup described
   Night Hawk incompletely to every crawler/AI engine reading it.
2. `src/lib/learn/nav.ts`'s `LEARN_NAV` night-hawk entry — description omitted Swing. This
   array is consumed verbatim by `src/app/llms.txt/route.ts`, so the AI-crawler-facing
   `/llms.txt` file shipped the same gap.
3. `src/lib/learn/guide-seo.ts`'s `"night-hawk"` entry — `metaTitle`/`metaDescription` for the
   `/learn/night-hawk` page omitted Swing, even though that very page's own body (item 1 of
   the guide-chapter `night-hawk.ts` file above) already covers it — a direct
   meta-description-vs-page-content mismatch.

The same stale "(0DTE Command + Evening Edition)" phrase, copy-pasted, also appeared in three
more marketing/lifecycle-email surfaces sharing the identical root cause:
`src/components/landing/WhyBlackoutContent.tsx` (the `/why-blackout` tool list),
`src/lib/email/templates/downgrade.ts` (the downgrade-confirmation email's "what's gone dark"
paragraph), and `src/lib/email/templates/welcome-sequence.ts` (two spots — the Night Hawk
engine-card description and the pricing-pitch paragraph in the welcome sequence).

**Fix.** Added a Swing Command mention to all 6 call sites, each phrased to fit its existing
sentence (e.g. manifest `capabilities` gets its own bullet; the parenthetical product lists
become "(0DTE Command + Swing Command + Evening Edition)"). `guide-seo.ts`'s `dateModified`
bumped to `2026-10-20` since the meta description materially changed.

**Deliberately NOT touched.** `src/app/(marketing)/vs/others/page.tsx` and
`src/app/(marketing)/methodology/page.tsx` both phrase a related list as *"SPX Slayer, Night
Hawk, and 0DTE Command plays graded A–F..."* — the sweep agent flagged this as
possibly-confusing (treating "0DTE Command" as a sibling of "Night Hawk"). Left alone: this
could equally be a deliberate enumeration of three SEPARATELY-graded play streams (SPX Slayer
plays, Night Hawk swing/legacy plays, and 0DTE Command plays each have their own distinct
track record per `docs/audit/OUTCOME-GRADING-SPEC.md`), not a product-naming error — a
content-strategy judgment call, not an unambiguous drift bug like the six fixed above.

**Blast radius / evidence of fix.** Extended
`src/lib/marketing/product-manifest-consistency.test.ts` (the existing home for this exact
class of regression — it already guards `PRODUCT_MANIFEST.hawk` and `LEARN_NAV`'s night-hawk
descriptor against two earlier, similarly-shaped staleness bugs) with a new test asserting
the manifest's `positioning`/`lifecycle`/`faqAnswer`/`planInclude`/`capabilities`, `LEARN_NAV`'s
description, and `guide-seo.ts`'s night-hawk entry all mention "Swing Command". RED→GREEN
proven via `git stash` on the three edited source files: new test fails pre-fix (17 pass / 1
fail), 18/18 pass once restored. Re-ran the existing 29-test suite spanning
`about-taxonomy.test.ts`, `WhyBlackoutContent.test.ts`, the three email-template product-list
tests, and the full `product-manifest-consistency.test.ts` file — 30/30 pass (no regression
in any sibling assertion). `tsc --noEmit` clean. No test pinned the exact stale string in any
of the 3 non-manifest files touched (WhyBlackoutContent/downgrade/welcome-sequence), so those
three are copy-only edits without their own dedicated regression test — the manifest/nav/
guide-seo root cause is what's now covered.
