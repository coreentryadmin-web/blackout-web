# SEO / Search Visibility — Growth Strategy & Opportunity Register

**Owner:** SEO & Search lane. **First written:** 2026-08-21, off the first real Search Console
ground truth. Regenerate the data sections with `node scripts/audit/gsc-opportunities-report.mjs`.

This is the deep-dive the operator asked for: *how do we improve platform visibility and get
traffic.* It is deliberately blunt about where the lever actually is, because the most expensive
mistake here would be to keep shipping on-page PRs against a ceiling that on-page work cannot move.

---

## 1. The honest state (measured, not asserted)

Search Console, 90-day window (`sc-domain:blackouttrades.com`, encoded `sc-domain%3A…`):

| Metric | Value |
|---|---|
| Clicks (28d) | **10** |
| Impressions (28d) | **908** |
| CTR | **1.1%** |
| Avg position | **32.4** |
| Homepage share of clicks | **9 of 10** |

The site is **early-stage**: real demand exists and is indexed, but it lands on **page 6–9** for the
head informational terms — "what is gex" pos 67, "gamma exposure explained" pos 64, "dealer gamma"
pos 59, "options assignment" pos 67. The one exception is `is 0dte gambling` at **pos 11.5** (page 2).

The high-impression, page-1, zero-click pages (`/faq`, `/pricing`, `/contact`, `/learn`) are **not a
CTR opportunity** — they rank page-1 *only* for Google's auto-generated `(blackouttrades.com what is
it)` brand panel and `site:` audits. Nobody types those. The opportunity-finder excludes them by
design; do not "optimize titles" against them.

## 2. The diagnosis — the foundation is not the bottleneck

Every in-lane technical and on-page lever has been audited and is **already strong**:

| Layer | State |
|---|---|
| Crawl/index (robots, sitemap, canonicals, 404s, host/protocol) | ✅ clean (SEO-BASELINE-2026-08-21) |
| Rendering (SSR, indexable content) | ✅ genuine SSR |
| Core Web Vitals | ✅ CLS 0, LCP fine (homepage CLS fixed live 2026-08-21) |
| Structured data | ✅ Organization/WebSite/Article/FAQ/Breadcrumb/WebApplication + **entity `@id` graph, `knowsAbout`, glossary `DefinedTermSet`** (2026-08-21) |
| On-page (titles, meta, headings, FAQs, internal links) | ✅ comprehensive; articles are 700–1500 words with FAQ sets and 7–27 in-content links |
| AI/GEO surface (`llms.txt`, RSS, IndexNow, per-bot allow) | ✅ ahead of the competitive set |

**The bottleneck is authority and time, not the site.** BlackOut ranks page 6–9 for terms owned by
SpotGamma, MenthorQ, Cheddar Flow and FlashAlpha — sites with years of domain age and backlink
profiles. No amount of on-page editing moves a page-6 result to page-1 against that; that gap closes
with **off-site authority** (links, mentions, digital PR) and **time**.

This is the load-bearing conclusion: **more on-page SEO PRs are now low-yield.** The remaining
in-lane structured-data wins have been shipped. Further on-page churn on already-good pages would
violate the "don't change stable pages to look productive" rule.

## 3. The lever map — what moves traffic from here, and who owns it

| Lever | Impact | Owner | Status |
|---|---|---|---|
| Entity / knowledge-graph signals (brand panel, AI citation) | Medium, near-term | **SEO (me)** | ✅ shipped — entity `@id` graph + `knowsAbout` + glossary `DefinedTermSet` |
| AI/GEO surface (llms.txt, machine-readable defs) | Medium, near-term | **SEO (me)** | ✅ strong; DefinedTermSet added |
| Striking-distance queries (page 2: `is 0dte gambling` pos 11.5, `gamma three trading` pos 18.7) | Small | **SEO (me)** | Both well-optimized in existing dealer-gamma / FAQ content; authority/backlinks drive further movement |
| **Backlinks / digital PR / authority** | **High — the actual traffic lever** | **OUT OF LANE → coordinator** | ⚠️ delegated (see §5) |
| **Programmatic ticker landing pages** (GEX/flow per ticker) | **High — largest content opportunity** | Blocked | ⛔ **licensing** (vendor redistribution terms) — see §5 |
| Google Ads receiving GA4 conversions | High for paid, not organic | Out of lane (ads/analytics) | ⚠️ flagged — GA4 events never reach Ads as conversions |
| GSC Removals for dead `staging.*` URLs (8) + Bing residue | Cleanup | Dashboard (human) | ⚠️ delegated (removal API doesn't exist) |

## 4. Prioritized roadmap (in-lane, defensible, non-thin)

1. **DONE — entity graph + glossary DefinedTermSet** (PR: entity-knowledge-graph). Feeds the brand
   panel and AI answer engines, which cite by entity, not backlink — the one high-confidence lever
   that does not require authority.
2. **DONE — GSC ground truth + reproducible opportunity-finder** (this PR + gsc-ground-truth). Every
   future cycle answers "where does on-page effort go?" from data.
3. **Monitor, don't churn.** Re-run `gsc-opportunities-report.mjs` each cycle. Act on-page ONLY when
   a query enters the striking-distance band (page 2). Today that is `is 0dte gambling` alone, and it
   is already optimized.
4. **Content expansion — only against demonstrated demand, never speculative.** New pages require a
   real query with impressions and a topic where BlackOut can be materially better than generic
   finance content. The `/learn` corpus already covers the head terms; do not add thin pages to
   raise the indexed-page count (explicitly forbidden).
5. **When licensing clears (§5): programmatic ticker pages.** This is the single largest organic
   opportunity — competitors rank per-ticker pages with live numbers in the title. Architecture may
   be designed now; pages may not ship until the operator answers the vendor-redistribution question.

## 5. Out-of-lane / blocked — escalated, not actioned

- **Authority / backlinks is the real traffic lever and is out of the SEO-technical lane.** Digital
  PR, guest content, tool-embed link bait (the free Gamma Snapshot is a natural link magnet — pitch
  it), broker/community partnerships, and getting BlackOut into the "best options flow platform"
  roundups where it is currently absent. **Coordinator: this needs an owner.** Without it, organic
  traffic stays flat regardless of on-page work.
- **Programmatic vendor-data pages are licensing-blocked.** Do not ship public indexable pages
  publishing derived Polygon/Unusual Whales data until the operator answers the redistribution
  question. `/tools/gamma-snapshot` already publishes live derived values and predates this audit —
  flagged separately for a posture decision.
- **`staging.blackouttrades.com` — 8 dead URLs indexed.** Removal is dashboard-only (no Removals
  API); list handed to the coordinator. Bing residue is unmeasurable from here (no Webmaster API).
- **GA4 → Google Ads conversions** never wired (analytics/ads lane).

## 6. What shipped this cycle (2026-08-21)

- P1 `/api/og` crawlability fix — **live-verified** (OG + Article images now crawlable).
- P1 homepage desktop CLS 0.55 → 0 — **live-verified** (edge cache purged, animations confirmed).
- GSC ground truth wired (`gsc-search-analytics.mjs`) + first pull found the staging indexation.
- Entity `@id` graph + `knowsAbout` + glossary `DefinedTermSet` structured data.
- This opportunity-finder (`gsc-opportunities-report.mjs`) + register.

## 7. The reproducible engine

`node scripts/audit/gsc-opportunities-report.mjs [--days=90] [--json]` — reads GSC, classifies every
non-brand query by the band where its **lever** differs (page-1 = CTR, page-2 = on-page, page-3+ =
authority), and lists the pages hosting striking-distance demand. Pure classification logic is in
`scripts/audit/lib/gsc-opportunities.mjs` (unit-tested). Run it each cycle; let the data, not a
remembered snapshot, say where the work is.
