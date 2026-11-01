import { TIER_RANK, tierAtLeast, type Tier } from "@/lib/tiers";

/**
 * Whether `Ga4ConversionTracker` should fire a purchase-conversion event for this tier
 * transition. Pure + exported for direct unit testing (DOM/React-free) since the bug this fixes
 * only shows up in the DECISION, not in any DOM/localStorage plumbing around it.
 *
 * `current`/`previous` are read across ONE mount of the tracker — `previous` is `null` on the
 * very first effect run. A purchase should fire on ANY net INCREASE in tier rank that lands at or
 * above "community", not only the member's first-ever paid tier.
 *
 * BUG THIS FIXES: the previous gate was `const nowPaid = tierAtLeast(current, "community"); const
 * wasPaid = previous ? tierAtLeast(previous, "community") : false; if (!nowPaid || wasPaid)
 * return;` — i.e. "fire only if the member is paid now AND was not ALREADY paid before". That
 * correctly catches free -> community and free -> premium, but a member already on `community`
 * satisfies `tierAtLeast(previous, "community")` too, so `wasPaid` was already `true` the moment
 * they upgraded to `premium` — the exact community -> premium (yearly, $1,999) upgrade silently
 * never fired ANY purchase conversion (GA4, the X pixel, or Google Ads), forever, for that member.
 *
 * `purchaseTransactionId` (google-ads.ts) was built specifically so an upgrade books as its own
 * distinct, higher-value purchase instead of being deduped against the member's first purchase —
 * its own doc comment names "community -> yearly" as the motivating case — but that fix was
 * unreachable: the caller never got past the old gate above to use it. Comparing tier RANK
 * (`TIER_RANK[current] > TIER_RANK[previous]`) instead of "was any paid tier" fixes the gate so
 * every real upgrade reaches that code.
 */
export function shouldFirePurchaseConversion(current: Tier, previous: Tier | null): boolean {
  if (!tierAtLeast(current, "community")) return false;
  if (previous === null) return true;
  return TIER_RANK[current] > TIER_RANK[previous];
}

/**
 * The `hasPurchaseFired`/`markPurchaseFired` key for one (member, tier-being-purchased) pair.
 *
 * Keying by bare `userId` (the previous behavior) meant the member's FIRST purchase permanently
 * set a lifetime flag that then silently blocked firing a purchase conversion ever again for that
 * member — including for a later genuine upgrade, which is exactly the scenario
 * `shouldFirePurchaseConversion` above now correctly recognizes as a new purchase. Scoping the key
 * by tier (matching `purchaseTransactionId`'s own `userId:tier` key) lets each distinct tier
 * reached fire once, while still deduping a plain page refresh at the same tier.
 */
export function purchaseFiredKey(userId: string, tier: Tier): string {
  return `${userId}:${tier}`;
}
