## 2026-09-04 — [P3, IA/onboarding] Academy's structured curriculum had no Vector or Meridian chapter — FIXED

> **kind:** `FINDING`

| | |
|---|---|
| **Severity** | P3 — real onboarding/discovery gap, not a data-correctness bug. Academy describes itself as a "structured textbook from first login to advanced workflows," but its structured chapter nav covered only 5 of BlackOut's 7 live paid products. |
| **Found by** | User report (operator) |
| **Status** | FIXED |

### Root cause

`LEARN_NAV` (`src/lib/learn/nav.ts`) — the single source of truth for Academy's numbered chapter
list, consumed by `LearnSidebar.tsx` (chapter nav UI), `curriculum.ts` (chapter numbering /
prev-next), `CourseJsonLd` (structured data), `llms.txt` (the GEO/AI-answer-engine file), and
`sitemap-urls.ts` — had exactly 7 entries: Getting Started, SPX Slayer, HELIX, Largo, Night Hawk,
Thermal, Glossary. Vector and Meridian had no chapter at all, so Glossary occupied the last
"chapter" slot even though the platform has 7 paid desk products, not 5.

`PRODUCT_MANIFEST` (`product-manifest.ts`) — the canonical registry that already feeds the
homepage, pricing, and FAQ — already listed Vector and Meridian as `launchStatus: "live"`, with
`learnHref` fields pointing at real, rich guide content (`/learn/vector-scanner-guide`,
`/learn/meridian-earnings-desk-guide`) that already existed as ARTICLE entries in the unstructured
Guides catalog (`LEARN_ARTICLES`, rendered as a flat list below the numbered chapter nav in
`LearnSidebar.tsx`). The registry and the article content were already correct and complete — only
the structured chapter list (`LEARN_NAV`) was never extended when Vector and Meridian were
promoted to live products, exactly the root cause the report named.

Confirmed via `git checkout` (`fix/vector-guide-thermal-multiticker-claim`, PR #3786 same day):
Vector's own guide article already correctly differentiates itself from Thermal as "the entire
universe at once" — but a member reading the Academy's structured nav would never have discovered
that article existed unless they scrolled past the numbered chapters into the flat Guides list.

### Evidence

`tsc --noEmit` caught a real, independent wiring gap while building this fix: `site-map.ts`'s
`TOOL_ROUTES` (`Record<Exclude<LearnSlug, "getting-started" | "glossary">, string>`) had no entry
for the two new slugs — a compile error, not a runtime one, confirming the type system already
enforced every `LearnSlug` needs a live route, and this was simply never satisfied for Vector/
Meridian. Fixed by adding `vector: "/vector"` and `meridian: "/meridian"`.

RED (`git stash` on `nav.ts` only, new invariant test kept applied): 1/12 tests in
`product-manifest-consistency.test.ts` fail — `vector` and `meridian` both report missing an
Academy chapter. GREEN after restoring: 12/12 pass. `npx tsc --noEmit` clean. Re-ran the full
Learn-content + sitemap/llms.txt test surface (`CourseJsonLd.ssr.test.ts`, `learn-slug-404.test.ts`,
`guide-faqs.test.ts`, `guide-seo.test.ts`, `metatitle-length.test.ts`,
`grading-policy-consistency.test.ts`, `no-execution-claims.test.ts`, `sitemap-dates.test.ts`,
`sitemap-urls.test.ts`, `llms.txt/route.test.ts`) — 40/40 pass, no regression. `eslint` clean on
every touched/new file.

### Fix

Extended `LearnSlug` and `LEARN_NAV` with two new chapters, inserted after Thermal and before
Glossary (chapters 8 and 9 — Glossary shifts from 7 to 9, still a real numbered chapter, see
"deliberately left unchanged" below):
- **Vector** (`product: "vector"` — a real `MarkProduct` sigil already exists) — a full new
  `LearnGuide` (`guides/instruments/vector.ts`) covering the Universe scanner (nearest-flip/
  most-pinned/most-explosive presets, verified against `vector-screener.ts`'s real ranking logic),
  the GEX/VEX matrix ladder, the chart's indicator/replay/DTE-horizon toolbar, the Play card +
  contract picks, the Live Helix rail, and alerts — grounded directly in `VectorScanner.tsx`,
  `VectorOdteMatrixRail.tsx`, `VectorPlayCard.tsx`, `VectorContractPicksCard.tsx`,
  `VectorHelixRail.tsx`, `VectorReplayControls.tsx`, and `vector-cadence.ts`'s real poll intervals
  (not invented numbers).
- **Meridian** (`product: "docs"` — see "deliberately left unchanged": no `MarkProduct` sigil
  exists yet for Meridian) — a full new `LearnGuide` (`guides/instruments/meridian.ts`) covering
  the catalyst timeline's four kinds and filter chips (verified against `MeridianDesk.tsx`'s exact
  chip labels/ids), the kind-specific detail panels for macro/OpEx/FDA
  (`MeridianEventDetailPanel.tsx`, `MeridianMacroReportPanel.tsx`,
  `MeridianOpexCrossMarketPanel.tsx`), and the five-tab earnings sub-desk (`MeridianEarningsTabs.tsx`
  + its five panel components) as the deepest workflow.

Wired both through the existing pattern: `guides/instruments/index.ts` → `guides/tool-guides.ts` →
`guides/index.ts`'s `GUIDES` map, plus new `GUIDE_SEO` entries (metaTitle/metaDescription within
the existing 60/160-char SERP guards) and `CROSS.vector`/`CROSS.meridian` helpers in
`guides/shared.ts` so other chapters (and each other) can cross-link to them, matching the pattern
every existing chapter already uses.

Added the invariant the report explicitly asked for: a new test in
`product-manifest-consistency.test.ts` asserting every live `PRODUCT_MANIFEST` product has exactly
one first-class Academy chapter, via an explicit `MANIFEST_ID_TO_LEARN_SLUG` mapping (the three
naming schemes in play — `MarketingModuleId`, `MarkProduct`, `LearnSlug` — don't share values, so
this mapping is the join the codebase doesn't otherwise provide) plus a duplicate-slug guard.

### Blast radius

Nine files touched/added: `nav.ts` (type + 2 nav entries), two new guide files, three small
export-wiring files (`instruments/index.ts`, `tool-guides.ts`, `guides/index.ts`), `shared.ts`
(2 new CROSS helpers), `guide-seo.ts` (2 new entries), `site-map.ts` (2 new routes, caught by
`tsc`), and the new invariant test. Every consumer of `LEARN_NAV` (`LearnSidebar.tsx`,
`LearnHub.tsx`'s `{CURRICULUM.length} chapters` count, `CourseJsonLd`, `llms.txt`,
`sitemap-urls.ts`) is fully dynamic — none hardcode a chapter count or slug list — so all of them
automatically pick up the two new chapters with zero additional changes, verified by the passing
test suite above rather than assumed.

### Fix rationale

Wrote real, code-grounded `LearnGuide` chapters (matching the existing quality bar set by
`heat-maps.ts` — panel name/location/purpose/shows/actions/cadence/consume, not placeholder text)
rather than thin stub chapters that just link out to the existing articles. Content was built from
direct component/route investigation (`VectorScanner.tsx`'s real preset config,
`vector-wall-integrity.ts`'s real scoring weights, `MeridianDesk.tsx`'s real filter-chip ids/
labels, `MeridianEarningsTabs.tsx`'s real 5-tab order) so the guides describe what the product
actually does today, the same standard the existing 5 chapters and the recently-shipped Meridian
article (PR #3353) already hold themselves to. Inserted the two new chapters between Thermal and
Glossary — preserving the existing 5 chapters' relative order and chapter numbers (renumbering an
existing chapter would be a larger, unrelated change) while still landing Vector and Meridian as
real, structured chapters rather than the unstructured Guides catalog.

### What was deliberately left unchanged

**Meridian has no product sigil/icon.** `MarkProduct` (`ProductMark.tsx`) lists six values (spx,
helix, heatmap, largo, nighthawk, vector) — Vector already had a real hand-drawn SVG geometry, but
Meridian never got one; its comment still says "the six product sigils," a stale count in its own
right. Designing a new animated sigil (matching the existing hand-crafted draw-on/glow/accent
system) is a real visual-design task, not a copy or logic fix, so Meridian's `LearnNavItem` uses
`product: "docs"` — the same honest, pre-existing fallback Getting Started and Glossary already
use (a bordered "?" icon), rather than fabricating placeholder geometry or reusing another
product's icon. Flagging this explicitly as the natural next step once a sigil is designed: swap
`product: "docs"` → `product: "meridian"` once `MarkProduct` and `MARK_GEOMETRY` gain a real entry.

**Glossary stays a numbered chapter (now 9, was 7)**, rather than being demoted to a non-numbered
"reference section" as the report's recommendation suggested. That's a real, separate structural
change (would touch `curriculum.ts`'s pure positional `chapter: i + 1` numbering, `CourseJsonLd`'s
chapter schema, and prev/next chapter navigation logic) with more blast radius than adding two
chapters needs — the core, testable complaint this fix resolves ("every currently purchasable
product has exactly one first-class Academy chapter") does not require it. Worth its own follow-up
if the operator wants it.

**Did not touch the existing `LEARN_ARTICLES` entries** for `vector-scanner-guide` or
`meridian-earnings-desk-guide` — both remain in the flat Guides catalog as deeper standalone
reads; the new chapters are a genuinely different artifact (structured curriculum position +
panel-by-panel walkthrough), not a duplicate of the articles.

**`PRIMARY_NAV`'s Night Hawk description** (`site-map.ts` line ~55, "Evening playbook plus 0DTE
Command always-on scanner") — noticed while fixing `TOOL_ROUTES` in the same file, and similar in
theme to the three other Night Hawk staleness fixes shipped today (#3784, #3791), but this one
already mentions 0DTE Command (just leads with "Evening playbook" first) so it's a weaker instance
of the same class — left untouched to keep this PR scoped to the Academy chapter gap; noted here
for a future pass.
