## 2026-10-20 — [FINDING, P2 Night Hawk 0DTE] Skip-grading backlog — rejected setups weren't being graded, fixed

> **kind:** `FINDING`

| **Status** | FIXED — merged #6301 |
|---|---|

**Context.** Member audit directive: "find why rejected setups aren't being graded, fix the cause,
and verify that new production records receive accurate grades... keep the grading backlog and
14-day data loss in scope... preserve recoverable records before they expire."

### Root cause

`runSkipGrading` (`src/lib/zerodte/skip-grading.ts`) is the counterfactual grader behind
`zerodte_scan_rejections.counterfactual_json` — the only instrument that answers "did a hard gate
block a winner." Invoked once/day, post-close, by the `zerodte-skip-grade` cron. Its query:

```sql
SELECT id, observed_at, session_date, ticker, gate_failed, direction
  FROM zerodte_scan_rejections
 WHERE counterfactual_json IS NULL
   AND session_date >= $1   -- today - MAX_SKIP_GRADE_DAYS (14)
   AND session_date < $2    -- today
 ORDER BY observed_at ASC
 LIMIT $3                   -- MAX_ROWS_PER_RUN (200)
```

Real rejection volume runs ~2,000+ distinct-state rows/day (measured live). 200/run cleared under
10% of a single day's own volume before even touching any backlog — and because `since`
(`today - 14 days`) moves forward every single day, a row never reached within its 14-day window
was never graded, period, not merely delayed.

### Evidence

Measured live 2026-10-20 via `/api/admin/zerodte/rejection-export`: FOUR real session days
(2026-10-16, 10-15, 10-14, 10-09 — 4 to 11 days old at the time) each showed **exactly 2000/2000
rows with `counterfactual: null`**. Checked `cron-health`: the cron itself was running fine
(`last_status: "ok"`, `graded: 179/scanned: 200` on its most recent run) — working exactly as
designed, the design just couldn't keep up with real volume.

Checked whether this was real data loss: **no.** Grepped the whole app for any retention/purge job
touching `zerodte_scan_rejections` and found none — rows are never deleted. Nothing was destroyed;
the grading *query* simply gave up on anything past 14 days.

### Fix

`MAX_SKIP_GRADE_DAYS` 14→35, `MAX_ROWS_PER_RUN` 200→500. A real 200-row run (`zerodte-skip-grade`,
2026-10-19 17:00 ET) took 32.4s against the route's own 120s `maxDuration` (2.5x headroom); 500
rows scales to ~81s even under a conservative linear assumption, comfortably inside budget. Pure
application-code change — the existing daily cron picked it up automatically on next deploy, no
infra/EventBridge change needed.

**Does not fully close the gap**: full backlog drainage additionally needs the cron to run more
than once/day (an infra/EventBridge schedule change via `railway.zerodte-skip-grade.toml`'s
`cronSchedule`), which needed AWS access unavailable in that session — flagged as a follow-up.

**Also backfilled independently** (`scripts/audit/zerodte-skip-grade-backfill.mjs`, new tool):
reuses `gradeSkippedPlay` directly (never reimplemented) to grade real rejections the live cron
hadn't reached yet, read-only w.r.t. the live DB (no write path from the sandbox). First run:
27,586 rows graded across 14 real session days — `score_floor` (n=12,955) and `thesis_rank_reject`
(n=7,111), ~78% of all rejections by volume, both landed at a near coin-flip false-block rate
(47.6% / 48.6%) on UNDERLYING-basis grading (not real option costs — see the tool's own header for
the full caveat). No gate changed on this evidence; flagged as a real-cost re-grade candidate.

### Tests

New regression (`src/lib/zerodte/skip-grading.test.ts`) pins the raised constants reaching the real
SQL query's `since`/`limit` params, not silently re-clamped, plus confirms a caller-supplied `days`
beyond the new ceiling still clamps to it. RED→GREEN proven (stashed the fix, confirmed 1/17 new
failure against the old 14/200 constants; restored, 17/17 pass). `npx tsc --noEmit`: clean.

### Blast radius

`MAX_SKIP_GRADE_DAYS` is exported and read only by `runSkipGrading` itself and its test file — no
other caller. `MAX_ROWS_PER_RUN` is module-private. No gate, threshold, filter, or live
trading-path behavior touched — this only widens what the diagnostic skip-grader can see.
