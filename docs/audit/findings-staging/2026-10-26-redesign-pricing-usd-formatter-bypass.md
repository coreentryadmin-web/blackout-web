## `/pricing`'s yearly tile bypassed the canonical `usd()` formatter for two derived prices

> **kind:** `FINDING`

### Root cause

`src/lib/pricing.ts` exports `MEMBERSHIP_PRICING` and a single `usd()` formatter specifically so
every marketing surface that shows a price formats it identically ("the SINGLE source of truth
... so the three pricing displays could silently drift apart", per the file's own header comment).
Every price on `src/components/landing/RedesignPricing.tsx`'s pricing tiers went through `usd()`
— except one line, the "Premium · Yearly" tile's secondary line, which built its string with a raw
template literal and a hand-typed `$`:

```tsx
<div className="save">≈ ${MEMBERSHIP_PRICING.yearlyEffectiveMonthly}/mo · save ${MEMBERSHIP_PRICING.yearlySavingsVsMonthly} vs monthly</div>
```

`usd()` exists to add thousands separators (`1999 → "$1,999"`); the raw template literal cannot.
The sibling line in `src/components/landing/RedesignHome.tsx` (the homepage's own pricing cards)
renders the exact same two fields correctly: `{usd(MEMBERSHIP_PRICING.yearlyEffectiveMonthly)}/mo
· save {usd(MEMBERSHIP_PRICING.yearlySavingsVsMonthly)} vs monthly` — so `/pricing` and the
homepage were already capable of disagreeing on how this one number formats, exactly the failure
mode the shared helper was built to make structurally impossible. It stayed invisible today only
because `MEMBERSHIP_PRICING.yearlyEffectiveMonthly` (167) and `.yearlySavingsVsMonthly` (389) both
happen to be under 1,000 — the day either grows past it (a price increase, or the membership tier
restructuring), `/pricing` would silently render `$1234` while every other price on the same page,
and the homepage's equivalent line, show `$1,234`.

### Evidence

Added `src/components/landing/RedesignPricing.test.tsx`: `mock.module`s `@/lib/pricing` to supply
`yearlyEffectiveMonthly: 1234` / `yearlySavingsVsMonthly: 5678` (values chosen specifically to
cross the 1,000 threshold the real constants don't yet reach), renders `<RedesignPricing/>` via
`renderToStaticMarkup`, and asserts the output contains the comma-formatted `$1,234`/`$5,678` and
NOT the raw `$1234`/`$5678`. Confirmed RED against the pre-fix source (`git stash` isolating
`RedesignPricing.tsx`) — the stashed version rendered `<div class="save">≈ $1234/mo · save $5678
vs monthly</div>` verbatim — then GREEN (1/1) after the fix. `tsc --noEmit` and `eslint` both
clean on the changed files.

### Blast radius

Single call site: this is the only line anywhere in the codebase that interpolates
`MEMBERSHIP_PRICING.yearlyEffectiveMonthly`/`.yearlySavingsVsMonthly` outside of `usd()`
(`RedesignHome.tsx`'s equivalent line was already correct, confirmed by reading it directly).
No other price display is affected.

### Fix rationale

Wrap both values in `usd()`, matching the already-correct sibling line in `RedesignHome.tsx`
exactly. No change to `MEMBERSHIP_PRICING`'s values or `usd()`'s own behavior — purely closing the
one place that skipped the shared formatter.

| **Status** | Fixed in PR #6817 (branch `fix/redesign-pricing-usd-bypass`) |
|---|---|
