## 2026-10-12 — [Email] Welcome-sequence Day 4 email's "other N" count didn't match its own table — FIXED
> **kind:** `FINDING`

| **Area** | **Severity** | **Status** |
|---|---|---|
| Email / member-facing copy | P3 — cosmetic, drip-campaign copy, not transactional | FIXED |

**What's wrong.** `src/lib/email/templates/welcome-sequence.ts`'s Day 4 "tool tour" step (step 3,
`delayDays: 4`) opened with:
```
Four days ago we handed you the gamma read ... That was one tool. Here's the other ${manifestProductCount() - 1}.
```
`manifestProductCount() - 1` evaluates to **6**, but the `engines` table immediately below it
(the same `build` function's own `engines` array) lists all **7** current live products —
SPX Slayer, Thermal, HELIX, Night Hawk, Largo AI, Vector, Meridian — including a full
description of whichever tool the "-1" was meant to exclude. The stated count and the rendered
table disagreed.

**Same bug class as an already-fixed sibling.** `welcome-premium.ts`/`downgrade.ts` had an
identical shape of bug (a hardcoded stale count contradicting the body copy), fixed in
`welcome-premium-downgrade-product-count.test.ts` (commit `1b215b184`). This instance used a
dynamic expression (`manifestProductCount() - 1`) rather than a hardcoded literal, but the
subtraction itself had no real basis — Day 0's email (step 1, `delayDays: 0`) introduces the
desk as a general concept ("dealer gamma exposure, live institutional options flow, and dark
pool prints"), not one specific named tool, so there was never a clean "the one already shown"
to subtract.

**Fix.** Reworded to avoid the unsupported subtraction and tied the stated count directly to the
table's own length (`engines.length`) instead of an independent expression that could drift from
it again: *"That's one piece of a bigger board. Here's the whole thing: all `${engines.length}`."*

**Regression guard added.** New `src/lib/email/templates/welcome-sequence-day4-product-count.test.ts`
(none existed for this step): asserts the stated count matches `manifestProductCount()`, and that
every live product name appears in the rendered table. Verified RED→GREEN: reverting just the
copy fix fails the count assertion (1 pass / 1 fail); restoring it passes (2/2).

**Verification.** Full email-templates suite (`src/lib/email/templates/*.test.ts
src/lib/welcome-sequence.test.ts`) → 24/24 pass. `tsc --noEmit` clean.

**Blast radius.** This one email step's opening paragraph only.

Found via a background Explore-agent sweep of email templates and Learn content, independently
re-verified (the exact subtraction, the table's real item count, and that Day 0's email doesn't
name one specific tool to subtract) before fixing.
