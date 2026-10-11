## `whop-checkout.ts`'s missing-env-var warning was defeated whenever the legacy var was set, silencing a real blind spot that could drop paid checkout options from the upgrade page — FIXED

> **kind:** `FINDING`

| Field | Detail |
|---|---|
| **Status** | FIXED |
| **Severity** | P2 (money-facing config-validation gap — no live incident confirmed this session, but the failure mode directly affects which paid plans are purchasable, with the one diagnostic designed to catch it silenced) |
| **Component** | `src/lib/whop-checkout.ts` — feeds `WHOP_PREMIUM_CHECKOUT_OPTIONS`/`WHOP_COMMUNITY_CHECKOUT_OPTION`, consumed by `src/components/upgrade/PlanLadder.tsx` and `src/lib/upsell-features.ts` |

### Root cause

`WHOP_CHECKOUT` builds 4 checkout URLs from env vars, and only 2 of the 4 (`monthly`, `store`) actually fall back to a legacy var (`NEXT_PUBLIC_WHOP_CHECKOUT_PRO`) when unset — `yearly` and `community` fall back to `""` unconditionally, with no legacy equivalent:

```ts
export const WHOP_CHECKOUT = {
  community: process.env.NEXT_PUBLIC_WHOP_CHECKOUT_COMMUNITY ?? "",   // NO legacy fallback
  monthly: process.env.NEXT_PUBLIC_WHOP_CHECKOUT_MONTHLY ?? legacyCheckout,
  yearly: process.env.NEXT_PUBLIC_WHOP_CHECKOUT_YEARLY ?? "",          // NO legacy fallback
  store: process.env.NEXT_PUBLIC_WHOP_STORE_URL ?? legacyCheckout,
};
```

But the missing-var diagnostic above it used one blanket condition for all 4 vars:

```ts
const missingVars = Object.entries(requiredVars)
  .filter(([, v]) => !v && !legacyCheckout)
  .map(([k]) => k);
```

Once `legacyCheckout` is truthy (set), `!legacyCheckout` is `false` for every entry, so the filter predicate is `false` across the board regardless of whether `yearly`/`community` are actually empty — the `console.warn` never fires even though those two vars have no legacy fallback and are genuinely unconfigured.

### Concrete trigger

A partial legacy-var migration: ops sets only `NEXT_PUBLIC_WHOP_CHECKOUT_PRO` (documented as "legacy") and leaves `NEXT_PUBLIC_WHOP_CHECKOUT_YEARLY`/`NEXT_PUBLIC_WHOP_CHECKOUT_COMMUNITY` unset — a plausible real-world sequencing during migration. With `legacyCheckout` now truthy, the warning is silenced entirely while:
- `WHOP_PREMIUM_CHECKOUT_OPTIONS` (filters by truthy `href`) silently drops the Yearly $1,999 option — only Monthly shows.
- `WHOP_COMMUNITY_CHECKOUT_OPTION` becomes `null` — the SPX Slayer ($49) checkout option disappears entirely from the upgrade page.

The file's own comment states the guard exists "so the missing-config issue is visible in logs rather than silently producing an empty upgrade page" — the bug defeated exactly that purpose, in exactly the scenario it was built to catch.

### Evidence

Confirmed live consumers via grep: `WHOP_PREMIUM_CHECKOUT_OPTIONS`/`WHOP_COMMUNITY_CHECKOUT_OPTION` are read by `src/components/upgrade/PlanLadder.tsx` and `src/lib/upsell-features.ts`. No test file existed for `whop-checkout.ts` before this fix — the bug was unverified by anything in CI. RED→GREEN: with the pre-fix blanket filter restored, the new regression test's "partial legacy migration" case fails (1 fail/3 pass); with the fix, 4/4 pass. Full consumer test sweep (`whop-checkout.test.ts`, `HomeCommunityRail.test.ts`, `FeatureComparison.ssr.test.ts`, `link-targets.test.ts`, `product-manifest-consistency.test.ts`, `upsell-features.test.ts`): 35/35 pass. `tsc --noEmit` clean.

### Fix

Extracted the missing-var computation into a pure, exported, testable function (`missingWhopCheckoutVars(env)`) and replaced the blanket `!legacyCheckout` check with a per-var lookup (`CHECKOUT_VAR_HAS_LEGACY_FALLBACK`) that mirrors `WHOP_CHECKOUT`'s own fallback logic exactly: `monthly`/`store` are only "missing" when both the var and the legacy fallback are unset; `yearly`/`community` are "missing" purely on their own value, since no legacy fallback ever applies to them.

### Fix rationale

Mirrored the real fallback shape from `WHOP_CHECKOUT` itself rather than inventing new logic — the diagnostic's job is to describe what the assignment below it actually does, so the two must share the same per-var fallback map. Extracting the pure function (rather than leaving the check inline) was necessary to make this testable at all: the original code computed everything at module-load time against `process.env` with no injectable seam.

### Blast radius

Single file (`whop-checkout.ts`). `WHOP_CHECKOUT`'s own assignment logic is untouched — this fix only corrects which vars the diagnostic warning flags as missing; it does not change which URLs end up populated. No other file was touched.

### Regression guard

New test file `src/lib/whop-checkout.test.ts` (4 tests, previously none existed): all-unset, the specific partial-legacy-migration repro, fully-covered-via-legacy, and fully-explicit-no-legacy cases. RED→GREEN proved directly (not `git stash`, since testing the pure function required the refactor itself): reverted `missingWhopCheckoutVars`'s body to the old blanket-`!legacyCheckout` logic, confirmed the regression test for the exact live-bug scenario fails (1 fail/3 pass), restored the fix, back to 4/4.
