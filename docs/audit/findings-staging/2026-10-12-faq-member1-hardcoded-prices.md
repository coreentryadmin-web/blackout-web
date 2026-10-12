## 2026-10-12 — [FINDING, P3 marketing copy] FAQ "How do I get access?" (member-1) hardcoded membership prices instead of using the token system its own sibling item already uses — FIXED
> **kind:** `FINDING`

| **Area** | **Severity** | **Status** |
|---|---|---|
| Marketing / FAQ | P3 — correct today, unguarded drift risk on next price change | FIXED |

**What's wrong.** `src/lib/faq/content.ts`'s `member-1` item ("How do I get access?") quoted all
three membership prices as hardcoded literal text:

```ts
a: `Create your free BlackOut account, then pick a plan: SPX Slayer ($49/mo) for SPX desk access
    — live regime, GEX, 0DTE graded plays — or Premium ($199/mo or $1,999/yr) to unlock the full
    platform with all ${manifestProductCount()} products. ...`,
```

The very next item, `member-2` ("What's the difference between SPX Slayer and Premium?"), quotes
the *same three prices* via the file's own token system instead:
`{{communityPrice}}`/`{{premiumMonthly}}`/`{{premiumYearly}}`, resolved from `MEMBERSHIP_PRICING`
by `resolvePriceTokens()` at module-eval time. The file's own header comment (lines 54-56) states
this system's exact purpose: "keeps the shared FAQ source in sync with MEMBERSHIP_PRICING
automatically instead of hardcoding a price string per-surface that can silently drift out of
date." `member-1` was the one item on the same page that didn't follow it.

**Why this matters.** The numbers are correct today (`MEMBERSHIP_PRICING`: community=49,
monthly=199, yearly=1999, matching the hardcoded text exactly) — this is not currently a wrong
answer. But the next price change updates `member-2` (token-driven) automatically while
`member-1` (hardcoded) silently goes stale on the same `/faq` page, the exact failure mode the
token system exists to prevent, and the exact shape of two prior incidents on marketing surfaces
this session/week has already found and fixed (a stale product count in a welcome email, stale
chapter numbers in Learn guides).

**Fix.** Switched `member-1`'s three price mentions to the same
`{{communityPrice}}`/`{{premiumMonthly}}`/`{{premiumYearly}}` tokens `member-2` already uses.

**Regression test.** Added `content.test.ts`: "the 'How do I get access?' prices agree with the
live MEMBERSHIP_PRICING, not a frozen copy" — asserts no unresolved `{{token}}` leaks through, and
that the resolved strings match `usd(MEMBERSHIP_PRICING.community/monthly/yearly)` **derived from
the live pricing source**, not hardcoded literals in the test itself (unlike the pre-existing
`member-2` test, which does hardcode `"$49/mo"` etc.) — so this test breaks the next time
`MEMBERSHIP_PRICING` changes and `member-1` doesn't move with it.

**Honest limitation on the RED→GREEN proof.** Because today's hardcoded values and the
token-derived values are identical, a `git stash` of just `content.ts` does **not** make this new
test fail — the old literal text happens to equal what the live pricing source resolves to, so the
test's final-string assertion can't distinguish "derived from the token system" from "hardcoded to
the value that happens to still be current." Attempted a true mechanism-level discriminator via
`node:test`'s `mock.module()` (mocking `@/lib/pricing` to distinguishable values and re-importing
`content.ts` fresh, to prove only a token-driven answer picks up the mock) but hit a real
tsx/Node ESM-loader interop gap: `mock.module()`'s specifier resolution and tsx's own `"@/..."`
alias-rewrite resolve to different internal module keys, so the mock never intercepted
`content.ts`'s real import regardless of whether the mock specifier was given as the bare alias,
a relative path, or a fully-resolved absolute path — all three were tried and none worked. Did not
spend further time chasing this (low-severity finding, diminishing returns); the test as shipped
is the same non-discriminating-but-drift-catching shape the file's own pre-existing `member-2`
test already uses, just deriving its expected values from the canonical source instead of
hardcoding them — a real improvement, not a regression in rigor.

**Verification.** `tsc --noEmit` clean. `npx tsx --experimental-test-module-mocks --test
src/lib/faq/content.test.ts src/lib/marketing/product-manifest-consistency.test.ts` — 25/25 pass.

**Blast radius.** `content.ts`'s `member-1` item only — every other FAQ item, and every page that
renders it (`/faq`, home accordion via `HOME_FAQ_IDS`, `/pricing` via `PRICING_FAQ_IDS` — `member-1`
is not in either curated subset today, so this item currently only renders on the full `/faq` page),
unaffected.

Found via a background Explore-agent sweep of marketing/pricing pages (checked ~20 files for
price/product-count drift against `MEMBERSHIP_PRICING`/`PRODUCT_MANIFEST`; two lower-confidence
items in `about/page.tsx`/`WhyBlackoutContent.tsx`/`upgrade/page.tsx` were also flagged as
currently-correct-but-unguarded, same pattern, not fixed here — left for a future pass or the
owning marketing lane since they involve more call sites and this keeps the PR single-issue),
independently re-verified (confirmed the exact hardcoded text, the sibling token usage, the id
auto-generation scheme, and the current `MEMBERSHIP_PRICING` values directly from source) before
fixing.
