# db.ts: checked-out pool clients had no 'error' listener — raw uncaughtException on connection drop — FIXED

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | FIXED |
| **Area** | `src/lib/db.ts` — every raw `pool.connect()` checked-out client (migrations advisory lock, `spx_signal_log` dedup transaction, `deleteUserDataForClerkId`, `dbClient()`, `acquireHeldLock`/held session-advisory-lock clients, `insertOpenSpxPlay`, `withSwingRollTx`) |
| **Severity** | P3 — error-rate. One live occurrence in a 24h CloudWatch window, self-recovered (ECS restarted the task), not systemic — but a real gap in an otherwise deliberately-hardened surface |
| **Found by** | DISCOVERY 24/7 audit sweep, 2026-09-04 |

## Root cause

`src/lib/db.ts` already has a `livePool.on("error", (err) => ...)` handler on the shared `Pool`
specifically to stop an **idle** pooled client's connection drop from becoming a fatal
`uncaughtException` (the comment above it says so explicitly), and prior PRs had already swept the
file so essentially every query goes through `dbQuery`'s try/catch+retry wrapper. Despite that,
CloudWatch Logs showed one raw `uncaughtException: [Error: Connection terminated unexpectedly]` —
node-postgres's exact wording for a connection dropping unexpectedly.

The finding as written suspected a missing/incomplete try/catch around a raw `pool.connect()`
transaction helper. **That theory does not survive contact with the actual code**: every raw
checked-out client in `db.ts` (7 call sites, enumerated above) already wraps its queries in
try/catch/finally and releases the client correctly. The real root cause is one level deeper, in
`pg`/`pg-pool`'s own event wiring:

1. **`pool.on("error", ...)` only ever covers IDLE clients.** `pg-pool`'s `_acquireClient`
   explicitly **removes** a client's `'error'` listener for the entire time it is checked out via
   `pool.connect()` (`node_modules/pg-pool/index.js:344`, `client.removeListener('error',
   idleListener)`), and only re-adds it on `.release()` (`index.js:385`). So the pool-level
   handler this file already has does nothing for a client that is mid-checkout — exactly the
   state every one of these 7 code paths puts a client into.
2. **On an unexpected connection drop, `pg.Client` does TWO independent things, not one.**
   `node_modules/pg/lib/client.js`'s `'end'` handler (line ~203) both (a) rejects whatever query is
   currently in flight via `_errorAllQueries` (`err = new Error('Connection terminated
   unexpectedly')`) — this is the half a surrounding `try { await client.query(...) } catch`
   actually catches — and (b) **unconditionally** also calls `_handleErrorEvent(error)`, which does
   `this.emit('error', err)` **on the client object itself** (`client.js:416-423`). This second
   emission happens regardless of whether (a) had anything to reject — in particular, if the drop
   happens **between** two statements in a held transaction/session (no query in flight at that
   instant), `_errorAllQueries` is a no-op but the client still emits `'error'`.
3. **A Node `EventEmitter` with zero listeners for `'error'` throws that error synchronously** as
   an uncaught exception — this is a Node special case for the `'error'` event specifically. None
   of the 7 checked-out-client call sites in `db.ts` ever called `client.on('error', ...)`, so this
   was live and unguarded on every one of them.

This is why the try/catch hardening from prior PRs did not close the gap: the `'error'` event is
not a rejected promise at all, so no `try`/`catch` — however completely applied — can intercept
it. It is a second, independent emission from the same underlying socket-drop event, on the one
code surface (`pool.on('error')`) does not reach.

## Evidence

- Confirmed via `node_modules/pg-pool/index.js` and `node_modules/pg/lib/client.js` source (both
  vendored at the exact version this repo runs) — see the specific line references above.
- `src/lib/db.test.ts`, RED before / GREEN after (`git stash` on `src/lib/db.ts` alone, keeping the
  new tests — the documented repo convention):
  - Pre-fix: `guardCheckedOutClient is not a function` (TypeError — the export didn't exist), and
    the source-inspection test lists all 7 unguarded `.connect()` call sites verbatim.
  - Post-fix: `npx tsx --test src/lib/db.test.ts` → `tests 28 / pass 28 / fail 0`.
  - The first new test independently reproduces the underlying mechanism with a bare
    `EventEmitter` (`emit('error', ...)` with no listener really does throw synchronously),
    proving the test exercises the real Node/pg behavior rather than merely calling an API that
    happens to exist.
- `npx tsc --noEmit` clean across the repo after the change.
- `npm test` (Node 20, via `scripts/run-tests.mjs`): full suite green modulo the known pre-existing
  sandbox failures this repo's CLAUDE.md already documents (`zerodte-service.test.ts`
  livePnlPct/commit-latch/tier-passthrough on `POLYGON_API_BASE`/DB-unreachable sandbox artifacts,
  and one `resolveGithubRepo` env-leakage test) — no new failures introduced by this change.

## Blast radius

All 7 raw `pool.connect()` checked-out-client sites in `db.ts` share the identical root cause and
were all missing the listener — fixed in the same pass since they share one new helper:

1. `runMigrations`'s dedicated migration-advisory-lock connection (`lockClient`).
2. The `spx_signal_log` dedup + unique-index transaction, nested inside `runMigrations`.
3. `deleteUserDataForClerkId` — multi-table `BEGIN`/…/`COMMIT` transaction.
4. `dbClient()` — **exported**, hands a raw checked-out client to external callers
   (`src/lib/run-migration.ts`, `src/lib/largo/largo-store.ts`,
   `src/features/spx/lib/spx-play-store.ts`) for manual transaction management. Fixing it here
   protects every one of those call sites automatically, without requiring each to know about this
   footgun.
5. `acquireHeldLock`/`releaseHeldLock` (backing `tryAdvisoryLock`/`releaseAdvisoryLock` and
   `tryAcquireSpxEvaluateLock`/`releaseSpxEvaluateLock`) — the **highest-risk** site: the client is
   held in the module-level `heldLockClients` map for the caller's entire critical section
   (potentially the whole duration of a cron run), maximizing the idle-but-checked-out window in
   which a connection drop hits with no query in flight — the exact scenario `_errorAllQueries`
   cannot catch. This is very plausibly the actual live occurrence (a single 24h event fits a
   long-held advisory lock far better than a query that completes in milliseconds).
6. `insertOpenSpxPlay` — matches the finding's own location hint precisely.
7. `withSwingRollTx` — runs an arbitrary caller-supplied `fn(tx)` inside the held transaction,
   another checkout with a potentially long idle-in-transaction window.

No other file needed changes: `dbClient()` being fixed here is what makes the three external
callers safe without touching them, and no second raw `new Pool()`/`new Client()` exists anywhere
else in `src` (confirmed by the same grep the finding's own evidence section cites).

## Fix rationale

Added one small exported helper, `guardCheckedOutClient<T extends PoolClient>(client: T): T`,
placed immediately after `getPool()` (right before it's first needed by `runMigrations`) and
documented with the exact mechanism above so a future reader doesn't have to re-derive it from pg
internals. It attaches a `client.on('error', ...)` listener that logs-and-swallows, mirroring the
existing `livePool.on("error", ...)` swallow+log convention immediately above it in the same file
— same tone, same "recovered, not fatal" framing — scoped to the one gap that pattern doesn't
reach. Every one of the 7 call sites now reads `guardCheckedOutClient(await ...connect())` inline,
a one-line change at each site with no control-flow restructuring.

Deliberately **not** changed:
- The existing try/catch/finally structure at each site — it is correct and still does its job
  (rejecting/rolling back the in-flight query). The fix is additive, not a replacement.
- `dbQuery`'s retry/backoff path — unaffected; this finding is specifically about the raw-client
  surface `dbQuery` does not cover.
- No new dependency on `AWS creds` / CloudWatch access was needed or used for the code-level fix
  (this sandbox run had no live AWS creds available to re-pull the original CloudWatch event; the
  fix and its evidence are entirely code/test-level, per the task's own allowance for that case).

## Market-open validation

Logged in `docs/audit/MARKET-OPEN-VALIDATION.md` — nothing to visually confirm on the live board
(this is a backend crash-prevention fix with no UI surface), so the checklist item there is a
CloudWatch absence-check: confirm no further raw `uncaughtException: [Error: Connection terminated
unexpectedly]` events appear in `/ecs/blackout-production` across a full RTH session, especially
around `spx-evaluate`/migration-boot/swing-roll activity (the three sites most likely to hit the
long-held or between-statement window this fix closes).
