## 2026-09-04 — [P3, marketing accuracy] `/vs/others` comparison table still overclaimed "every setup graded" after the same-day fix that scoped this exact claim elsewhere — FIXED

> **kind:** `FINDING`

| | |
|---|---|
| **Severity** | P3 — marketing accuracy, not a functional defect |
| **Found by** | Manual sweep of marketing surfaces not touched by PR #3643 (same-day) |
| **Status** | FIXED |

### Root cause

PR #3643 (earlier today) corrected three surfaces — `about/page.tsx`, `RedesignHome.tsx`,
`WhyBlackoutContent.tsx` — that said "Every setup BlackOut flags is logged publicly, graded..."
even though `/methodology`'s own payload type (`TrackRecordPagePayload`, `track-record-page.ts`)
is hard-typed to exactly three buckets: SPX Slayer, Night Hawk, and 0DTE Command. No
helix/vector/thermal/meridian/largo field exists there, so "every setup"/"each product" promises
broader public-ledger coverage than the platform actually delivers.

`src/app/(marketing)/vs/others/page.tsx` — the "BlackOut vs Other Options Trading Platforms"
comparison page — carries the identical claim shape in its comparison table and was not part of
that fix's blast-radius search: `{ feature: "Alert accountability", blackout: "Every setup graded
A–F with a logged track record", ... }`. Same defect, same root cause (the claim was never scoped
to the three products `/methodology` actually covers), missed because #3643's sweep searched for
the literal phrases already known from the About/homepage/WhyBlackout copy and this page uses
different wording ("Every setup graded A–F...") that wasn't part of that search.

### Fix

Scoped the `/vs/others` comparison-table row to name the three products, matching the wording
pattern #3643 already established elsewhere: "SPX Slayer, Night Hawk, and 0DTE Command plays
graded A–F with a logged track record."

### Evidence / blast-radius check

Extended `src/lib/public-record-scope-claims.test.ts`'s `SURFACES` list (the exact regression
harness #3643 shipped for this claim class) to include `src/app/(marketing)/vs/others/page.tsx`.
RED before the fix (`assert.ok(/SPX Slayer/.test(body) && ...)` failed — the page names none of
the three products), GREEN after. Grepped the rest of the marketing tree
(`grep -rn "every setup\|every play\|full ledger, always"`) for any further surfaces #3643 and this
fix might both have missed — none found; the four files now in `SURFACES` are the complete set as
of this fix.

### Fix rationale

Same fix shape as #3643 (name the three products next to the claim) rather than removing the
row or softening it further — keeps the comparison table's actual differentiator (a real, gradeable
public track record on those three desks) intact while not promising more than `/methodology`
delivers. Left HELIX/Vector/Thermal/Meridian/Largo's own internal signal/outcome tracking
un-mentioned here, same as #3643 — whether those should eventually surface on the same public page
is the same still-open product question #3643 declined to answer, not something this narrower
copy fix should decide unilaterally.

`npx tsc --noEmit` clean. `public-record-scope-claims.test.ts` (2/2) plus four adjacent marketing
test files that reference this page or the product manifest (28/28 total) all green.

### Addendum — the "complete set" claim above was wrong; two more instances found

The grep-for-phrases sweep above missed two more live instances of the identical overclaim,
because the regression test's own check ("do the three product names appear anywhere in this
file") is a whole-file check, not a per-claim proximity check:

- `RedesignHome.tsx`'s own "them vs us" list (a second, separate copy of the exact sentence
  `vs/others/page.tsx` mirrors — its own header comment says as much) still said "Every setup
  graded A–F with a logged track record", unscoped — survived undetected because the file already
  names all three products dozens of times elsewhere for unrelated reasons, so the whole-file check
  passed even though this specific bullet wasn't scoped.
- `about/page.tsx`'s `WHAT_WE_DO` intro paragraph ("Then we grade every setup, log every outcome
  publicly...") is a separate paragraph from the `APPROACH` section #3643 already fixed, using
  phrasing the regression regex didn't even match ("log" not "logged").

Both fixed with the same product-naming pattern. `public-record-scope-claims.test.ts` rewritten to
check each individual claim's local proximity (200-char window) to the three product names instead
of whole-file existence — proven to catch the `RedesignHome.tsx` regression via `git stash` RED,
restored GREEN. `tsc --noEmit` clean; 26/26 related tests pass.
