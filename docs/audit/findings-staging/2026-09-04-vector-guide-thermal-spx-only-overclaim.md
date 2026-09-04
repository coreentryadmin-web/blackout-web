## 2026-09-04 — [P3, product-contract] Vector Academy guide falsely framed Thermal as SPX-only — FIXED

> **kind:** `FINDING`

| | |
|---|---|
| **Severity** | P3 — product-boundary/positioning inaccuracy in onboarding content, not a data-correctness bug. Left unfixed it either misleads members about Thermal's real capability, or (if actually true) would mean the homepage's "multi-ticker" claim was overselling — this fix resolves the ambiguity in favor of the code-verified truth. |
| **Found by** | User report (operator), independently confirmed against `src/lib/heatmap-allowlist.ts`, `src/app/api/market/gex-heatmap/route.ts`, and `src/features/thermal/components/GexHeatmap.tsx` |
| **Status** | FIXED |

### Root cause

The Vector Academy guide (`src/lib/learn/articles.ts`, `vector-scanner-guide` article) claimed:

> "[SPX Slayer] and [Thermal] focus on SPX. **Vector** extends the same dealer gamma exposure
> framework across the **entire universe**... If Thermal is the microscope on SPX's gamma
> structure, Vector is the radar dish scanning the broader market."

and later:

> "[Thermal] gives you the deep heatmap for SPX."

Both statements imply Thermal is SPX-only. That's false, verified directly against the shipped
code:
- `src/app/api/market/gex-heatmap/route.ts` (line ~302-307) accepts any 1-8 char ticker symbol —
  no SPX-only gate. The route's own comment states the matrix "is fine for ANY ticker."
- `src/lib/heatmap-allowlist.ts`'s `HEATMAP_PRESET_TICKERS` lists 11 one-click UI presets
  spanning indices AND single names (SPY, SPX, QQQ, IWM, NVDA, TSLA, AAPL, AMD, META, AMZN,
  GOOGL), plus a ~40-name extended allowlist for UW overlay eligibility — none of it SPX-only.
- `src/features/thermal/components/GexHeatmap.tsx` ships the same 11-ticker preset list plus a
  live ticker-search box for arbitrary symbols beyond the presets.

This directly contradicted the homepage's own accurate framing —
`PRODUCT_MANIFEST.thermal.lifecycle` (`src/lib/marketing/product-manifest.ts`) already reads
"Multi-ticker GEX/VEX/DEX/CHARM matrix..." — meaning the Academy guide and the homepage were
making opposite claims about the same product, exactly the class of drift the user's report
flagged: the Vector guide was hand-authored prose, never checked against the canonical product
manifest or Thermal's real route/UI behavior. SPX Slayer, by contrast, genuinely IS SPX/SPXW-only
(its own manifest entry confirms this) — the guide's error was specifically in lumping Thermal in
with SPX Slayer's real restriction, not in describing SPX Slayer itself.

### Evidence

Code-verified: `HEATMAP_PRESET_TICKERS.length === 11`, includes non-index single names (NVDA,
TSLA, AAPL, AMD, META, AMZN, GOOGL) — confirmed live in `heatmap-allowlist.ts`.
`grep -i "focus on spx" src/lib/learn/articles.ts` (pre-fix) returned exactly one match, the
Vector guide's own claim — no other article made this error.

RED (`git stash` on `articles.ts` only, test kept applied): 1/2 tests in the new
`thermal-ticker-scope-consistency.test.ts` fail, flagging `vector-scanner-guide`. GREEN after
restoring: 2/2 pass. `npx tsc --noEmit` clean. Re-ran the full existing Learn-content test
surface (`guide-faqs`, `grading-policy-consistency`, `metatitle-length`, `article-faqs`,
`articles`, `related-articles`, `guide-seo`, `article-dates`, `no-execution-claims`) — 31/31 pass
across 8 suites, no regression.

### Fix

Corrected both Vector-guide passages to reflect Thermal's real multi-ticker capability while
preserving Vector's accurate, distinct value prop (automated universe-wide scanning vs. Thermal's
one-ticker-at-a-time deep dive):
- "SPX Slayer is built around SPX specifically. Thermal goes deep on whichever ticker you
  select — SPY, SPX, QQQ, and dozens more, one at a time. Vector extends the same... framework
  across the entire universe at once... with no ticker to pick first. If Thermal is the
  microscope you point at one name, Vector is the radar dish scanning the whole board
  automatically."
- "Thermal gives you the deep heatmap for whichever ticker you pick."

Added `src/lib/learn/thermal-ticker-scope-consistency.test.ts`: one test that grounds the fix in
real code (`HEATMAP_PRESET_TICKERS` has more than one entry and includes non-index names), and
one regression test (following the existing `no-execution-claims.test.ts` banned-phrase pattern)
that fails if any Learn article body reframes Thermal as SPX-only again.

### Blast radius

Two paragraphs in one article (`vector-scanner-guide`) plus one new test file. SPX Slayer's own
description ("SPX Slayer is built around SPX specifically" / "SPX Slayer executes on SPX") was
left untouched — that claim is accurate and confirmed by its own manifest entry. No other
Thermal-related copy (the dedicated Thermal guide, homepage, pricing, FAQ) needed correction —
they already framed Thermal accurately; only the Vector guide's differentiation language was
wrong.

### Fix rationale

Correct the guide to match the code-verified truth (Thermal is multi-ticker) rather than the
alternative of narrowing the homepage's multi-ticker claim — the code is unambiguous (route
accepts any ticker, 11 real presets, live ticker search), so there was no genuine ambiguity to
resolve by picking a side; only the guide was wrong. Kept Vector's actual differentiator
("universe-wide" and "automatic," no manual ticker selection) intact and accurate — that part of
the original copy was correct and not in conflict with Thermal's multi-ticker reality.

### What was deliberately left unchanged

Did not reconcile the secondary Thermal-guide-URL duplication the investigation also surfaced
(the Vector guide links to `/learn/heat-maps` and `/learn/thermal-four-lenses-explained`, two
different valid Thermal-related pages, neither matching the canonical manifest `learnHref` of
`/learn/thermal-heatmap-reading-guide`) — both links are live, real content, not broken, and
picking a single canonical Thermal guide page is a separate IA decision out of scope for this
P3 copy-accuracy fix.
