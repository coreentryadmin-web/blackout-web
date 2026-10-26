> **kind:** FINDING

## Clerk auth webhook had no idempotency guard — redelivery reprocesses the full handler — FIXED

| | |
|---|---|
| **Area** | Auth provisioning — Clerk webhook (`src/app/api/webhooks/clerk/route.ts`) |
| **Status** | FIXED |
| **Severity** | P3 (no data corruption on any event type, but real duplicate side effects — a second Whop API call + a second "New member signed up" Discord ping per redelivery; flagged as a known follow-up by the 2026-10-26 Resend-webhook idempotency fix, `docs/audit/findings-staging/2026-10-26-resend-webhook-no-idempotency.md`) |

### Root cause

`src/app/api/webhooks/clerk/route.ts` verifies the Svix signature on every Clerk webhook
(`user.created`/`user.updated`/`user.deleted`) and then processes it unconditionally — same gap
as the Resend webhook route fixed earlier the same day, and explicitly named as a known follow-up
in that fix's own write-up: "Clerk's `webhooks/clerk/route.ts` has the same gap... noted here so a
future sweep doesn't have to rediscover it."

Clerk's webhooks are Svix-signed (same `svix-id`/`svix-timestamp`/`svix-signature` headers, same
at-least-once delivery semantics as Resend's and Whop's webhooks) — Svix retries on any non-2xx
response and can also redeliver an already-ack'd event. `svix-id` is stable across redeliveries of
the same event, so it is the correct dedup key, exactly as it is for the Whop and Resend routes.

### What a redelivery actually does per event type (verified before fixing, not assumed)

- **`user.deleted`** — calls `deleteUserDataForClerkId`, which issues plain `DELETE ... WHERE
  clerk_user_id = $1` statements inside one transaction. A second run against an already-deleted
  user is a safe no-op (0 rows affected, no error) — **not** load-bearing/correctness-class, despite
  this handler being the one just hardened in the prior SAVEPOINT transaction-abort fix. Confirmed
  by reading `deleteUserDataForClerkId` in `src/lib/db.ts` directly rather than assuming.
- **`user.created`** — the INSERT uses `ON CONFLICT (clerk_user_id) DO UPDATE`, so the row write
  itself is idempotent. But three side effects downstream of it are **not** all guarded the same
  way:
  - `startWelcomeSequence` — already self-guarded (`ON CONFLICT (user_id) DO NOTHING` on
    `welcome_sequence_state`, confirmed in `src/lib/welcome-sequence.ts`) — a redelivery is a
    genuine no-op here already.
  - `notifyOpsDiscord({ title: "New member signed up", ... })` — **not** guarded. A redelivery
    fires a second "someone just showed up" ping to the ops Discord channel for one real signup.
  - `syncWhopForClerkUser` — **not** guarded. A redelivery makes a second, redundant call to
    Whop's membership API for the same user.
- **`user.updated`** — a plain column `UPDATE`, idempotent in itself, but re-runs
  `syncWhopForClerkUser` a second time on redelivery for no reason.

So this is dashboard/ops-noise class, not data-corruption class — but a real, avoidable duplicate
side effect on every redelivery, same shape as the Resend finding, just a step less severe because
none of Clerk's downstream writes happen to be order- or count-sensitive the way `email_events`
aggregation is.

### Evidence

- Extended the existing `src/app/api/webhooks/clerk/route.test.ts` (had 2 tests, unrelated to
  idempotency) with a new `describe` block, 3 cases.
- RED/GREEN proof: stashed the route fix only (`git stash -- src/app/api/webhooks/clerk/route.ts`),
  re-ran the full test file — the new "redelivered event is NOT reprocessed" case failed
  (`redelivery must NOT trigger a second Whop sync call: 2 !== 1`), the other 2 idempotency cases
  and both pre-existing tests happened to pass incidentally (they don't exercise the dedup path, or
  don't depend on it). Restored the fix (`git stash pop`) — all 5/5 pass.
- The two pre-existing tests previously shared one hard-coded `svix-id` ("msg_test") across every
  request in the file via the `next/headers` mock — harmless before this fix, but would have made
  every test after the first read as a duplicate-delivery no-op once dedup was added. Made the
  mocked `svix-id` settable per test (`setSvixId`) so each test keeps its own independent identity.

### Fix

Mirror `webhook/whop/route.ts`'s `claimWhopEvent`/`releaseWhopEventClaim` pattern exactly — the
same pattern just applied to `webhook/resend/route.ts` earlier the same day — using the shared
`sharedCacheSetNx`/`sharedCacheDel` primitives (`src/lib/shared-cache.ts`):

- **Claim before processing** (`clerk:event:<svix-id>`, 24h TTL, same TTL choice as
  `claimWhopEvent`/`claimResendEvent`): claimed right after signature verification succeeds, before
  any DB write or side-effecting call. A redelivery that's already claimed is ack'd 200 immediately
  without reprocessing.
- **Release the claim on a processing failure** (any DB error inside the existing try/catch):
  otherwise a transient DB error would permanently "poison" that `svix-id` — Clerk/Svix's retry of
  the exact same event would find the key already claimed and be silently swallowed as a duplicate
  of an attempt that never actually persisted anything, including for `user.deleted`'s GDPR
  cleanup. Same bug `releaseWhopEventClaim`'s own doc comment describes for the Whop route.
- **Fail open** (`.catch(() => true)` on the claim) if Redis itself errors mid-call — never drop a
  genuine, first-time delivery (including a `user.deleted`) over an infra blip.

### Blast radius

Only `src/app/api/webhooks/clerk/route.ts`. No change to `deleteUserDataForClerkId`,
`startWelcomeSequence`, `syncWhopForClerkUser`'s own internals, the `users` table schema, or the
metadata-parsing helpers. `webhook/whop/route.ts` and `shared-cache.ts` are read-only references,
not touched.

### Tests

`src/app/api/webhooks/clerk/route.test.ts`:
- "a redelivered event (same svix-id) is NOT reprocessed (no second Whop sync call)" — the
  regression proof (RED pre-fix).
- "two different svix-ids each process independently" — guards against an over-eager key.
- "a retry AFTER a failed DB write is reprocessed, not swallowed as a duplicate" — proves the
  release-on-failure path, including for `user.created`'s own DB write.
- Both pre-existing tests (internal-audit-email Whop-sync skip) updated to use distinct per-test
  `svix-id`s and still pass unchanged otherwise.

`npx tsx --experimental-test-module-mocks --test src/app/api/webhooks/clerk/route.test.ts
src/app/api/webhook/whop/route.test.ts src/lib/shared-cache.test.ts`: 14/14 pass. `npx tsc
--noEmit` and `npx eslint src/app/api/webhooks/clerk/route.ts
src/app/api/webhooks/clerk/route.test.ts` both clean.
