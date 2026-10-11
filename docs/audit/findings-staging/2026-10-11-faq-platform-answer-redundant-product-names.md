## FAQ "What exactly is BlackOut?" answer redundantly named 3 products twice while omitting Vector/Meridian from its own lead sentence — FIXED

> **kind:** `FINDING`

| | |
|---|---|
| **Area** | GEO/SEO — `src/lib/faq/content.ts`, rendered unfiltered on `/faq`'s `FAQPageJsonLd` |
| **Severity** | P3 (GEO/content-quality bug, no functional impact) |
| **Status** | FIXED |

### Root cause

The `platform-1` FAQ item ("What exactly is BlackOut?") hand-wrote a lead sentence that named
5 of the then-current products (options flow → HELIX, SPX Slayer, dealer gamma positioning →
Thermal, dark-pool activity → HELIX, Largo analysis, Night Hawk's 0DTE Command desk), then
appended `manifestPlatformSummary()` — a full, manifest-derived comma list of every live
product's label — right after it with an em dash. When Meridian (and earlier, Vector) joined
the manifest, `manifestPlatformSummary()`'s tail correctly grew to include them, but the
hardcoded lead sentence was never touched, so SPX Slayer/Night Hawk/Largo ended up named
**twice** in the same answer while Vector and Meridian were named only once, in the
auto-generated tail, never in the descriptive sentence naming the others. Same "hardcoded
prose not updated after a product launch" root cause already found this session in two email
templates — found by an independent background sweep of SEO/GEO surfaces and re-verified
directly against the source before fixing.

### Evidence

Direct `Read` of `src/lib/faq/content.ts:71` confirmed the exact text. `src/app/(marketing)/
faq/page.tsx:18` confirmed `FAQ_ITEMS` is passed unfiltered into `FAQPageJsonLd` — a real
`FAQPage` JSON-LD structured-data block AI answer engines and search crawlers parse, not a
cosmetic surface. `manifestPlatformSummary()` (`product-manifest.ts:221-225`) confirmed it
joins every live product's label in `MANIFEST_PRODUCT_ORDER` order with no de-duplication
against anything the caller already said.

### Blast radius

Single answer string, one file. The background sweep's scope covered `llms.txt`, JSON-LD
builders, `sitemap.ts`, `robots.ts`, and manifest-count usage on home/pricing/vs-others/FAQ —
all other surfaces checked were either already manifest-derived (no drift possible) or static
with no product enumeration. One secondary, lower-severity item was also flagged (`site.ts`'s
shared `SITE.description`, reused across JSON-LD + `llms.txt`, names only 4 of 7 products but
asserts no count — stale-reading but not factually wrong); left for a separate decision rather
than folded into this fix, since it's a different file with a different risk profile (shared
across more surfaces, worth a deliberate look rather than a drive-by edit).

### Fix rationale

Rather than patching the lead sentence to also name Vector and Meridian (which would just
recreate the identical staleness risk at the next product launch), rewrote it to describe
platform *capabilities* generically (options flow, dealer gamma positioning, dark-pool
activity, graded play intelligence) without naming any specific product — leaving
`manifestPlatformSummary()` as the single, already-correct place product names are
enumerated. This removes the redundancy entirely rather than just rebalancing it.

### Test

Extended the existing `src/lib/faq/content.test.ts` (did not create a new file — it already
existed with 6 tests covering `FAQ_ITEMS`/`selectFaqItems`/home-accordion-JSON-LD parity) with
2 new tests: every live product's label appears in the `platform-1` answer exactly once (not
duplicated), and Vector/Meridian are present. Proven RED→GREEN by temporarily reverting just
the fixed sentence to its pre-fix text — the duplication test failed with "SPX Slayer... found
2" against the old text, passed once restored. All 8/8 tests pass, `tsc --noEmit` clean.
