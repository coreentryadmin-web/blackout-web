# SEO BASELINE — 2026-08-21

First comprehensive audit of BlackOut's organic search surface. Everything below is a
**measurement taken on this date** unless explicitly labelled an estimate or an inference.

**Read the "Not measurable" section before quoting any number as a KPI.** Several metrics a normal
SEO baseline would open with do not exist yet, and an unmeasured metric is recorded here as
UNAVAILABLE — never as a zero and never as a pass.

Method: live crawl of all 72 `sitemap.xml` URLs over plain HTTPS (`curl` works from the agent
sandbox; Chromium does not — see `LIVE-UI-CONNECTION.md`), plus rendered-DOM measurement through
the `proxy-browser.cjs` tunnel for anything requiring a real browser.

---

## 1. Scale of the surface

| Thing | Count |
|---|---|
| URLs in `sitemap.xml` | **72** |
| — marketing (incl. `/learn` hub) | 9 |
| — `/learn` curriculum (`LEARN_NAV`) | 7 |
| — `/learn` articles (`LEARN_ARTICLES`) | 51 |
| — legal | 5 |
| Duplicate entries in sitemap | **0** |
| Public routes under `(marketing)` | 16 |
| Files exporting `metadata` / `generateMetadata` | 33 |

> **Correction to prior notes.** `sitemap-urls.ts` has been described as "17 URLs". It is not a
> static list of 17 — it composes marketing + legal statics with `LEARN_NAV` and `LEARN_ARTICLES`
> at runtime and currently emits **72**. Verified against the live `sitemap.xml` and by executing
> `publicSitemapEntries()` directly: 8 marketing + `/learn` hub + 7 curriculum + 51 articles + 5
> legal = 72, with **0 overlap** between curriculum slugs and article paths. Article mix is
> 1 pillar / 49 article / 1 glossary — which reconciles exactly with the 58 pages carrying `Article`
> schema (all 59 `/learn*` entries except the `/learn` hub, which is a `CollectionPage`).

`/upgrade` is deliberately absent from the sitemap and serves `noindex, nofollow`. That is
**correct** — it is a conversion endpoint, not a search landing page. Not a finding.

---

## 2. What is healthy (measured, not assumed)

Every one of these was checked across all 72 URLs, not sampled.

| Check | Result |
|---|---|
| HTTP status | **72/72 → 200.** No 3xx, 4xx or 5xx in the sitemap |
| Redirect chains from a sitemap URL | **0** |
| `rel=canonical` present | **72/72** |
| `<meta name="robots">` blocking indexation | **0 pages** |
| `X-Robots-Tag` header blocking indexation | **0 pages** |
| `<h1>` count | **exactly 1 on 72/72** |
| Heading-level skips (h2→h4 etc.) | **0 pages** |
| JSON-LD blocks that fail `JSON.parse` | **0** |
| Duplicate `<title>` across the site | **0** |
| Empty/missing meta description | **0** |
| `<img>` missing an `alt` attribute (server HTML) | **0 of 19** |
| Orphan pages (zero inbound internal links) | **0** |

**Host + protocol canonicalisation is correct**, which is one of the most commonly broken things
on a site this age:

```
http://blackouttrades.com/       → 301 → https://blackouttrades.com/
https://www.blackouttrades.com/  → 301 → https://blackouttrades.com/
https://blackouttrades.com/pricing/ → 308 → /pricing   (no trailing slash)
/PRICING                          → 404 (no case-insensitive duplicate)
/this-page-does-not-exist         → 404 (real 404, not a soft-200)
```

**Structured data inventory** (all valid):

| `@type` | Pages |
|---|---|
| `Organization` | 72 |
| `WebSite` | 72 |
| `BreadcrumbList` | 71 (absent only on `/` — correct) |
| `FAQPage` | 60 |
| `Article` | 58 |
| `WebPage` | 13 |
| `SoftwareApplication` / `WebApplication` / `CollectionPage` / `ItemList` | 1 each |

**SSR is genuine.** Content is in the server HTML, not client-injected — so it is indexable
without relying on Google's rendering queue:

| Page | Server-rendered visible words |
|---|---|
| `/learn` | 2,498 |
| `/learn/vix-trading-guide` | 1,767 |
| `/learn/what-is-dealer-gamma-exposure` | 1,528 |
| `/faq` | 1,463 |
| `/` | 1,451 |
| `/tools/gamma-snapshot` | 365 — *including live SPX spot, call wall, gamma flip, put wall* |

**Internal linking has real contextual depth**, not just nav boilerplate. Excluding
`<nav>`/`<header>`/`<footer>`, learn articles carry **7–13 unique in-body links to sibling
`/learn/*` pages**. Every sitemap URL has ≥59 inbound internal links.

**Performance (server side).** TTFB 137–210ms steady-state across pages, `cf-cache-status: HIT`.

**AI/GEO surface is ahead of the field.** `/llms.txt` (15.7KB, structured product + curriculum
index), `/feed.xml` (RSS, 47.6KB), an IndexNow key that resolves (`/a1522e9c…txt` → 200), and
robots.txt carrying **explicit per-bot allow rules** for GPTBot, ClaudeBot, PerplexityBot,
Google-Extended, CCBot, Bytespider, cohere-ai, Applebot, anthropic-ai and ChatGPT-User.

---

## 3. Findings

### P0 — Critical
**None.** Nothing is blocking indexation of the public surface.

### P1 — High

#### P1-1 · Every OG image + `Article` JSON-LD image was robots-blocked → **FIXED, PR #2448**
`robots.ts` disallowed `/api` on all 11 rules, but `/api/og` is the OG image renderer. All 72 pages
point at it twice — as `og:image`/`twitter:image` and as `Article` JSON-LD's `image` — for **200
references**, and `/api/og` is the *only* `/api/*` path any crawlable markup references. The image
itself was always healthy (`200 image/png`, 45KB); only the permission was wrong.

Invisible because Facebook and X **ignore** robots.txt, so shared links kept previewing correctly
while Google, Bing and every AI crawler saw nothing. Google's `Article` guidelines require a
*crawlable* `image`; a blocked one is reported unfetchable, which suppresses Article rich results
across the 58 pages carrying `Article` schema.

Fixed with a longest-match `Allow: /api/og` — `/api` and `/api/` stay disallowed on all 11 rules.

#### P1-2 · Homepage desktop CLS **0.55** — a failing Core Web Vital → **FIXED, PR #2453**
Two infinitely-looping decorative animations animated `top` (a layout property) instead of
`transform`: `@keyframes sweep` (`.atmos-sweep`) and `@keyframes spulse` (`.spine::before`).
Because both loop forever, CLS **grows for as long as the tab stays open**.

| Viewport | CLS | Runs |
|---|---|---|
| Desktop 1440×900 | **0.539 – 0.563** (~170 shifts) | 5/5 |
| Mobile 430×932 | **0** | 5/5 |

Google's thresholds are good ≤0.10, poor >0.25 — the site's highest-priority URL sat at ~5.5× the
good bound. Mobile reads 0 only because `.atmos-sweep` is `display:none` at that breakpoint, so a
**mobile-only check would have called this page clean.**

Local A/B (same build pipeline, CSS the only difference): BEFORE 0.5847/0.5857/0.5834 → AFTER
**0/0/0**. Verified the animations still run afterwards rather than being silently disabled.

### P2 — Opportunity

#### P2-1 · 7 titles exceed the ~60-char SERP truncation point
Measured **after HTML-entity decoding** (`&amp;` counts as 1 char, not 5 — the raw-source count
overstates by up to 5 per entity and would have flagged 13):

| Chars | Path |
|---|---|
| 74 | `/learn/wheel-strategy-cash-secured-puts` |
| 70 | `/learn/spx-vs-spy-options-explained` |
| 67 | `/learn/butterfly-spread-strategy-guide` |
| 64 | `/learn/best-0dte-trading-strategies` |
| 63 | `/learn/options-tax-treatment-1256` |
| 62 | `/learn/straddles-strangles-options-explained` |
| 61 | `/learn/market-maker-hedging-explained` |

Site-wide: min 24 / max 74 / avg 48.2. The ` | BlackOut` suffix costs 11 chars; dropping it on
these 7 alone resolves all of them.

#### P2-2 · 8 meta descriptions exceed ~160 chars
`/vs/others` (192), `/about` (170), `/learn/spx-slayer-play-grades-explained` (165),
`/why-blackout` (163), `/faq` (162), `/learn/thermal-strike-selection-guide` (162),
`/learn/spx-slayer` (161), `/privacy` (161). Site avg 151.7. Truncation only — no indexation impact.

#### P2-3 · Homepage React hydration error #418, reproduces 3/3 runs
`Minified React error #418` (server/client text mismatch) fires on `/` on every load. Owned here
because hydration mismatches sit in the SSR/rendering path. Not currently causing measurable
CLS or content loss — **but it should be root-caused, not left running.** No fix attempted in this
cycle: the mismatched subtree was not isolated, and guessing at a hydration fix is how a render
regression ships.

#### P2-4 · Mobile readability — 57 text nodes below 12px on `/`
Also 31 interactive elements under the 24×24px tap-target guideline. No horizontal overflow on any
page at 430px (`scrollWidth == clientWidth == 430`), so the layout itself is sound. Design-owned;
flagged, not changed.

### P3 — Experimental / housekeeping

- **P3-1 · `/favicon.ico` → 404**, and the 404 response ships **28.5KB of HTML**. `<link rel="icon">`
  points at `/icon.png` (200), so Google can find the favicon — but legacy crawlers and browsers
  requesting `/favicon.ico` get a 28KB HTML miss. Cheap to add.
- **P3-2 · Homepage canonical/sitemap trailing-slash mismatch.** Sitemap lists
  `https://blackouttrades.com/`; the page's canonical is `https://blackouttrades.com` (no slash).
  Google normalises these, so impact is ~nil — but they should agree.
- **P3-3 · `MARKETING_DATES` in `sitemap-dates.ts` is a hand-maintained map** and will drift. Newest
  sitemap `lastmod` is 13 days old, oldest 25. **No date is in the future** — freshness is
  understated, never overstated, which is the safe direction. Worth deriving from git like
  `ARTICLE_DATES` already is.
- **P3-4 · `@keyframes pipe-scanline`** has the same `top`-animation defect as P1-2 but is gated
  behind `.pipe-lit` and contributed 0 measured shifts. Left unfixed deliberately — `translateY(100%)`
  resolves against the element's own 1px height, so the substitution is not a one-liner.
- **P3-5 · GSC/Bing verification tokens are wired but unset in prod.** `verification.ts` reads
  `GOOGLE_SITE_VERIFICATION` / `BING_SITE_VERIFICATION`; neither meta tag is present on the live
  site. Ownership may still be verified by DNS or via the GA4 property — unconfirmed without access.

---

## 4. Not measurable — do NOT report these as zero

| Metric | Status | Why |
|---|---|---|
| Impressions, clicks, CTR, avg position | **UNAVAILABLE** | GSC API rejects the supplied API key: `API keys are not supported by this API. Expected OAuth2 access token…`. Needs a service account granted on the property, or an OAuth refresh token. |
| Indexed-page count vs the 72 submitted | **UNAVAILABLE** | Same. **The 72 above is what is *submitted*, not what is *indexed*.** Do not conflate them. |
| Branded vs non-branded split | **UNAVAILABLE** | Same. |
| Keyword rankings / SERP positions | **UNAVAILABLE** | No Ahrefs/Semrush/DataForSEO. §5 is reasoning + web search, explicitly not rank data. |
| Search volumes | **UNAVAILABLE** | Same. Any number in a future plan is an estimate and must be labelled one. |
| Field (CrUX) Core Web Vitals | **UNAVAILABLE** | §3's CLS/LCP are **lab** measurements from this sandbox through a proxy tunnel. Directionally sound and reproducible; not real-user data. |

### Correction: analytics DOES exist
Prior notes stated *"no GA4, Plausible or PostHog in the codebase at all."* **That is wrong.**

- **GA4 `G-YLN4K37KYF`** is live and firing on every page — `src/app/layout.tsx:157`.
- A **Google Ads conversion ID** is wired at `layout.tsx:160`.
- An **X/Twitter ads pixel** (`twq('config','re1j3')`) is at `layout.tsx:164`.

So organic sessions, landing pages and conversions are **being collected today** and are
recoverable via the GA4 Data API with a service account. This is a materially better starting
position than "no data at all," and it is the **cheapest unblock available** — it needs no new
tracking, only read credentials.

### How GSC slots in
The baseline is deliberately structured so GSC drops in without rework: §1 fixes the submitted-URL
denominator, §2 establishes that all 72 are technically indexable, and §3 records the two defects
that were suppressing rich results and CWV. On the day access lands, the first three questions are:
(1) indexed vs the 72 submitted; (2) Article rich-result impressions before/after PR #2448's deploy
date; (3) desktop CWV before/after PR #2453's.

---

## 5. Search landscape — reasoning + web search, NOT rank data

Everything here is qualitative observation from web search on 2026-08-21. **No position, volume or
traffic figure is claimed.** "Not observed" means "did not appear in these results" — it is *not*
evidence of a Google ranking.

**The competitive set** for BlackOut's core terms: SpotGamma, MenthorQ, FlashAlpha, QuantWheel,
GEX-Metrix, AlgoStorm, ApexVol, InsiderFinance, Cheddar Flow, OptionsTradingToolbox.

**Observation 1 — the free-GEX-tool category is crowded and BlackOut was not observed in it.**
A search for free SPX GEX tools returned nine competitors; `/tools/gamma-snapshot` did not appear.
It is BlackOut's only public data page and covers 3 tickers (SPX/SPY/QQQ).

**Observation 2 — competitors compete on programmatic per-ticker pages at a scale BlackOut has not
attempted.** QuantWheel ships `/tools/gex/spx`, `/tools/gex-heatmap/spx`; FlashAlpha advertises
GEX levels for **"6,000+ tickers"** and runs `/stock/spx` with **live data in the title tag** —
observed verbatim as *"SPX GEX +$102.3B Long, Max Pain 7360 - Live Today"*. Live numbers in the
title is a strong freshness/CTR pattern.

**This is precisely the category that is BLOCKED on data licensing — see §6. Nothing above is a
recommendation to build it.**

**Observation 3 — the educational layer is genuinely competitive and already built.** The 52-article
corpus covers the head terms directly (`what-is-dealer-gamma-exposure`, `best-0dte-trading-strategies`,
`max-pain-options-explained`, `pin-risk-options-explained`, `market-maker-hedging-explained`).
Quality is good and SSR'd. However, for the head term *"what is dealer gamma exposure"*, BlackOut
was **not observed** in results dominated by SpotGamma, MenthorQ, Cheddar Flow, ApexVol, moomoo,
Yahoo Finance and Barchart. Whether that reflects true ranking is **unknown without GSC**.

**Observation 4 — the brand term is ambiguous.** "blackout" collides with the SEC/HR sense
("blackout period"). Searching the brand returned `blackouttrades.com` alongside
myshyft.com, sec.gov and foundershield.com. Branded SERP real estate is diluted by pure homonym
collision — an argument for consistently pairing "BlackOut" with "Trades"/"options" in titles.

### Where BlackOut's proprietary data could beat generic finance content

The differentiator is **not** another GEX-levels page — six competitors already publish those. It is
that BlackOut is the only one in this set that **grades its own output and keeps the ledger**:
A–F play grades, win/loss/breakeven records, the outcome-grading spec, and measured condor
win-rate-by-width from real minute bars.

Nobody in the competitive set publishes *"here is what our signal actually did, graded, over N
sessions."* That is BlackOut's **own research output about its own product**, which is a materially
different question from redistributing a vendor's live market data — **but it is still a licensing
question, because the inputs are vendor-derived. It is flagged in §6, not proposed.**

---

## 6. BLOCKED on data licensing — no action taken

Per standing constraint, **no public indexable page publishing derived Polygon or Unusual Whales
data was built, extended, or proposed for deployment in this cycle.** Architecture may be modelled;
pages may not ship. Three items for the operator's pending legal question:

1. **Programmatic per-ticker GEX/flow/dealer-positioning pages.** The largest identified organic
   opportunity (§5, Observation 2) and squarely inside the blocked category. Not designed further.
2. **⚠️ A page in this category is ALREADY LIVE and indexable.** `/tools/gamma-snapshot` is in the
   sitemap (`priority 0.8`, `changefreq daily`), returns 200, and **server-renders live derived
   vendor data** — captured this session: *"SPX Spot 7,641.16 · Short Gamma Regime · 7,900 Call Wall
   · Gamma Flip · 7,640 Put Wall"* for SPX/SPY/QQQ. This **predates this audit and was not created
   here**, but the pending licensing question appears to apply to it *today*. Surfacing it because
   the constraint is about not shipping *new* such pages, and an existing one may already carry the
   same exposure. **Escalating to the coordinator; taking no action for or against it.**
3. **Publishing graded track-record/methodology statistics** (§5). Plausibly a different legal
   question — BlackOut's own derived performance rather than vendor data redistribution — but the
   inputs are vendor-derived, so it is the operator's call, not an engineering one.

*That competitors publish this data publicly is market observation, not legal advice, and does not
resolve BlackOut's contract terms.*

---

## 7. Out of scope — referred to the coordinator

- **Backlinks/outreach.** A *"Top Options Flow Platforms (2026 Comparison)"* listicle was observed
  in results; BlackOut's presence in comparison/roundup content is a link-building concern.
- **Brand/creative.** The homonym collision in §5 Observation 4 has a brand dimension beyond titles.
- **Design.** P2-4 (sub-12px text, sub-24px tap targets) is a design-system call.
- **Engineering.** P2-3 (React #418 hydration error) needs the owning lane to isolate the subtree.

---

## 8. Highest-priority work for the next cycle

1. **Live-verify PRs #2448 and #2453 after deploy.** Merged is not done; deployed is not done. Re-fetch
   prod `robots.txt` for the `Allow: /api/og` lines, and re-measure desktop CLS to confirm ~0.
2. **Get GA4 read access** (service account on `G-YLN4K37KYF`). Cheapest unblock on the board —
   the data already exists and needs no new instrumentation.
3. **Get GSC access** (service account or OAuth refresh token). Everything in §4 unblocks at once.
4. **Land the P2 title/description trims** — 7 titles, 8 descriptions, mechanical and low-risk.
5. **Get a licensing answer** so §6's opportunity is either sized properly or closed for good — and
   resolve the status of the already-live `/tools/gamma-snapshot`.
