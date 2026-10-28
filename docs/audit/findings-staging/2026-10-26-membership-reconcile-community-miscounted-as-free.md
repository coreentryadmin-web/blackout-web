> **kind:** `FINDING`

## `reconcileAllMemberships`'s own run-summary stats silently mislabeled every reconciled `community`-tier member as `free` — FIXED

| | |
|---|---|
| **Severity** | P3 (observability/reporting defect — the actual Clerk tier write is correct and unaffected; only the reconcile cron's own summary stats, logged to `cron_job_runs.meta_json` and returned in the cron's JSON response, were wrong) |
| **Surface** | `src/lib/membership.ts` — `reconcileAllMemberships`'s inner `syncOne` helper, called by `GET /api/cron/membership-reconcile` |
| **Status** | FIXED |

### Root cause

`reconcileAllMemberships` re-resolves the true Whop tier for every email in its target set and
tallies the outcome into `{checked, premium, free, errors, capped}` for the cron's logged run.
`syncOne` derived the bucket with:

```ts
return tier === "premium" ? "premium" : "free";
```

`syncWhopMembershipForEmail` can resolve a real third tier, `"community"` (SPX Slayer, $49/mo,
added by #1159) — not a degenerate case of "not premium". The bare ternary collapsed every
`community` resolution into the `"free"` bucket for this function's own return stats, even though
the member's actual Clerk `publicMetadata.tier` was written correctly as `"community"` by
`syncWhopMembershipForEmail` → `updateClerkMembershipMetadata` (a separate code path, unaffected
by this classification — no member ever lost or gained access from this bug).

This repo's own code already treats `community` as a distinct, first-class paid tier everywhere
else that matters: `isPaidTierForReconcileDowngradeCheck` (same file, fixed earlier today in
#6886/the "community omission" fix one paragraph above it) explicitly folds `community` in
alongside `premium` for the *downgrade-check* side of this exact function; `admin-users.ts`'s
`AdminUserListStats` tracks `{total, premium, admins, community, free}` as four separate buckets
for the admin User Management dashboard. Only this one tally, on the *upgrade/resolve* side of the
same function, still conflated `community` with `free`.

### Evidence

New test in `src/lib/membership-reconcile-downgrade.test.ts` (the existing home of this function's
other pure-predicate regression tests) pins the extracted `reconcileStatsBucket` helper:

```ts
test("reconcileStatsBucket keeps community distinct from free — it must not collapse to free", () => {
  assert.equal(reconcileStatsBucket("premium"), "premium");
  assert.equal(reconcileStatsBucket("community"), "community");
  assert.equal(reconcileStatsBucket("free"), "free");
});
```

RED→GREEN confirmed via `git stash push -- src/lib/membership.ts` (test file left in place):
- **Before the fix:** `reconcileStatsBucket` doesn't exist yet — the test fails with
  `(0 , import_membership.reconcileStatsBucket) is not a function`.
- **After the fix:** all 4 tests in the file pass, including the 3 pre-existing ones (unaffected).

### Blast radius

`reconcileAllMemberships` has exactly one caller, `GET /api/cron/membership-reconcile`, which
spreads the full result into both its JSON response and the row `logCronRun` persists to
`cron_job_runs.meta_json`. No other code path reads `syncOne`'s bucket or `reconcileAllMemberships`'s
`{premium, free}` counts, so the fix is fully contained to this one function and its one caller —
confirmed via `npx tsc --noEmit` (clean across the whole project after widening the return type)
and a repo-wide grep showing no other consumer destructures `{premium, free}` from this specific
function.

### Fix

Extracted the tier→bucket mapping into a new, pure, exported `reconcileStatsBucket(tier: Tier):
"premium" | "community" | "free"` helper (same file, right after the sibling
`isPaidTierForReconcileDowngradeCheck` predicate it mirrors), widened `syncOne`'s return type to
`"premium" | "community" | "free" | "error"`, and added a `community` counter alongside `premium`/
`free` in `reconcileAllMemberships`'s tally loop and return type. The cron route's
`{ ok: true, ...result }` spread needed no change — it already forwards whatever shape
`reconcileAllMemberships` returns.

### Fix rationale

Extracting a pure, named predicate (rather than inlining a wider ternary in `syncOne`) matches this
exact file's own established pattern for making a reconcile-sweep classification decision
independently testable without standing up Clerk/Whop clients — the same reasoning stated in
`isPaidTierForReconcileDowngradeCheck`'s own doc comment. Widening the return shape additively
(`community` is a new field; `checked`/`premium`/`free`/`errors`/`capped` are unchanged) means no
existing consumer's expectations break, which `tsc --noEmit` across the whole project confirms.

### Tests

`src/lib/membership-reconcile-downgrade.test.ts` (1 new test, 3 pre-existing unaffected). Sibling
suites that exercise the surrounding membership/whop logic also re-run clean and unaffected:
`membership-activating.test.ts`, `membership-sync-limit.test.ts`, `membership-tiebreak.test.ts`,
`tiers.test.ts`, `whop-billing-kind.test.ts`, `whop-dunning.test.ts`, `whop-revocation.test.ts`
(35 tests total, 0 failures). `npx tsc --noEmit` clean. `npx eslint` clean on both changed files.
