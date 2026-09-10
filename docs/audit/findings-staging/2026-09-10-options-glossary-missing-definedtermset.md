> **kind:** FINDING

## `/learn/options-trading-glossary` had 24 real term definitions with zero machine-readable markup — FIXED

| | |
|---|---|
| **Status** | FIXED |
| **Area** | GEO / structured data (`src/app/(marketing)/learn/[slug]/page.tsx`, `src/lib/learn/articles.ts`) |
| **Severity** | P3 (GEO/schema-completeness gap, not a live defect) |

### Root cause

`DefinedTermSetJsonLd` (`src/components/seo/JsonLd.tsx`) already exists and is used on the
platform's own glossary (`/learn/glossary`, 11 proprietary terms — CHARM, DEX, GEX, walls, etc.),
gated on `slug === "glossary"` in the guide branch of `/learn/[slug]/page.tsx`. But the SEPARATE,
general-audience options glossary (`/learn/options-trading-glossary`, `LEARN_ARTICLES`, `type:
"glossary"`) went through the `LEARN_ARTICLES` branch of the same page, which only ever wired
`ArticleJsonLd` + `FAQPageJsonLd` — never `DefinedTermSetJsonLd`. That branch's FAQ carries only 2
Q&As ("most important terms", "what does GEX mean"); the other 22 of 24 real term definitions in
the article body (0DTE, Call Wall, Dark Pool, Dealer, Delta, Delta Hedging, Gamma, Gamma Flip,
Gamma Squeeze, Implied Volatility, Iron Condor, Long Gamma, Max Pain, Open Interest, Options Chain,
Options Flow, Put Wall, Short Gamma, SPX, Theta, Unusual Options Activity, Vega) were rendered as
plain `<strong>Term</strong>: definition` prose with no `DefinedTerm` markup at all — confirmed live
by fetching the page and diffing rendered `@type` values against the platform glossary, then
checking the DOM for `<h2>`/`<dt>`/`<dd>` (none; terms are inline bold text only).

This is exactly the surface `DefinedTermSetJsonLd`'s own doc comment names as "a direct GEO lever:
it hands Google's definition boxes and the AI answer engines a machine-extractable, attributable
definition for each term instead of leaving them to scrape prose" — and it was live on the SMALLER,
platform-specific glossary while absent from the LARGER, general-audience one that (per GSC) is
already earning search impressions.

### Evidence

- Live diff of `@type` values across `/learn/glossary` (has `DefinedTermSet`) vs
  `/learn/options-trading-glossary` (does not) — same site, same JsonLd toolkit, one page wired,
  one not.
- `curl` + regex extraction of the rendered `<strong>...</strong>` term markers on
  `/learn/options-trading-glossary`: 24 distinct terms, confirmed against the article's own
  markdown source (`src/lib/learn/articles.ts`, `slug: "options-trading-glossary"`).
- `<h2>` count on that page: 1 ("Related guides") — the 24 terms carry no heading structure either,
  only inline bold + a following em-dash definition.
- `article.type === "glossary"` is set on exactly one `LEARN_ARTICLES` entry (grep-confirmed), so
  gating the fix on that field is scoped correctly and cannot silently pick up a future non-glossary
  article.

### Fix

Additive, no visible content change:
- `src/lib/learn/article-glossary-terms.ts` (new): `parseGlossaryTerms(body)` extracts `{term,
  def}` pairs directly from the article's own markdown body (`**Term** — definition`), flattening
  inline `[text](url)` links to plain anchor text and stripping stray emphasis markers, so the
  JSON-LD can never drift from what the page renders — same anti-drift discipline
  `glossaryTermsFlat()` already documents for the platform glossary (a `DefinedTerm` describing a
  definition users can't see is the schema/markup mismatch Google penalizes).
- `/learn/[slug]/page.tsx`: renders `<DefinedTermSetJsonLd path={article.path} name={article.title}
  terms={parseGlossaryTerms(article.body)} />` when `article.type === "glossary"` — mirrors the
  existing `slug === "glossary"` branch for the platform glossary, just on the `LEARN_ARTICLES` side
  of the same page component.
- New test `src/lib/learn/article-glossary-terms.test.ts`: asserts all 24 real terms parse from the
  live article body (including edge terms like `0DTE (Zero Days to Expiration)` and `Vega`), that
  markdown links/emphasis are flattened to plain text, and that non-term prose lines are correctly
  ignored.

### Blast radius

Two files: one new pure helper, one `page.tsx` wiring (one new conditional block, additive). No
change to `DefinedTermSetJsonLd` itself, no change to the platform glossary's existing behavior, no
visible rendering change on `/learn/options-trading-glossary` — only its `<head>` JSON-LD payload
gains a `DefinedTermSet` graph. Full suite run clean on Node 20 (13435 pass / 0 fail / 3 pre-existing
skips) plus a clean `tsc --noEmit`.
