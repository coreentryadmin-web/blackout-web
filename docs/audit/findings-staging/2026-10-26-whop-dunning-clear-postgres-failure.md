> **kind:** FINDING

## `clearMembershipDunningGrace` silently swallows a Postgres delete failure — FIXED

| | |
|---|---|
| **Area** | Billing lifecycle — Whop dunning grace (`src/lib/whop-dunning.ts`) |
| **Status** | FIXED |
| **Severity** | P3 (narrow, low-probability, but a real unintended-grace path with no test coverage) |

### Root cause

`markMembershipDunningGrace` (start-grace) tracks whether each store (Postgres, Redis)
succeeded and throws only when **both** fail — the documented "webhook retry path": throwing
makes the webhook handler return a 500, Whop redelivers the event, and the write gets another
chance. Its sibling, `clearMembershipDunningGrace` (end-grace, called on
`membership.deactivated`, `invoice.marked_uncollectible`/`voided`, and `invoice.paid`/
`payment.succeeded`), did **not** follow the same pattern: it caught and logged a Postgres
`DELETE` failure but never tracked that failure or re-threw, always returning successfully
after only clearing the Redis key.

```ts
// before
if (dbConfigured()) {
  try {
    await dbQuery(`DELETE FROM whop_dunning_grace WHERE membership_id = $1`, [membershipId]);
  } catch (err) {
    console.error(`[whop-dunning] Postgres delete failed for ${membershipId}:`, err);
  }
}
await sharedCacheDel(DUNNING_PREFIX + membershipId);
// falls through to a normal return even if the DELETE above threw
```

### Failure scenario

1. A membership is in dunning grace (`whop_dunning_grace` row + Redis key both present).
2. A `payment.succeeded`/`invoice.paid`/`membership.deactivated`/invoice-voided webhook fires.
   Redis is healthy; Postgres has a transient failure on the `DELETE`.
3. `clearMembershipDunningGrace` logs the error, clears the Redis key, and returns normally
   (no exception) — so the webhook handler proceeds, the idempotency claim is kept, and Whop
   never redelivers this event (nothing told it there was a failure).
4. The stale, not-yet-expired Postgres row for that membership is now permanently orphaned
   until it naturally expires (up to the full `WHOP_DUNNING_GRACE_SEC`, 7 days by default).
5. If that same membership re-enters `past_due` before the row expires,
   `isMembershipInDunningGrace` hits a Redis miss, falls through to Postgres (by design — this
   is the documented durability path for exactly this situation), finds the stale row, and
   wrongly reports "still in grace" — granting the member extra premium access they should not
   have, past the point an intervening successful-payment or deactivation event should have
   cleared it.

This is the mirror image of the bug `markMembershipDunningGrace` already guards against
(a silent partial failure that leaves one store out of sync with the other), on the opposite
function. Confirmed via code read that `sharedCacheDel` (`shared-cache.ts`) internally swallows
all Redis errors and never throws, so the only real failure vector here is specifically the
Postgres `DELETE`.

### Evidence

- `src/lib/__tests__/whop-dunning-grace.test.ts` had comprehensive partial-failure coverage for
  `markMembershipDunningGrace` but **zero** test for "Postgres delete fails during clear" —
  confirmed by reading the file end-to-end before writing the fix.
- Added a regression test (`clear: throws when Postgres delete fails...`) that is RED on the
  pre-fix code (1 failing test when the fix's 12-line diff is reverted, confirmed by swapping in
  the pre-fix file content and re-running the suite) and GREEN on the fix (11/11 pass).
- Confirmed via a full read of `src/app/api/webhook/whop/route.ts` lines 253-474 that all three
  `clearMembershipDunningGrace` call sites (membership.deactivated ~L300,
  invoice.marked_uncollectible/voided ~L435, invoice.paid/payment.succeeded ~L451) sit directly
  inside the route's single outer `try` with no intervening try/catch — a thrown exception
  correctly propagates to the outer `catch (error)` at L474, which releases the webhook
  idempotency claim (so Whop's retry isn't silently acked as a duplicate) and returns
  `{ status: 500 }`, triggering Whop's own redelivery mechanism.

### Fix

Mirror `markMembershipDunningGrace`'s existing `pgOk` pattern: track whether the Postgres
`DELETE` succeeded, still clear the Redis key unconditionally (no reason to leave the hot cache
stale just because the durable delete failed), and throw if the Postgres delete failed. The
`DELETE` is naturally idempotent, so a Whop-triggered retry is safe and will heal the stale row
once Postgres recovers.

### Blast radius

Only `clearMembershipDunningGrace` itself; the three call sites in the webhook route needed no
changes — the outer try/catch already propagates correctly. No other caller exists
(`grep -rn clearMembershipDunningGrace src/` confirms exactly 3 call sites, all inside the same
handler). `markMembershipDunningGrace` was already correct and untouched.

### Tests

`src/lib/__tests__/whop-dunning-grace.test.ts`:
- `clear: throws when Postgres delete fails, so the webhook caller can retry` — new, proves the
  fix (and is RED on the pre-fix code).
- `clear: does not throw when Postgres succeeds (or is not configured)` — new, guards against a
  regression that makes `clearMembershipDunningGrace` throw unconditionally.

`npx tsx --experimental-test-module-mocks --test src/lib/__tests__/whop-dunning-grace.test.ts`:
11/11 pass. `npx tsc --noEmit` and `npx eslint src/lib/whop-dunning.ts
src/lib/__tests__/whop-dunning-grace.test.ts` both clean.
