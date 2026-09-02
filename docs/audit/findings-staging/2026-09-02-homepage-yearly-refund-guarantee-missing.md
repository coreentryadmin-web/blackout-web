> **kind:** `FINDING`

## Homepage Premium Yearly card omitted the 7-day money-back guarantee — FIXED

| | |
|---|---|
| **Severity** | P1 |
| **Surface** | Homepage pricing grid (`RedesignHome.tsx`, `#pricing` section) |
| **Status** | FIXED — PR (this branch) |

### Root cause
Homepage pricing cards and `/pricing` (`RedesignPricing.tsx`) are separately maintained copy, not
rendered from one shared plan config. All three homepage cards (SPX Slayer, Premium Monthly,
Premium Yearly) shared the identical trust line `"Cancel anytime · No contracts"`. `/pricing`
correctly states `"7-day money-back guarantee · cancel anytime"` on its yearly card, and
`/refund-policy` confirms the entitlement (`"Annual subscriptions are non-refundable after the
first 7 days"`, monthly explicitly non-refundable). So a real contractual benefit existed but
wasn't communicated on the highest-traffic purchase surface (the homepage), while the correct
copy already lived one click away on `/pricing`.

### Evidence
`grep` on `RedesignHome.tsx` showed all three `<p className="trust">` lines identical:
`Cancel anytime &middot; No contracts`. `RedesignPricing.tsx` line 95:
`7-day money-back guarantee · cancel anytime`. `refund-policy/page.tsx` lines 29/37/39 confirm the
policy: monthly non-refundable once granted, annual refundable within the first 7 days.

### Fix
Changed only the Premium Yearly card's trust line on the homepage to
`"7-day money-back guarantee · cancel anytime"`, matching `/pricing`'s exact wording. Left the SPX
Slayer and Premium Monthly cards' `"Cancel anytime · No contracts"` line untouched — deliberately,
since `/refund-policy` states monthly plans are non-refundable once access is granted; adding the
guarantee there would misstate the policy in the other direction.

### Blast radius
Checked all three homepage pricing cards and `/pricing`'s three plan cards — no other surface
shares this hardcoded trust string. A full plan-metadata canonicalization (price, interval,
refund_window, cancellation, features, checkout_id — as recommended) is a larger refactor than
this fix; left as a documented follow-up rather than expanding this PR's scope.

### Test
New `src/components/landing/RedesignHome.pricing.test.ts`: asserts the homepage yearly card states
the guarantee (matching `/pricing`'s wording) and that the SPX Slayer/Premium Monthly cards do
NOT claim a money-back guarantee. Verified fails pre-fix (git-stash), passes post-fix. Full suite
11694/11694 green, `tsc --noEmit` clean, Node 20.
