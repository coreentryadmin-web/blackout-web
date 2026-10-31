> **kind:** FINDING

## `isMembershipRevoked` trusted a stale Redis negative — a refunded/charged-back membership could read as "not revoked" for up to 10 minutes — FIXED

| | |
|---|---|
| **Area** | `src/lib/whop-revocation.ts` (refund/chargeback revocation denylist, `membership.ts`'s `resolveMembershipTierForEmail`) |
| **Severity** | P2 (security/billing — a revoked/refunded membership can transiently regrant premium access) |
| **Status** | FIXED |

### Root cause

`isMembershipRevoked` is the hot-path read for the Whop refund/chargeback denylist: a one-time
`completed` purchase that is later refunded or disputed stays `completed` forever on the Whop
side, so `membership.ts` consults this Postgres-backed (`whop_revoked_memberships`, Redis-cached)
denylist on every tier resolution to force it to `free`.

Before this fix, the negative-result branch short-circuited on a cache hit of `0`:

```ts
const cached = await sharedCacheGet<number>(REVOKED_PREFIX + membershipId);
if (cached === 1) return true;
if (cached === 0) return false; // fresh negative from a prior Postgres check
```

That `0` is not a settled fact — `isMembershipRevoked` itself writes it after a Postgres miss,
with no coordination against a concurrent `markMembershipRevoked` write for the SAME membership
id. The two callers' stores are completely independent round-trips (Postgres INSERT + Redis SET
in `markMembershipRevoked`; Postgres SELECT + Redis SET in `isMembershipRevoked`), so nothing
serializes them against each other. The realistic interleaving:

1. A refund/dispute webhook arrives for `mem_x` → `markMembershipRevoked` starts its Postgres
   `INSERT`.
2. Concurrently (e.g. the member's own dashboard polling tier), `isMembershipRevoked("mem_x")`
   misses Redis and issues its Postgres `SELECT` — which runs and returns **zero rows**, because
   step 1's `INSERT` has not committed yet (ordinary READ COMMITTED semantics, no dirty read
   involved — the answer was genuinely correct at the instant it was read).
3. Step 1's `INSERT` then commits, and `markMembershipRevoked` writes Redis `= 1` (the correct,
   now-current truth).
4. Step 2's own pending `sharedCacheSet(..., 0, NOT_REVOKED_TTL_SEC)` call — dispatched before
   step 3's write but with no ordering guarantee against it — completes **after** step 3 and
   silently **overwrites the correct `1` with `0`**.

From that point, every reader hits the (now stale, wrong) Redis `0` and short-circuits without
ever consulting Postgres again — for up to `NOT_REVOKED_TTL_SEC` (10 minutes) — so a refunded or
charged-back membership reads as "not revoked" and `resolveMembershipTierForEmail` can grant
premium again, exactly the leak this denylist exists to close.

This is the **identical race shape** `src/lib/whop-dunning.ts`'s `isMembershipInDunningGrace`
already defends against (see its own inline comment and its dedicated regression test "stale
Redis negative (0) still falls through to Postgres when grace exists" in
`src/lib/__tests__/whop-dunning-grace.test.ts`) — but `whop-revocation.ts` never carried the same
guard, despite being the more security-sensitive of the two siblings (a billing fraud/chargeback
denylist, not a grace-period convenience). The sibling file's own existing test,
`"fresh negative cache (0) short-circuits without touching Postgres"` in
`src/lib/__tests__/whop-revocation.test.ts`, was asserting the racy behavior as a feature.

### Evidence

New regression test added to `src/lib/__tests__/whop-revocation.test.ts`:

```
test("REGRESSION: a stale negative cache (0) does NOT mask a real revocation in Postgres", async () => {
  const { isMembershipRevoked } = await mod();
  resetState();
  state.cache.set("whop:revoked:mem_stale", 0);
  state.dbRows = ["mem_stale"]; // the webhook's INSERT has since committed — this membership IS revoked
  assert.equal(await isMembershipRevoked("mem_stale"), true);
  assert.equal(state.cache.get("whop:revoked:mem_stale"), 1);
});
```

**RED (pre-fix, `git stash` on `whop-revocation.ts` alone, Node 20):**

```
Expected values to be strictly equal:
false !== true
# fail 2   (the new regression test, plus the updated "falls through to Postgres" test)
```

**GREEN (post-fix):** full file `src/lib/__tests__/whop-revocation.test.ts` 8/8 pass; combined
run with `whop-revocation.test.ts`, `whop-dunning.test.ts`, `whop-dunning-grace.test.ts` — 29/29
pass. `npx tsc --noEmit` clean. Sibling membership test files
(`membership-tiebreak.test.ts`, `membership-activating.test.ts`,
`membership-reconcile-downgrade.test.ts`, `membership-sync-limit.test.ts`) re-run clean, 14/14.

### Blast radius

`whop-revocation.ts` only — `isMembershipRevoked` is the sole call site exercising this path
(`membership.ts`'s `resolveMembershipTierForEmail`, line ~168, iterating each membership). No
other module reads `whop:revoked:*` directly. `markMembershipRevoked` is unchanged.

### Fix rationale

Removed the `cached === 0` short-circuit, mirroring `whop-dunning.ts`'s existing, already-tested
guard exactly: a Redis `1` is trusted (an explicit `markMembershipRevoked` write, cross-replica,
authoritative), but a `0` always falls through to re-verify against Postgres — which both
re-confirms the correct answer and self-heals the stale cache entry back to `1` when it was
wrong. This trades a few extra Postgres reads on the (rare) stale-negative path for correctness
on a security/billing-relevant denylist — the same trade-off the sibling file already made and
documented. Updated the top-of-file comment on `NOT_REVOKED_TTL_SEC` to explain why the negative
cache is written (so it can be overwritten/healed) but never trusted on read, instead of claiming
it saves a Postgres round-trip (it doesn't, now — same as the dunning file).

Considered and rejected: adding an `invalidationSeq`-style sequence-number guard (as
`clerk-user-cache.ts`/`tier-cache.ts` use for their own, different in-flight-fetch race). That
guard protects a single async operation's own delayed write against an *explicit* invalidation
call; here there is no invalidation call at all — two independent callers' reads/writes for the
same key race each other with no shared sequence counter to compare. The dunning file's
"always re-verify a 0 against Postgres" approach is the simpler, already-proven fix for this
specific two-independent-writers shape, so this fix follows it rather than inventing a new
mechanism for the one file that was missing it.
