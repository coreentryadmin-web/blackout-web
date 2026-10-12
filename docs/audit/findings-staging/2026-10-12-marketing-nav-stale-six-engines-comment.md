## 2026-10-12 — [Marketing] Stale "Six engines" anchor comment in StaticMarketingNav.tsx — FIXED
> **kind:** `FINDING`

| **Area** | **Severity** | **Status** |
|---|---|---|
| Marketing/SEO | P3 — dev-facing doc only, not user-visible | FIXED |

**What's wrong.** `src/components/landing/StaticMarketingNav.tsx:7` carried a code comment
documenting the `#modules` anchor's heading as the literal string `"Six engines. One edge."`.
The real heading (`RedesignHome.tsx:122`) is `{modulesHeadline}<br />One edge.`, where
`modulesHeadline` comes from `marketingModulesHeadline()` → `manifestModulesHeadline()`
(`product-manifest.ts:216-219`), which derives dynamically from the live product count
(currently 7 products: spx/helix/thermal/largo/hawk/vector/meridian → renders "Seven
products."). "Six engines" is also one of the strings in `BANNED_PUBLIC_MARKETING_PHRASES`
(`product-manifest.ts:248`) — i.e. it was deliberately scrubbed from real marketing copy at
some point but left behind in this comment, which documents the anchor contract for future
editors and could cause someone to "fix" the real copy to match the stale comment instead of
the other way around.

**Why it wasn't caught by the existing guard.** `product-manifest-consistency.test.ts`'s
`PUBLIC_SURFACES` banned-phrase scan (the mechanism that's kept every OTHER banned phrase out
of real marketing copy — see FINDINGS entries from 2026-08/09 adding "six trading modules"
and "Earnings intelligence" to the ban list) does not include `StaticMarketingNav.tsx` — only
files with actual rendered user-facing copy are in that list. This comment is dev
documentation, not rendered copy, so it fell outside the scan's intended scope — not a gap in
the scan logic itself.

**Fix.** Rewrote the comment to describe the headline as dynamic (`<N> products. One edge.`,
scaling with the live manifest count) instead of quoting a fixed string. Added
`StaticMarketingNav.tsx` to `PUBLIC_SURFACES` in `product-manifest-consistency.test.ts` so a
future stale/banned phrase re-introduced into this file's source (comment or otherwise) is
caught the same way it already is everywhere else. Verified RED→GREEN: reverting the comment
alone made `"public marketing surfaces do not contain banned absolute/stale phrases"` fail on
`"Six engines"`; the fix make it pass (16/16 in that test file).

**Note on the fix-of-the-fix.** First draft of the new comment explained the ban by literally
naming the banned phrases ("Six engines"/"six modules" are stale...) — which itself tripped
the same banned-phrase scan on "six modules" (the scan is a case-insensitive substring match,
so it doesn't distinguish "this phrase is banned" from using the phrase). Rewrote to describe
the mechanism without quoting any banned string.

**Blast radius.** None — comment-only change plus one test-file addition. No rendered output
changes.

**Verification.** `npx tsx --experimental-test-module-mocks --test
src/lib/marketing/product-manifest-consistency.test.ts` → 16/16 pass.

Found via a background Explore-agent sweep of the marketing/SEO surface, independently
re-verified (exact file/line, the real `#modules` heading, `manifestModulesHeadline()`'s
derivation, and the `BANNED_PUBLIC_MARKETING_PHRASES` entry) before fixing.
