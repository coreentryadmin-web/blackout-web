## 2026-09-04 — [P3, marketing accuracy] Two more "every setup logged" overclaim instances survived two same-day fix PRs because the regression test was whole-file, not per-claim — FIXED

> **kind:** `FINDING`

| | |
|---|---|
| **Severity** | P3 — marketing accuracy, not a functional defect |
| **Found by** | Manual review of PR #3664 (a same-day follow-up scoping the identical claim on `/vs/others`) while verifying its "no further surfaces found" completeness claim |
| **Status** | FIXED |

### Root cause

Earlier today, PR #3643 scoped "every setup logged"-style transparency claims on the About page,
homepage (`RedesignHome.tsx`), and `WhyBlackoutContent.tsx` to the three products `/methodology`'s
`TrackRecordPagePayload` actually covers (SPX Slayer, Night Hawk, 0DTE Command). A same-day
follow-up, PR #3664, found and fixed one more instance on `/vs/others/page.tsx` and stated its own
grep sweep found "the complete set."

That completeness claim was wrong. Two more live, unscoped instances existed:

1. **`RedesignHome.tsx`'s own "them vs us" `<ul className="vs-list">` bullet** (line ~424) — a
   second, separate copy of the exact sentence `/vs/others/page.tsx` mirrors (that page's own header
   comment says as much: "Same claims as the homepage's 'them vs us' section"). It still read "Every
   setup graded A–F with a logged track record", unscoped.
2. **`about/page.tsx`'s `WHAT_WE_DO` intro paragraph** ("Then we grade every setup, log every
   outcome publicly...") — a separate paragraph from the `APPROACH` section #3643 already fixed,
   using phrasing ("log", not "logged") the existing regression regex didn't even match.

Both survived PR #3643 and PR #3664 for the same structural reason: `public-record-scope-claims.
test.ts`'s check was **whole-file** ("do the three product names appear anywhere in this file"), not
per-claim. `RedesignHome.tsx` already names all three products dozens of times elsewhere for
unrelated reasons, so the whole-file check trivially passed even though this specific bullet was
never actually scoped next to the three product names.

### Evidence

RED (`git stash` on just the source fix, keeping the widened test applied): the rewritten proximity
check fails with `the claim "Every setup graded A–F with a logged" doesn't name the three products
... within 200 chars of it — a product name appearing ELSEWHERE in the same file does not scope THIS
specific claim`. GREEN after restoring the fix.

`npx tsc --noEmit` clean. `public-record-scope-claims.test.ts` + `product-manifest-consistency.
test.ts` + `RedesignHome.seo.test.ts` + `RedesignHome.pricing.test.ts`: 26/26 pass.

### Fix

Same product-naming pattern #3643/#3664 already established: name the three products inline next to
the claim ("SPX Slayer, Night Hawk, and 0DTE Command..."). Also rewrote `public-record-scope-claims.
test.ts` itself — replaced the whole-file existence check with a `findBroadClaims()`-based per-match
proximity check (`PROXIMITY_WINDOW = 200` chars around each individual claim occurrence), and widened
the underlying regex from `/every (setup|play)\b.../ ` to `/every\s+(?:\w+\s+)?(setup|play)\b.../ `
to also catch phrasings like "every trade setup".

### Blast radius

Two source files (`about/page.tsx`, `RedesignHome.tsx`) plus the shared regression test. This PR does
NOT include the `/vs/others/page.tsx` fix or its `SURFACES` list entry — that fix already exists,
independently, on the still-open PR #3664; this is a standalone fix so it isn't lost if that branch
gets rebased again (it has been, twice, by another lane, silently dropping this exact work each
time — see PR #3664's comment thread). Once #3664 merges, its own `SURFACES` addition for
`vs/others/page.tsx` and this PR's proximity-check rewrite are compatible and should merge cleanly
(both touch the same file in non-overlapping ways: `SURFACES` array vs. the check logic below it).

### Fix rationale

Same fix shape as #3643/#3664 (name the three products next to the claim) rather than removing or
softening the rows — keeps the real differentiator (a gradeable, public track record on those three
desks) intact without promising more than `/methodology` delivers. The proximity-check rewrite is the
structural fix that should prevent a third recurrence: any future unscoped "every setup"/"every play"
claim on any of the currently-covered surfaces will now be caught regardless of how many times the
three product names appear elsewhere in the same file.

### What was deliberately left unchanged

`/vs/others/page.tsx` itself and its `SURFACES` list entry — already fixed on PR #3664, not
duplicated here to avoid a conflicting/competing change to the same file.
