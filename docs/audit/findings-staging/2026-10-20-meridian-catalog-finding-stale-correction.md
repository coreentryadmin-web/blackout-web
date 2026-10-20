> **kind:** FINDING

## Correction: "Meridian still missing from MARKETING_PRODUCTS" is stale — it shipped

| **Status** | Corrected (no code change — documentation correction only) |

**Found:** 2026-10-20, DISCOVERY-lane re-verification of older `FINDINGS.md` claims against current
code, via a background Explore-agent cross-check.

**What the original entry (`## Homepage product-catalog copy drifted from the shared manifest +
FAQ — FIXED (Meridian addition blocked on a missing asset)`, 2026-09-02, ~7 weeks old) says:** its
"NOT fixed here" section states Meridian is "still missing from `MARKETING_PRODUCTS` (still 6
entries, not 7)" because the homepage carousel requires a real screenshot per product and no real
Meridian capture existed yet — framed as a genuine blocker, not yet resolved.

**What's actually true now:** Meridian shipped as the 7th homepage/manifest module.
`src/lib/marketing/product-manifest.ts`'s `MANIFEST_PRODUCT_ORDER` lists 7 ids including
`"meridian"`, with a full entry (`learnHref: "/learn/meridian-earnings-desk-guide"`,
`href: "/meridian"`). `src/lib/marketing/products.ts` has complete `ACCENTS`/`HEADLINES`/`STATS`
entries for `meridian` (`"Catalyst timeline — earnings, macro, OpEx, and FDA."`, stat `{ k: "Live",
v: "catalyst desk" }`). The asset blocker the original entry named was resolved with a deliberate,
honestly-labeled workaround rather than waiting on a real screenshot:
`src/lib/images.ts:16-18` assigns Meridian the brand emblem (`/images/blackout-emblem.webp`) with an
explicit code comment calling it an honest placeholder pending a real capture — the same convention
used elsewhere in this file, not a silent stub. `manifestProductCount()` now correctly returns 7
(independently confirmed this same cycle by `product-manifest-consistency.test.ts`'s own existing
assertion and this cycle's `#6340` OG-alt-text fix).

**Why this matters:** this is exactly the staleness trap `CLAUDE.md`'s own "Ask Largo" section
warns about — a tracking entry that reads as an open blocker long after the underlying work shipped,
risking wasted effort re-investigating or re-planning something already done. Low severity (no
runtime impact, the real catalog has been correct for weeks), but worth correcting the record.

**Correction, not an edit:** per the standing issue-handling policy, the original 2026-09-02 entry
is left as-is (a historical record of what was true then) rather than edited in place — this entry
is the correction, same pattern `CLAUDE.md` itself uses for its own superseded claims.

**Blast radius:** documentation only. No code changed; the underlying shipping work (which PR(s)
actually added the Meridian manifest/products/image entries) predates this session's visibility and
isn't re-investigated here — only the current-state claim is corrected.

**Test:** none applicable — doc correction only. Verified directly against
`src/lib/marketing/product-manifest.ts`, `src/lib/marketing/products.ts`, and `src/lib/images.ts`
rather than trusting the background agent's report at face value.
