## `deleteUserDataForClerkId` (Clerk `user.deleted` GDPR cleanup): missing 4 tables of real per-user content, and the pre-existing optional-table delete could abandon the WHOLE deletion mid-transaction

> **kind:** `FINDING`

`deleteUserDataForClerkId` (`src/lib/db.ts`) is the GDPR cleanup both the Clerk `user.deleted`
webhook (`src/app/api/webhooks/clerk/route.ts`) and the admin delete-user route
(`src/app/api/admin/users/[id]/route.ts`) call to purge a departing member's data. Its own doc
comment claims it "removes all rows keyed by clerk_user_id," but it only ever deleted from four
tables (`users`, `largo_sessions`, `user_journal`, `push_subscriptions`). Four more tables store
real per-user content keyed by the same Clerk user id and were never touched:

- `bie_interactions` — `user_id` + the member's own Largo chat **question text** (unconditionally
  migrated in `runMigrations()`, so it always exists). Only ever pruned by `db-cleanup-targets.ts`
  on a **time-based retention window** — not on a GDPR deletion request, which must be immediate.
- `welcome_sequence_state` — `user_id`, `email`, `first_name` (unconditionally migrated). Not even
  in `db-cleanup-targets.ts`'s retention allowlist, so nothing ever deletes it, ever.
- `helix_alert_rules` (`src/features/helix/lib/helix-alert-rules-db.ts`) — `user_id` + per-ticker
  alert config, lazily created on first use.
- `vector_alert_rules` (`src/features/vector/lib/vector-alert-rules-db.ts`) — same shape, lazily
  created.

**A second, independent bug in the existing code**, found while fixing the first: the original
`push_subscriptions` delete used a bare `try { ... } catch { /* lazily created */ }` inside the
surrounding `BEGIN`/`COMMIT` transaction. That does not actually contain the failure — once ANY
statement in a Postgres transaction errors, the whole transaction is marked **ABORTED**, and every
later statement on that same client (other than `ROLLBACK`) throws `current transaction is
aborted, commands ignored until end of transaction block`, regardless of whether the JS-level
error was caught. So on any environment where `push_subscriptions` had not yet been lazily
created (a fresh DB, or — going forward — any new optional table), the very next statement
(`DELETE FROM users...`) would throw, the outer `catch` would `ROLLBACK`, and the **entire**
deletion would fail and re-throw to the webhook handler — not "skip one optional table," but "the
member's `users` row never gets deleted either, and Clerk retries the webhook forever against the
same failure." This was latent (in production the table has existed since the first ever push
subscription), but adding `helix_alert_rules`/`vector_alert_rules` — both genuinely absent until a
member first sets up an alert for that specific engine — would have reintroduced it immediately
had the fix kept the same pattern.

**Fix:** added `DELETE FROM bie_interactions`/`welcome_sequence_state` (plain deletes — both
tables are unconditionally migrated, so they always exist) and a new exported
`deleteFromOptionalTable(client, table, column, value)` helper that wraps a single optional-table
delete in `SAVEPOINT` / `RELEASE SAVEPOINT` / `ROLLBACK TO SAVEPOINT` — the actual way to contain
a single statement's failure without aborting the surrounding transaction. `push_subscriptions`,
`helix_alert_rules`, and `vector_alert_rules` all now go through it. Table/column names are always
internal literal strings (never user input) at every call site, same identifier-can't-be-
parameterized precedent `db-cleanup-targets.ts`'s allowlist already documents.

**Evidence (RED → GREEN):** `src/lib/db.test.ts` adds a minimal fake `PoolClient` that enforces
the one real Postgres invariant this bug depends on (any statement failure aborts the transaction
until `ROLLBACK`/`ROLLBACK TO SAVEPOINT`). One test reproduces the OLD bare-try/catch pattern and
proves the next statement on the same client throws `current transaction is aborted` even though
its own JS-level catch "succeeded." A second test proves `deleteFromOptionalTable` contains the
same failure via `SAVEPOINT` and the next statement succeeds normally. A third, source-level test
asserts `deleteUserDataForClerkId`'s body deletes all 5 tables and routes every lazily-created one
through `deleteFromOptionalTable`, not a bare `try/catch`. `git stash` of only `src/lib/db.ts`
(keeping the new test file) reproduces 3 real failures against the pre-fix source; restoring the
fix brings the suite to 46/46 pass. `npx tsc --noEmit` and `npx eslint src/lib/db.ts
src/lib/db.test.ts` both clean. Sibling tests that import `deleteUserDataForClerkId`
(`src/app/api/webhooks/clerk/route.test.ts`) re-run clean — that file's own mock of the function
is untyped (`mock.module`), so the widened return shape is backward compatible; both real callers
only log the whole `deleted` object, never destructure individual fields.

| **Status** | FIXED (PR #TBD) |
