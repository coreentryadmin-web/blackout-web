## GA4/Google-Ads sign-up AND purchase conversions could be permanently lost on a fresh page load, before gtag had finished loading

> **kind:** `FINDING`

### Root cause

`src/components/analytics/Ga4Attribution.tsx`'s `/upgrade` signup block gated the whole
GA4-event / X-pixel / Google-Ads-conversion fire on:

```ts
if (
  (pathname === "/upgrade" || pathname.startsWith("/upgrade")) &&
  hasSessionCookie() &&
  consumePendingSignUp()
) {
  trackGa4Event(GA4_EVENTS.signUp, { page_path: pathname });
  trackXEvent("tw-re1j3-re9z9");
  trackGoogleAdsConversion("signup");
}
```

`consumePendingSignUp()` (`src/lib/analytics/ga4-client.ts`) is **destructive** — it removes the
`bo_ga4_pending_signup_v1` sessionStorage flag as a side effect of the gate check itself, before
any of the three tracking calls run. But `trackGa4Event`/`trackGoogleAdsConversion` both route
through `window.gtag`, which is loaded via `<Script strategy="afterInteractive">` in
`src/app/layout.tsx` — on a fresh, non-SPA page load (exactly how a user reaches `/upgrade`: a
hard redirect back from Clerk/OAuth after signing up, not a client-side route transition), there
is a real window where this component's `useEffect` can run before that script has finished
executing. When that happens, `ga4Available()` is false, `trackGa4Event`/`trackGoogleAdsConversion`
silently no-op (by design — see `google-ads.ts`'s own header on failing closed rather than sending
a broken payload) — but the pending-signup flag has *already* been destroyed by
`consumePendingSignUp()`, which ran as part of the `&&` chain regardless of whether gtag was ready.
The sign-up conversion is then lost with no way to recover it: nothing re-arms the flag, and the
effect's dependency array (`[pathname, search]`) means it won't re-fire again on this page view.

This is exactly the failure class `google-ads.ts`'s own file header warns about at length
("optimizing toward an event Google never receives is dead on arrival... every local check passes
and the account stays at zero") — just arriving from the DOM/script-timing side instead of a
config gap.

### Evidence

Added `src/lib/analytics/ga4-client.test.ts` (6 tests total) pinning the new non-destructive
`hasPendingSignUp()`/`hasPurchaseFired()` peeks: confirmed each reports the flag without ever
clearing/writing it, that the destructive halves (`consumePendingSignUp`, `markPurchaseFired`)
still work for the one call site each that needs them, per-user scoping for the purchase flag, and
SSR-safety. Confirmed RED pre-fix via `git stash` on each pair of files (`hasPendingSignUp`/
`hasPurchaseFired` is not a function, 3/3 then 3/3 fail) → GREEN post-fix (6/6 pass). Full
`src/lib/analytics/*.test.ts` suite: 33/33 pass. `tsc --noEmit` and `eslint` both clean.

The component-level timing race itself isn't unit-testable in this repo (no React/jsdom rendering
tests exist anywhere in the codebase for "use client" components), so the fix is scoped to the
pure, testable half: making the destructive clear conditional on confirmed dispatch, which is
provably correct independent of the exact script-load timing on any given page load.

### Blast radius

A second call site shares the identical root cause: `src/components/analytics/Ga4ConversionTracker.tsx`'s
`purchase` conversion (the highest-revenue GA4/Google-Ads event — fired on return from the Whop
checkout round-trip, another hard-redirect page load with the same gtag-not-ready exposure) wrote
its `bo_ga4_purchase_fired:<userId>` flag to **localStorage** unconditionally, before confirming
gtag was ready — worse than the sign-up flag, because localStorage survives a refresh/new tab
(sessionStorage doesn't), so a lost race there permanently blocked every future attempt for that
user, with no retry path at all. Fixed the same way: added `hasPurchaseFired`/`markPurchaseFired`
to `ga4-client.ts` (mirroring `hasPendingSignUp`/`markPendingSignUp`/`consumePendingSignUp`), and
reordered `Ga4ConversionTracker` to mark fired only after confirming `ga4Available()`.

No other call site reads `bo_ga4_pending_signup_v1` or `bo_ga4_purchase_fired:*`.

### Fix rationale

Added `hasPendingSignUp()` as a non-destructive peek, and reordered the gate to check it (plus
`ga4Available()`) before calling the destructive `consumePendingSignUp()` — the flag is now only
cleared once gtag is confirmed ready to accept the call. If gtag isn't ready on this page load, the
flag survives for a page refresh (which re-runs the same script-load race) to try again, instead of
the conversion being silently and permanently lost. `trackXEvent`'s own X-pixel stub
(`window.twq`) is defined synchronously inline (standard Twitter snippet, queues calls before the
real script loads) so it isn't at the same risk — gating the whole block on `ga4Available()` is
the minimal change that protects the two gtag-routed calls without touching the X-pixel call's own
independent availability check.

| **Status** | Fixed in PR #6806 (branch `fix/ga4-signup-conversion-lost-before-gtag-ready`) |
|---|---|
