> **kind:** FINDING

## Ga4ConversionTracker never fired a purchase conversion for a tier UPGRADE (community → premium) — FIXED

**Status:** FIXED (`fix/ga4-purchase-upgrade-never-fires`)

### Root cause

`src/components/analytics/Ga4ConversionTracker.tsx` (mounted globally, once per signed-in member,
in `AppShellProviders.tsx`) is supposed to fire a `purchase` conversion to GA4, the X pixel, and
Google Ads whenever a member's tier crosses into a paid tier — including an UPGRADE from one paid
tier to a higher one. The gate guarding that fire was:

```ts
const nowPaid = tierAtLeast(current, "community");
const wasPaid = previous ? tierAtLeast(previous, "community") : false;
if (!nowPaid || wasPaid) return;
```

i.e. "fire only if the member is paid now **and was not already on some paid tier before**." That
correctly catches `free → community` and `free → premium`, but a member already on `community`
also satisfies `tierAtLeast(previous, "community")` — so `wasPaid` was already `true` the instant
they upgraded to `premium`. The exact, real-money case this breaks: a member paying $49/mo on SPX
Slayer (`community`) who upgrades to Premium Yearly ($1,999) never fires **any** purchase
conversion for that upgrade — not the GA4 `purchase` event, not the X pixel event, not the Google
Ads conversion — because the function returns before reaching any of that code.

This is not a hypothetical gap the surrounding code was unaware of. `purchaseTransactionId`
(`src/lib/analytics/google-ads.ts`) exists *specifically* to let an upgrade book as its own
distinct, higher-value purchase instead of being deduped by Google Ads against the member's first
purchase — its own doc comment names "community → yearly" as the motivating case:

> "The pre-existing GA4 tracker used the bare userId. That is stable across a member's lifetime, so
> an upgrade (community → yearly) carries the same id as the original purchase and Google dedupes
> the upgrade away — the highest-value conversions in the funnel are exactly the ones that would go
> uncounted."

That fix was unreachable in production: the `wasPaid` gate above it never let an upgrade's effect
run reach `purchaseTransactionId` at all, so the tier-qualified id it was built to supply was dead
code for its own stated purpose. Every real tier upgrade since this shipped has gone completely
uncounted in GA4/Google Ads/X analytics — a live, ongoing (not historical/one-off) revenue-
attribution gap on exactly the highest-value conversions in the funnel.

A second, compounding bug sits one line below: `hasPurchaseFired(userId)` / `markPurchaseFired(userId)`
key the "already fired" flag by the bare `userId` in `localStorage`, permanently, for the member's
lifetime. Even after fixing the `wasPaid` gate above, this flag — set the very first time the
member ever reached a paid tier — would still have silently blocked every later upgrade's purchase
conversion from firing, because it was never scoped to which tier the purchase was actually for.

### Evidence

- `src/components/analytics/Ga4ConversionTracker.tsx` (pre-fix): `if (!nowPaid || wasPaid) return;`
  — `previous = "community"`, `current = "premium"` → `tierAtLeast("community", "community") === true`
  → `wasPaid === true` → early return, before any of `trackGa4Event`, `trackXEvent`, or
  `trackGoogleAdsConversion` ever run.
- `src/lib/analytics/google-ads.ts:187-198` (`purchaseTransactionId`'s own doc comment) explicitly
  names the community → yearly upgrade as the case it exists to fix, confirming the gap is a defect
  against stated intent, not an accepted limitation.
- `src/lib/analytics/ga4-client.ts:117-136` — `hasPurchaseFired`/`markPurchaseFired` store
  `bo_ga4_purchase_fired:${userId}` with no tier in the key and no code path that ever clears it.
- RED→GREEN: `src/lib/analytics/purchase-tracking.test.ts`, new pure-function tests. The RED proof
  (`/tmp` scratch repro of the exact old gate, not committed) shows `oldShouldFire("premium",
  "community")` returning `false` — confirming the upgrade case was swallowed — while the new
  `shouldFirePurchaseConversion("premium", "community")` returns `true`, matching the fix. All 8
  new tests pass GREEN against the fixed code; `tsc --noEmit` is clean; the full
  `ga4-client.test.ts` / `google-ads.test.ts` / `checkout-plans.test.ts` / `tiers.test.ts` suites
  (45 tests total) still pass unchanged — no regression to the free→paid, no-op, or downgrade
  cases, or to the existing `parseTier`-vs-`resolveDisplayTier` admin-false-fire guard those tests
  pin.

### Blast radius

Single consumer: `Ga4ConversionTracker` is the only caller of the old gate logic and the only
caller of `hasPurchaseFired`/`markPurchaseFired` (grep-confirmed — no other call sites in
`src/`). `purchaseTransactionId`, `purchaseValueUsd`, `readRememberedPlan`/`rememberCheckoutPlan`,
and the GA4/X/Google-Ads event-sending plumbing itself are all unchanged — this fix only changes
*when* that existing, already-correct plumbing is allowed to run.

### Fix rationale

Extracted the decision into a pure, directly-testable function,
`shouldFirePurchaseConversion(current, previous)` (`src/lib/analytics/purchase-tracking.ts`),
which fires whenever tier RANK increases (`TIER_RANK[current] > TIER_RANK[previous]`, or
`previous === null` on the component's first observed tick) and lands at or above `community` —
not merely whenever "paid now and wasn't paid at all before." This preserves every previously-
correct case (free→community, free→premium, no-op re-renders at the same tier, downgrades never
firing) while fixing the one case that was silently broken (community→premium).

Paired it with `purchaseFiredKey(userId, tier)`, scoping the "already fired" flag per tier reached
instead of per member for life, so the newly-reachable upgrade path isn't immediately re-blocked by
a flag the member's *first* purchase already set. `hasPurchaseFired`/`markPurchaseFired` themselves
were left unchanged (they already accept an arbitrary string key, confirmed by
`ga4-client.test.ts`'s existing "scoped per user" tests using plain string ids) — only the key the
caller builds changed.

Left unchanged: the GA4 `purchase` event's own `transaction_id: userId` (still bare, not
tier-qualified) — that is a separate, more speculative claim about GA4's own dedup behavior that
the code's comments do not establish as broken the same way `purchaseTransactionId`'s comment
establishes the Google Ads case; not touched here to keep this a single, well-evidenced fix.
`parseTier` (vs. `resolveDisplayTier`) is still used deliberately for the admin-false-fire guard
documented in `tiers.ts` — untouched, and still covered by `tiers.test.ts`.
