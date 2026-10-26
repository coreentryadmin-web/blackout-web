## Welcome-sequence cron: a single row's thrown error aborted every row still queued behind it in the same batch, up to 200 rows

> **kind:** `FINDING`

`processDueWelcomeSequenceSteps()` (`src/lib/welcome-sequence.ts`, run hourly by
`src/app/api/cron/welcome-sequence/route.ts`, up to `limit=200` due rows per invocation) looped
over every due row with no per-row error isolation — the entire `for (const row of due.rows)`
loop body ran inside one `try` wrapping the whole batch. A transient failure on a SINGLE row's
state-advance `UPDATE` (e.g. a dropped DB connection right after a successful send — the kind of
blip the file's own `MAX_STEP_LATENESS_DAYS` comment already treats as expected and recoverable)
threw out of the loop entirely: the `catch` at the bottom logged it and returned, but every row
still queued behind the failing one in that batch was silently skipped for that run, not just the
one row that actually had the problem.

**Blast radius:** on a backlog (the file's own comments describe exactly this scenario — the cron
was unscheduled in production for a stretch before 2026-08-08), a single flaky row near the front
of a 200-row batch could silently suppress sending to every member queued behind it that hour.
Those rows aren't lost permanently (`next_send_at` stays in the past, so the next hourly run picks
them up again), but each such event delayed an arbitrary number of real members' welcome emails by
at least one cron cycle with zero visibility beyond a single `console.warn`.

**Fix:** wrap each row's processing in its own `try/catch` so one row's failure increments
`result.failed` and is logged with its `user_id`, while every other row in the batch is still
processed normally. Moved `result.sent++` to fire only after the state-advance `UPDATE` actually
commits (not right after a successful `sendEmail()` call) — a send whose follow-up `UPDATE` throws
now correctly counts as `failed` (its `next_send_at` never advanced, so the next run retries the
same step) rather than being double-counted as both sent and silently dropped.

**Evidence (RED → GREEN):** new test `"a thrown error advancing one row's state does not abort
the rest of the batch"` in `src/lib/welcome-sequence.test.ts` — 2 due rows, row 1's state-advance
`UPDATE` throws. Pre-fix: only 1 email sent (row 2 never processed), result `{processed: 2, sent:
1, failed: 0}` with the second row silently missing. Post-fix: both rows send,
`{processed: 2, sent: 1, failed: 1}` — row 1 correctly counted as failed (will retry next run),
row 2 unaffected. Full suite 14/14 pass post-fix; `tsc --noEmit` and `eslint` clean on both
touched files; sibling test files that import this module (`webhooks/clerk/route.test.ts`,
`email-captures.test.ts`) re-run clean.

| **Status** | FIXED (PR #TBD) |
