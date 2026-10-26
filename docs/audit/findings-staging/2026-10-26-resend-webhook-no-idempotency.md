> **kind:** FINDING

## Resend delivery/engagement webhook had no idempotency guard — duplicate `email_events` rows on redelivery — FIXED

| | |
|---|---|
| **Area** | Email observability — Resend webhook (`src/app/api/webhook/resend/route.ts`) |
| **Status** | FIXED |
| **Severity** | P3 (observability-only blast radius — no entitlement/billing logic reads this table — but a real, repo-inconsistent correctness gap) |

### Root cause

`src/app/api/webhook/resend/route.ts` records every Resend delivery/engagement event
(sent/delivered/opened/clicked/bounced/complained/failed/suppressed, plus `contact.*`) into
`email_events` — the only observability surface for "did this email actually land" beyond the
original `sendEmail()` call succeeding. It is Svix-signed (same scheme Clerk's webhook route
unwraps) and the SDK's `webhooks.verify()` correctly checks the signature, but the route then
inserted unconditionally on every verified delivery, with **no check for whether this exact
delivery had already been recorded**.

Svix is an at-least-once delivery transport: it retries on any non-2xx response, and (same as
every other at-least-once webhook provider) can redeliver an already-ack'd event — a network
blip that loses our 200 on the wire, infra-side retries, etc. `svix-id` is Svix's own message id
and is **stable across redeliveries of the same event** (not a per-attempt id) — exactly the
property `webhook/whop/route.ts`'s `claimWhopEvent`/`eventId` already relies on for its own
idempotency claim. This repo already has the correct pattern for this exact problem, one webhook
handler over; the Resend route simply never applied it. (Clerk's `webhooks/clerk/route.ts` has
the same gap, but that route is a separate, unrelated concern and out of scope for this fix —
noted here so a future sweep doesn't have to rediscover it.)

### Failure scenario

1. Resend sends an `email.bounced` webhook; our route verifies it and inserts one `email_events`
   row, then returns 200.
2. The 200 is lost in transit (or Svix redelivers for its own reasons) — Svix retries the SAME
   event, same `svix-id`, same payload.
3. The route has no record of having already processed that `svix-id`, so it inserts a **second**
   row for the identical delivery.
4. `GET /api/admin/email-events` (the only consumer of this table) aggregates `COUNT(*) GROUP BY
   template_tag, event_type` over a time window — the duplicate row inflates that count, so the
   deliverability dashboard (sent/delivered/opened/bounced/complained per template) over-reports
   exactly the events that got redelivered, with bounce/complaint counts — the ones ops actually
   watches for reputation risk — no exception.

No downstream suppression/entitlement logic reads `email_events` today (confirmed via
`grep -rn email_events src/` — the only writer is this route, the only reader is the admin
observability route), so the blast radius is dashboard-accuracy only, not a security or billing
issue. It is still a real, silently-wrong number on a page a human reads to make judgment calls.

### Evidence

- Added `src/app/api/webhook/resend/route.test.ts` (did not exist before this fix — the route had
  zero test coverage).
- RED/GREEN proof: stashed the route fix (`git stash -- src/app/api/webhook/resend/route.ts`),
  re-ran the new test file — the "redelivered event is NOT inserted twice" case failed
  (`redelivery must be acked as a duplicate: + undefined - true`), the other two cases happened to
  pass incidentally (they don't exercise the dedup path). Restored the fix (`git stash pop`) — all
  3/3 pass.
- Confirmed the fix does not change the module's claimed field-indexing contract (`extractIndexed`
  still keeps the full raw payload in `metadata` regardless of which fields it can index) — this
  fix is purely about *whether* a row is inserted, not what fields the row carries.

### Fix

Mirror `webhook/whop/route.ts`'s `claimWhopEvent`/`releaseWhopEventClaim` pattern exactly, using
the shared `sharedCacheSetNx`/`sharedCacheDel` primitives (`src/lib/shared-cache.ts` — the same
atomic Redis `SET NX EX` claim primitive the Whop route's own hand-rolled Redis client achieves
manually; reusing it here avoids a second hand-rolled Redis connection for the same purpose):

- **Claim before processing** (`resend:event:<svix-id>`, 24h TTL — mirrors `claimWhopEvent`'s own
  TTL choice): a redelivery that's already been claimed is ack'd with `{ ok: true, duplicate:
  true }` and never reaches the INSERT.
- **Release the claim on a processing failure** (the DB insert throws): otherwise a transient DB
  error would permanently "poison" that `svix-id` — Svix's own retry of the exact same event would
  find the key already claimed and be silently swallowed as a duplicate of an attempt that never
  actually persisted anything. This is the identical bug `releaseWhopEventClaim`'s own doc comment
  describes and fixes for the Whop route; the Resend route is simply the second place in this repo
  the same shape could recur.
- **Fail open** (`.catch(() => true)` on the claim) if Redis itself errors mid-call — same bias as
  every other best-effort guard in this file and in `ip-rate-limit.ts`: never drop a genuine,
  first-time delivery over an infra blip. With no `REDIS_URL` configured at all, `sharedCacheSetNx`
  already falls through to its per-process in-memory NX map, which still gives correct dedup
  within one replica (not cross-replica, same documented limitation as every other `shared-cache.ts`
  caller without Redis).

### Fix rationale — why `sharedCacheSetNx` and not a second hand-rolled Redis client

`webhook/whop/route.ts` builds its own `makeRedis(...)` client inline for `claimWhopEvent` because
it predates `shared-cache.ts`'s `sharedCacheSetNx` (per that function's own doc comment, it is "the
cross-replica idempotency primitive" — built for exactly this kind of atomic claim, and already
used by the swing-discovery cron's overlap guard). Reusing it here is less code, no new Redis
connection management to get wrong, and has its own dedicated test suite
(`src/lib/shared-cache.test.ts`) already proving the atomic-claim semantics this fix depends on.

### Blast radius

Only `src/app/api/webhook/resend/route.ts`. `extractIndexed`, the INSERT's column list, and the
`email_events` schema are all unchanged. The sibling `admin/email-events` read route needed no
change — it already just counts whatever rows exist; this fix stops wrong rows from being created
in the first place. `webhook/whop/route.ts` (the pattern this fix mirrors) and `shared-cache.ts`
(the primitive it reuses) are both read-only references, not touched.

### Tests

`src/app/api/webhook/resend/route.test.ts` (new):
- "a redelivered event (same svix-id) is NOT inserted twice" — the regression proof (RED pre-fix).
- "two different svix-ids each insert their own row (not over-deduped)" — guards against an
  over-eager key or a key that doesn't actually vary per event.
- "a retry AFTER a failed insert is reprocessed, not swallowed as a duplicate" — proves the
  release-on-failure path, mirroring `releaseWhopEventClaim`'s own stated purpose.

`npx tsx --experimental-test-module-mocks --test src/app/api/webhook/resend/route.test.ts
src/app/api/webhook/whop/route.test.ts src/lib/shared-cache.test.ts src/lib/email/*.test.ts`:
33/33 pass. `npx tsc --noEmit` and `npx eslint src/app/api/webhook/resend/route.ts
src/app/api/webhook/resend/route.test.ts` both clean.
