> **kind:** `FINDING`

## `accessEndedEmail`'s closing re-engagement line undercounts the Premium stack as six engines instead of seven — FIXED

| | |
|---|---|
| **Severity** | P3 (member-facing copy defect, not a money-path/data-correctness bug — undersells what re-subscribing to Premium actually gets) |
| **Surface** | `src/lib/email/templates/access-ended.ts` — the full-cancellation lifecycle email's closing re-engagement paragraph |
| **Status** | FIXED |

### Root cause

`accessEndedEmail`'s third (closing) paragraph is shared across both tiers — it is NOT gated by
`ctx.previousTier` the way the opening paragraph is — and reads:

> "...same door, wide open — SPX Slayer for the 0DTE desk, Premium for the full **six-engine
> stack**."

Premium is the 0DTE desk (SPX Slayer) **plus** the other six engines (Thermal, HELIX, Night Hawk,
Largo AI, Vector, Meridian) — **seven** products total, exactly as:

- `welcomePremiumEmail`'s own subject states it: `"Full desk unlocked. All seven products, live."`
- the same file's shared paragraph states it: `"...access is identical, full seven-product desk,
  no walls between you and any of it."`
- `access-ended.ts`'s own top-of-function doc comment states it: `"a Premium member loses the
  whole seven-product desk"` (the comment that was added when `previousTier` personalization was
  wired in — the opening paragraph was fixed to say "the other six engines... all gone at once",
  but the closing paragraph's "six-engine stack" phrase, describing the WHOLE Premium stack rather
  than "the other six", was never caught).
- `scheduled-cancel-tier-blind.test.ts`'s own comment: `"a premium one keeps the full
  seven-engine list"`.

Every sibling lifecycle template follows one consistent convention: **"six" always names the six
OTHER engines beyond the 0DTE desk a member already has** (`welcome-premium.ts`'s "six more
engines", `downgrade.ts`'s "six engines went dark", `scheduled-cancel.ts`'s "those six engines
stay live") — never the whole Premium stack *including* the 0DTE desk itself, which is always
"seven". `access-ended.ts`'s closing line broke that convention by applying "six" to the whole
stack, undercounting Premium's real entitlement by one product in the exact sentence meant to
entice a lapsed member back.

This is the same bug class `welcome-premium-downgrade-product-count.test.ts` already caught once
(stale "five more engines"/"five engines" counts left behind when Meridian shipped as the 7th
product, commit `5103e7f8d`) — this time in a template that was edited later (the `previousTier`
personalization work, round 106) without the editor re-deriving the closing paragraph's own count
against the same convention.

### Evidence

New test `src/lib/email/templates/access-ended-reengagement-engine-count.test.ts`:

- `"accessEndedEmail: the re-engagement line calls Premium the full seven-engine stack, not six"` —
  asserts the Premium-cancellation render contains `"Premium for the full seven-engine stack"` and
  does NOT contain `"full six-engine stack"`.
- `"accessEndedEmail: the same (shared, not tier-gated) re-engagement line is correct for a
  community cancellation too"` — same assertions for a community-cancellation render, since this
  paragraph is identical across both tiers.

RED→GREEN confirmed: both tests fail against the pre-fix file (`assert.match` on
`/Premium for the full seven-engine stack/` fails — the live text was "six-engine stack") and pass
once `access-ended.ts`'s string is corrected. Full template suite
(`src/lib/email/templates/*.test.ts`, 26 tests across every lifecycle email) passes post-fix.
`npx tsc --noEmit` clean.

### Blast radius

`access-ended.ts` has exactly one export (`accessEndedEmail`) and one call site
(`billing-lifecycle-email.ts`'s `dispatchTransitionEmail`, on a full Whop cancellation). The
closing paragraph is a single literal string with no other consumer. No other template shares this
exact string (verified by grep across `src/lib/email/templates/*.ts`).

### Fix

Changed the one word: `"the full six-engine stack"` → `"the full seven-engine stack"` in
`access-ended.ts`'s closing paragraph. No other text, gating, or logic touched.

### Fix rationale

The minimal, surgical correction — this is a literal miscount in otherwise-correct, already
carefully-personalized copy (the `previousTier`-gated opening paragraph is correct and untouched).
Considered also rewording the sentence structure, but the existing "SPX Slayer for X, Premium for
Y" parallel structure is fine; only the number was wrong.

### Tests

`src/lib/email/templates/access-ended-reengagement-engine-count.test.ts` (2 new tests, described
above). Full `src/lib/email/templates/*.test.ts` suite: 26/26 pass. `npx tsc --noEmit` clean
repo-wide.
