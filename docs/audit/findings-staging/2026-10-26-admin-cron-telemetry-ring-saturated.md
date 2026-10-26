> **kind:** `FINDING`

## Admin console Crons tab "Telemetry" ring was permanently saturated at 100% — FIXED

**Status.** FIXED (PR #6791, merged to `main`).

### Area

`src/components/admin/AdminCronDashboard.tsx` — the Admin console's Crons tab (`/admin?tab=crons`), the "Telemetry" `WinRateRing`. Non-owned lane.

### Found by

Live-UI visual check via `proxy-browser.cjs` against prod `/admin?tab=crons` (desktop viewport, `mintAdminE2ESession`), DISCOVERY-lane sweep, 2026-10-26.

### Root cause (confirmed by source, not inference)

```ts
<WinRateRing
  value={Math.min(1, data.logged_runs_total / 50)}
  label="Telemetry"
  sub={`${data.logged_runs_total} events`}
  tone="cyan"
  size={118}
/>
```

`data.logged_runs_total` comes from `src/lib/db.ts`'s `fetchCronJobRunCount()`:

```ts
const res = await dbQuery<{ count: string }>(
  `SELECT COUNT(*)::int AS count FROM cron_job_runs`
);
```

— an unbounded, all-time cumulative count. Dividing this by a hardcoded `50` and clamping to `1` means the ring reads 100% once the all-time total exceeds 50 rows, which happens within hours of a live cron fleet starting, and **stays at 100% forever after**, because the counter only ever grows. Live-captured: `logged_runs_total=76494`, ring pinned at 100%.

Crucially, this gauge cannot ever read anything other than ~100% once saturated — **even during a genuine telemetry outage** where cron runs stop being logged entirely, because the stale cumulative total from before the outage remains far above 50. The ring is structurally incapable of ever reflecting a real degradation.

### Fix

Extracted `computeTelemetryCoveragePct(jobs)` — a pure 0-1 ratio of "jobs with at least one logged run in the last 24h" over total job count, using the per-job `runs_24h: { ok, failed, skipped }` data already present in the payload and already rendered per-card elsewhere on the same page. No API or schema change. This mirrors the sibling rings on the same row (Online/Failed/Dark), which are all genuine total-based ratios that can move with real system state.

### Blast radius

`AdminCronDashboard.tsx` is the sole consumer of `logged_runs_total` for a percentage computation (confirmed via repo-wide grep — every other reference uses it as a raw count label, e.g. the `Logged` metric chip and the `sub` text, both left unchanged since those are honest raw counts, not percentages).

### Tests

5 new tests in `AdminCronDashboard.test.ts`, including the exact live shape (a huge all-time cumulative total must NOT saturate the new ratio). RED→GREEN confirmed via `git stash` (5/5 fail pre-fix on missing export, 5/5 pass post-fix). `npx tsc --noEmit` clean. Full suite: 16999 pass / 0 fail / 3 pre-existing skips (unrelated).
