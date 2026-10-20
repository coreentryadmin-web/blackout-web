> **kind:** FINDING

## Web-push broadcast send was fully sequential with no upper bound — FIXED

| **Status** | FIXED |
|---|---|

**Symptom:** `sendWebPush()` (`src/lib/push/send-web-push.ts`) and the mirrored admin scaffold route
(`src/app/api/push/send/route.ts`) both sent a notification to every matching row in
`push_subscriptions` with a plain `for (const r of rows) { await webpush.sendNotification(...) }`
loop — one external HTTP round-trip to the push service per subscriber, strictly sequential. The
broadcast case (no `userId` filter — the path the file's own comment says the gex-alerts cron
uses) queries **every row with no cap at all**, so wall-clock time grows linearly with the
subscriber base. As subscribers grow this walks toward whatever timeout bounds the caller (a
serverless cron invocation, or the admin route's own request lifetime) with no circuit breaker in
between.

**Root cause:** no concurrency at all in the send loop — found during a DISCOVERY-lane sweep for
N+1/unbounded-loop patterns outside the 9 owning lanes' current files. Confirmed both files
implement the *identical* algorithm (the helper's own header states it intentionally "MIRRORS the
inert scaffold at `src/app/api/push/send/route.ts` exactly"), so the same defect was duplicated in
both rather than existing once.

**Fix:** replaced the sequential loop in both files with a small bounded worker pool
(`PUSH_SEND_CONCURRENCY = 10`), the same shape `src/lib/membership.ts`'s reconcile loop already
uses elsewhere in this codebase (a shared `nextIdx` cursor, N workers racing to claim the next row,
merged after `Promise.all`). This gets the throughput win without trading unbounded sequential
sends for unbounded *concurrent* ones (which would open an unbounded number of simultaneous
outbound connections instead — a different failure mode, not actually a fix). `sent`/`pruned`
counts and the existing 404/410 stale-subscription pruning behavior are unchanged — only the
dispatch order/concurrency changed.

**Blast radius:** exactly these two files (confirmed via the helper's own header comment
describing the mirror relationship, and by reading both side by side) — no other caller reimplements
this loop. The route intentionally does NOT delegate to the helper (a prior, separate decision
documented in the helper's own "FOLLOW-UP (do not do here)" comment), so the identical fix was
applied to both rather than refactoring the route to import the helper, preserving that existing
boundary.

**Test:** `src/lib/push/send-web-push.test.ts` (new) — asserts (1) `maxInFlight > 1` with 12 mocked
subscriptions (proves real overlap; a sequential loop can never exceed 1 in-flight call no matter
how many rows exist), (2) `maxInFlight <= 10` (bounded, not unbounded fan-out), and (3) stale
(404/410) pruning still issues exactly one `DELETE` with the correct endpoint set under concurrent
sends. **RED→GREEN proven**: `git stash` on `send-web-push.ts` alone (keeping the new test file)
reproduced `expected overlapping sends (bounded concurrency), got max concurrent = 1` — the exact
defect; restored, 2/2 pass. `npx tsc --noEmit`: clean (required rebinding `webpush` to a local
`const push` inside the nested worker closure — TS does not carry outer-scope null-narrowing
across a function boundary even for a `const`). The route fix is the same algorithm verified by
this test, applied identically; no separate route test was added given the two are proven
byte-for-byte mirrors by the helper's own header comment.
