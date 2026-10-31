> **kind:** FINDING

## `PLAN_VALUE_PROPS`/`valuePropFor`/`PlanValueProp` were orphaned scaffolding from an upgrade-page redesign that superseded them — FIXED (removed)

**Status:** Fixed (dead code removed), regression test added (`src/lib/upsell-features.test.ts`).

### Root cause

`src/lib/upsell-features.ts` exported a small "plan value prop" framing layer —
`PlanValueProp` (badge/subline/savings/featured fields), `PLAN_VALUE_PROPS`
(a lookup table keyed by the exact `WHOP_PREMIUM_CHECKOUT_OPTIONS` label
strings, e.g. `"Yearly — $1,999"`), and `valuePropFor(label)` (the lookup
helper) — with **zero callers anywhere in the repo outside their own
declaration**.

Traced via `git log --all -S"valuePropFor"`: this cluster was added in commit
`cfa0d4989` ("feat+harden: 13 audit items"), whose own commit message
describes it as `"upsell UI: presentation-only plan ladder over the existing
3 Whop price points (no billing calls)"` — i.e. it was built as the data
layer for a first-pass plan-ladder UI. That UI was fully replaced by a later
redesign, commit `19d7eb3f2` ("feat: redesign upgrade page + compress
pipeline section"), which added `src/components/upgrade/PlanLadder.tsx` as a
hand-built, bespoke three-card layout. `PlanLadder.tsx` sources its own copy
directly from `MEMBERSHIP_PRICING`/`usd()` in `src/lib/pricing.ts` (the
file's own header: `"the SINGLE source of truth for every marketing
surface"`) rather than from `PLAN_VALUE_PROPS`, and does its own
label-substring matching (`WHOP_PREMIUM_CHECKOUT_OPTIONS.find(o =>
o.label.includes("Monthly"))`) rather than the exact-label keying
`PLAN_VALUE_PROPS` was built around. The old lookup table was never deleted
when the redesign landed, so it has sat unreferenced ever since.

### Evidence

```
$ grep -rn "valuePropFor\|PLAN_VALUE_PROPS\|PlanValueProp" src --include=*.ts --include=*.tsx
src/lib/upsell-features.ts:141:export type PlanValueProp = {
src/lib/upsell-features.ts:161:export const PLAN_VALUE_PROPS: Record<string, PlanValueProp> = {
src/lib/upsell-features.ts:177:export function valuePropFor(label: string): PlanValueProp {
src/lib/upsell-features.ts:178:  return PLAN_VALUE_PROPS[label] ?? {};
```
— every hit is inside the file's own declaration; no other `.ts`/`.tsx` file
in `src/` imports or references any of the three names. `src/lib/upsell-features.test.ts`
(the file's own test suite) never referenced them either.

Checked the "is the VALUE duplicated as a hardcoded literal elsewhere"
question (the methodology this round's dead-code sweep uses, per
`MASSIVE_WS_INDICES`/`X_ACCOUNT_USERNAME` precedent) before removing anything:
`PlanLadder.tsx` does contain *prose-equivalent* strings — `"Billed monthly ·
stand down anytime"`, `"SPX desk access · billed monthly"`, `"≈ {...}/mo ·
billed yearly"`, and a dynamically-computed `"Best value — save
{usd(MEMBERSHIP_PRICING.yearlySavingsVsMonthly)}"` badge — but these are
**not a drifted copy of `PLAN_VALUE_PROPS`'s literals**: `PlanLadder.tsx`
already derives its numbers live from `MEMBERSHIP_PRICING` (so e.g. its
savings badge can never go stale the way a hardcoded `"Save $389 vs
monthly"` string could), and its card layout/keying scheme is structurally
different from `PLAN_VALUE_PROPS`'s label-keyed lookup. There is no
wiring-drift bug to fix here — `PlanLadder.tsx` is the intentional, currently
correct implementation; `PLAN_VALUE_PROPS` is the abandoned predecessor.
Forcing a wire-up would mean rebuilding `PlanLadder.tsx`'s bespoke per-card
logic around a lookup table it was never designed to use, for no behavior
change — not a safe or valuable fix, unlike the `IMAGE_FILES`-shape or
`X_ACCOUNT_USERNAME`-shape findings in this same series.

### Blast radius

Single file, single self-contained cluster — no other call sites exist to
fix or touch:
- `src/lib/upsell-features.ts` — removed `PlanValueProp`, `PLAN_VALUE_PROPS`,
  `valuePropFor` (lines 141-179 of the pre-fix file). `FEATURE_MATRIX` and its
  types/helpers (`FeatureRow`, `deskAccess`), which **do** have live
  consumers (`FeatureComparison.tsx`, `AuthProofRail.tsx`), are untouched.

### Fix rationale

Removed rather than wired in, because (a) there is no real consumer to wire
it into without a larger, out-of-scope `PlanLadder.tsx` rewrite, and (b) the
values it holds are not stale relative to the single source of truth
(`pricing.ts`) — they just belong to a UI that no longer exists. Deleting
confirmed-zero-ref scaffolding that names its own superseded predecessor is
lower risk than leaving it to bit-rot further or guessing at a speculative
future caller.

### Regression tests

- `src/lib/upsell-features.test.ts` (extended) — new test asserts the module
  no longer exports `PLAN_VALUE_PROPS` or `valuePropFor`, so the dead cluster
  can't silently reappear without a deliberate decision (and, implicitly, a
  real caller) to re-add it.

RED→GREEN proven via `git stash` on `src/lib/upsell-features.ts` alone (test
file unchanged): the new test failed (`PLAN_VALUE_PROPS was removed as dead
code...`) with the pre-fix source restored, and passed once the fix was
reapplied. Full file suite: 7/7 pass post-fix (6/7 with the fix stashed).
Also ran the two live consumers' own test suites
(`FeatureComparison.ssr.test.ts`, `product-manifest-consistency.test.ts`) —
28/28 pass combined, confirming no regression to `FEATURE_MATRIX` consumers.
`tsc --noEmit` and `eslint` clean on both touched files.
