## accessEndedEmail accepted `previousTier` but never read it — every full-cancellation email used community-shaped wording even for Premium members losing six more engines

> **kind:** `FINDING`

`AccessEndedContext` (`src/lib/email/templates/access-ended.ts`) has required a `previousTier:
Tier` field since this template first shipped (#1901, 2026-08-07), and
`billing-lifecycle-email.ts`'s `dispatchTransitionEmail()` has always correctly resolved and
passed the real previous tier (`"premium"` or `"community"`) through to it whenever a membership
fully cancels to `"free"`. But the template body never referenced `ctx.previousTier` anywhere —
every full cancellation, regardless of which paid tier the member was actually leaving, rendered
identical copy that only ever mentioned losing "the live reads, the GEX/flow feeds, the graded
0DTE setups" (community/SPX-Slayer-shaped wording).

**Real-world effect:** a Premium member who fully cancels (skipping the intermediate
premium→community downgrade path) is told they're losing the 0DTE desk and nothing else — the
email never mentions the other six engines (Thermal, HELIX, Night Hawk, Largo AI, Vector,
Meridian) that member is also losing at the same moment. Same "email copy doesn't match the
recipient's real tier/entitlements" bug class already fixed in `welcomePremiumEmail`'s
previousTier-driven dual-opener and `downgradeEmail`'s explicit six-engine "what's gone dark"
paragraph — this was the one sibling template in the same file family where the personalization
field existed but was silently dead.

**Fix:** branch the opening paragraph on `ctx.previousTier === "premium"` — the Premium path now
explicitly names the other six engines lost alongside the 0DTE desk; the community path keeps the
original, correctly-scoped wording unchanged (a community/SPX-Slayer member never had those six
engines to lose, so naming them there would itself be false).

**Evidence (RED → GREEN):** new test file
`src/lib/email/templates/access-ended-previous-tier.test.ts`, 3 cases. Pre-fix (via `git stash` on
just the source change): 2/3 fail — Premium cancellation copy doesn't name any of the six engines,
and Premium vs. community output is byte-identical. Post-fix: 3/3 pass. Ran the full
`src/lib/email/templates/*.test.ts` suite (17/17 pass, no cross-template drift) and
`src/lib/billing-lifecycle-email.test.ts` (2/2 pass, the dispatch path that supplies
`previousTier` is unaffected). `tsc --noEmit` and `eslint` clean on both touched files. Confirmed
`accessEndedEmail`'s only real call site (`billing-lifecycle-email.ts:163`) already passes the
correct, real `previousTier` — no caller-side change needed.

| **Status** | FIXED (PR #TBD) |
