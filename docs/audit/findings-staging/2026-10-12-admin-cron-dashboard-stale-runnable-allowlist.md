## 2026-10-12 — [Admin] AdminCronDashboard's "Run now" allowlist drifted to 3 of 19 dispatchable crons — FIXED
> **kind:** `FINDING`

| **Area** | **Severity** | **Status** |
|---|---|---|
| Admin console / incident tooling | P2 — hides a real self-heal affordance during incidents | FIXED |

**What's wrong.** `src/components/admin/AdminCronDashboard.tsx`'s `RUNNABLE_CRONS` (a client-side
allowlist gating the "Run now" button, `const runnable = RUNNABLE_CRONS.has(job.key)`) had only
3 entries: `flow-ingest`, `uw-cache-refresh`, `heatmap-warm`. `src/lib/cron-dispatch.ts`'s
`CRON_DISPATCH` — the actual backend dispatch table `/api/admin/cron/run` gates on via
`isDispatchableCron()` — has grown to **19** entries over many follow-on PRs (`meridian-warm`,
`desk-warm`, `zerodte-warm`, `spx-evaluate`, `market-regime-detector`, `spx-signal-observe`,
`vector-universe-snapshot`, `vector-full-state-snapshot`, `vector-walls-warm`,
`vector-bead-record`, `vector-dark-pool-warm`, `vector-pick-sweep`, `coaching-alerts`,
`bie-full-state-snapshot`, `swing-active-refresh`, `nighthawk-playbook`, plus the original 3).
The component's own comment ("Keep in sync with CRON_DISPATCH") was never honored after the
initial ship — confirmed via git history: the Set hasn't changed since the feature's introducing
commit, which still referenced an old handler name (`nights-watch-warm`) nobody updated either.

**Impact.** An admin investigating a stale RTH-critical cron — e.g. `vector-universe-snapshot`
or `swing-active-refresh`, both explicitly documented in `cron-dispatch.ts`'s own comments as
self-heal-covered, idempotent warmers an admin should be able to re-nudge during an incident —
saw no "Run now" button for them at all, even though the backend fully supports dispatching
them. The gap fails silently (no button, no error), making it easy to miss mid-incident.

**Fix.** Updated `RUNNABLE_CRONS` to the current, complete 19-entry list matching
`CRON_DISPATCH` exactly.

**Why not just import `DISPATCHABLE_CRONS` from `cron-dispatch.ts`?** `cron-dispatch.ts` pulls
in the real cron route handlers (`next/server`, DB-touching provider code) to invoke them
directly — importing it into `AdminCronDashboard.tsx` (a `"use client"` component) would pull
that server-only code into the client bundle. Kept the two lists independent but added a
regression guard instead.

**Regression guard added.** New `src/components/admin/admin-cron-dashboard-runnable-crons.test.ts`
(none existed): statically parses both files' source text and asserts the two key sets are
identical — catches drift in either direction (missing or stale entries) without crossing the
client/server import boundary. Verified RED→GREEN: reverting just the fix fails with the exact
list of missing crons; restoring it passes (1/1).

**Verification.** `tsc --noEmit` clean.

**Blast radius.** `AdminCronDashboard.tsx`'s `RUNNABLE_CRONS` constant only — purely additive
(more buttons now render); no change to the backend dispatch table or any cron's own behavior.

Found via a background Explore-agent sweep of SEO plumbing and the admin dashboard,
independently re-verified (counted `CRON_DISPATCH`'s real entries directly from source — 19, not
the 20 the agent's report estimated — confirmed the backend gate via `isDispatchableCron()`, and
confirmed the client/server import hazard that ruled out the most obvious fix) before fixing.
