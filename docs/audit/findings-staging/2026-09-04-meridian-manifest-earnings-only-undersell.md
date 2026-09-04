## 2026-09-04 — [P3, product-positioning/conversion] Meridian's manifest undersold its real four-catalyst-class coverage as earnings-only — FIXED

> **kind:** `FINDING`

| | |
|---|---|
| **Severity** | P3 — product-discovery/growth issue, not a data-correctness bug. A prospective Premium subscriber evaluating the homepage had no indication Meridian covers macro, OpEx, and FDA catalysts alongside earnings — a real addressable-use-case gap in acquisition copy. |
| **Found by** | User report (operator), independently confirmed against `src/features/meridian/lib/meridian-types.ts`, `MeridianDesk.tsx`, `MeridianEventDetailPanel.tsx` |
| **Status** | FIXED |

### Root cause

`PRODUCT_MANIFEST.meridian` (`src/lib/marketing/product-manifest.ts`) framed Meridian narrowly:
`tag: "Earnings intelligence"`, `positioning: "Earnings calendar with estimates, reactions, and
cross-tool positioning context."`, capabilities limited to earnings-timeline/estimate-revisions/
positioning-context. This manifest is the canonical source for the homepage card, pricing matrix,
FAQ, SEO `featureList` schema, and marketing emails — every downstream surface checked
(`products.ts` → `RedesignHome.tsx` homepage card, `upsell-features.ts` pricing matrix,
`JsonLd.tsx` SEO schema, `welcome-sequence.ts` email) reads from this one object rather than
duplicating copy, so the underselling propagated everywhere at once, SEO/AI-answer-engine
metadata included.

But the actual shipped product genuinely implements **four** catalyst classes, verified directly
in code:
- `src/features/meridian/lib/meridian-types.ts`: `export type MeridianEventKind = "macro" |
  "earnings" | "opex" | "fda";` — with distinct, event-specific detail types for each
  (`MeridianFdaDetail`, `MeridianOpexDetail`, `MeridianMacroBrief`, `MeridianEarningsDetail`).
- `src/features/meridian/components/MeridianDesk.tsx` (lines 338-342): dedicated filter chips for
  Macro, FDA, and OpEx alongside Earnings.
- `src/features/meridian/components/MeridianEventDetailPanel.tsx`: genuinely different render
  branches per event kind (`detail?.kind === "macro"`, `"opex"`, `"fda"`, `"earnings"`), plus
  dedicated panel components (`MeridianMacroReportPanel.tsx`,
  `MeridianOpexCrossMarketPanel.tsx`) and lib modules per kind.

Meridian's own Academy guide (`articles.ts`, `meridian-earnings-desk-guide`) already documented
this correctly — "It's not earnings-only: four catalyst kinds share the same rail — earnings,
macro releases, OpEx, and FDA decision dates" — meaning the guide was accurate and the manifest
was the stale side, the opposite pattern from the Thermal/Vector finding shipped earlier today.
One additional hand-duplicated exception existed outside the manifest chain: `about/page.tsx`
line 36 independently repeated "Earnings intelligence" prose rather than sourcing the manifest.

### Evidence

Code-verified: `MeridianEventKind` union has 4 members; `MeridianTimelineStats`
(`meridian-snapshot.ts`) computes independent counts for `macro`, `earnings`, `fda`, `opex`; the
UI ships 4 distinct filter chips and 4 distinct detail-panel render branches. `grep -rn "Earnings
intelligence" src` (pre-fix) found exactly two hits: the manifest and the About page — the two
surfaces this fix corrects.

RED (`git stash` on `product-manifest.ts` + `about/page.tsx`, tests kept applied): 1/12 tests in
`product-manifest-consistency.test.ts` fail — the new test correctly flags the earnings-only
framing. GREEN after restoring: 12/12 pass. `npx tsc --noEmit` clean. Re-ran
`upsell-features.test.ts`, `plan-matrix.test.ts`, `faq/content.test.ts`, `JsonLd.ssr.test.ts`,
`welcome-sequence.test.ts` — 29/29 pass, no regression (none of these hardcode the old
"Earnings intelligence" tag; all derive from the manifest object).

### Fix

Updated `PRODUCT_MANIFEST.meridian`: `tag` → "Catalyst intelligence"; `positioning`/`lifecycle`/
`capabilities`/`faqAnswer` now explicitly name earnings, macro, OpEx, and FDA, with earnings kept
as the deepest workflow (five-tab sub-desk) rather than implied to be the entire scope —
matching the user's exact recommended framing. `planInclude` updated to "Meridian catalyst desk"
(already used internally in `src/lib/largo/platform-links.ts`, confirming this is the product's
real internal name, not new terminology invented for this fix). Synced the hand-duplicated
`about/page.tsx` line to match. Added `"Earnings intelligence"` to `BANNED_PUBLIC_MARKETING_PHRASES`
and added `about/page.tsx` to the `PUBLIC_SURFACES` list the existing banned-phrase test scans, so
this specific stale phrase can no longer reappear on any public marketing surface undetected.
Added a dedicated regression test asserting the manifest's `lifecycle`/`capabilities`/`faqAnswer`
each mention macro, OpEx, and FDA.

### Blast radius

One manifest entry (6 fields) plus one hand-duplicated About-page line plus two small test-file
additions. Every downstream consumer (homepage card, pricing matrix, SEO schema, marketing email)
inherits the corrected copy automatically via the manifest — none needed direct edits. Meridian's
own Academy guide and its article-FAQ answer ("What is the Meridian earnings desk?") were already
accurate and needed no change — confirmed by reading `article-faqs.ts` lines 648-657 directly.

### Fix rationale

Broaden the manifest to match the code-verified reality (four catalyst classes) rather than
narrow the guide/code to match the manifest — the code is unambiguous (a real 4-member type union
with per-kind UI and detail panels), and the Academy guide already had this right, so there was
no genuine ambiguity to resolve. Kept earnings framed as the deepest workflow (its own five-tab
sub-desk) per the user's explicit guidance, rather than flattening all four classes to equal
weight — earnings genuinely does get materially more product depth than the other three.

### What was deliberately left unchanged

Did not touch Meridian's Academy guide content (`articles.ts`) or its FAQ answer
(`article-faqs.ts`) — both were already accurate and are the source the manifest fix was checked
against, not something needing correction. Did not rename the `meridian-earnings-desk-guide`
article slug or its URL (`learnHref` still points to `/learn/meridian-earnings-desk-guide`) —
changing a live, indexed URL slug is a separate SEO-risk decision out of scope for a P3 copy fix;
the guide's own title/content already correctly describe the broader catalyst scope regardless of
its slug. Did not add a general "manifest capability audit" test beyond Meridian's specific
four-class assertion — that's a broader content-contract-testing investment the user's
recommendation gestures at ("a content-contract test ensuring the public capability manifest
cannot omit active top-level event classes") but is better scoped as its own follow-up once a
pattern emerges across more than one product, rather than speculatively generalized here.
