## Admin SPX health issue `id`s were order-dependent, breaking critical-alert dedup — FIXED

> **kind:** `FINDING`

**Status:** Fixed, regression test added (`src/lib/admin-spx-issue-id.test.ts`).

### Root cause

`buildSpxAdminIssues` (`src/lib/admin-spx-issues.ts`) assembles the admin health panel's list of
SPX pipeline issues (database/providers/desk/flow/websocket/engine/etc.) via a local `push()`
helper. Every call site that doesn't supply an explicit `id` fell back to:

```ts
id: row.id ?? `${row.category}:${issues.length}:${row.title.slice(0, 24)}`
```

`issues.length` is the array's length **at the moment this particular issue is pushed** — i.e. how
many *other, unrelated* issues already fired earlier in this same build. Every one of the ~30
`push()` call sites in this file is gated by its own independent condition (Postgres reachable?
a provider configured? desk price > 0? flow age? websocket state? …), so whether an earlier,
completely unrelated issue exists changes the array position — and therefore the default `id` — of
every later issue, even though nothing about the later issue itself changed.

Concretely: if "Postgres unreachable" (`database`) fires ahead of "Flow data stale" (`flow`) on one
poll, the ongoing flow issue gets `flow:1:Flow data stale`. The moment the Postgres hiccup clears
(a routine, brief flap — totally unrelated to the flow issue), the very next poll, with the flow
issue still ongoing and unchanged, assigns it `flow:0:Flow data stale` instead.

### Blast radius

`admin-critical-alerts.ts`'s `maybeAlertCriticalIssues` keys its "have we already Discord-alerted
on this" dedup set (`seenCritical`) directly by `issue.id`, and its DB-bootstrap step
(`bootstrapSeenFromDb`) tries to pre-seed that set from `admin_incidents.fingerprint` after a
process restart — both assume `issue.id` is a *stable identity* for one specific issue, exactly the
convention every other issue producer in this codebase follows (`admin-health.ts`'s synthetic
issues use fixed ids like `"rate_limit:redis_degraded"`; `admin-incidents.ts`'s own
`fingerprintFor(issue)` is `${issue.category}:${issue.title}` — no index, no truncation). Two
concrete consequences:

1. A persistent critical SPX issue can re-fire a fresh `"SPX CRITICAL"` Discord page on any poll
   that happens to land right after some unrelated earlier issue's presence changed, even though
   the issue being paged about never stopped and was already alerted on.
2. `admin_incidents.fingerprint` (stable `category:title`, written by `admin-incidents.ts`'s own
   `syncAdminIncidents`) never matched this file's `category:index:title.slice(0,24)` format even
   before the index instability — the title truncation alone broke the match — so
   `bootstrapSeenFromDb`'s whole point (don't re-alert immediately after a restart for something
   already alerted in the last 24h) was silently inert.

### Fix rationale

Split the id-assignment into a new, dependency-free sibling module,
`src/lib/admin-spx-issue-id.ts` (`stableIssueId(category, title)` → `${category}:${title}`, plus
`pushWithStableId`, the exact mechanism `admin-spx-issues.ts`'s `push()` now delegates to).
`admin-spx-issues.ts` itself transitively imports `"server-only"`-guarded providers
(`buildMarketHealthSnapshot` → … → `gex-positioning.ts`) and cannot be imported under the plain
node test runner — the same reason `admin-api-dashboard-match.ts` was already split out of
`admin-api-dashboard.ts` in this codebase. Pulling the id logic into its own module makes the
actual buggy mechanism unit-testable without that chain.

The new formula (`${category}:${title}`, no index, no truncation) is deliberately identical to
`admin-incidents.ts`'s `fingerprintFor`, so the two now agree — closing the bootstrap gap as a
side effect, not just the within-process re-alert bug. Multiple issues sharing one category+title
within a single build (today: only the `info`-severity "Play gate block"/"Play gate warning"
loops, one push per live string in `detail`) now collapse onto the same id; this is acceptable
because `maybeAlertCriticalIssues` only acts on `severity === "critical"` rows, and no two
`push()` call sites with `severity: "critical"` in this file share a category+title (checked
against every call site).

### Evidence

`src/lib/admin-spx-issue-id.test.ts` — `pushWithStableId: a later issue's id does not depend on
how many unrelated issues were pushed before it` and `maybeAlertCriticalIssues: a persistent
critical issue is not re-alerted merely because an unrelated earlier issue's presence changed its
position in the array` both reproduce the exact scenario above (an unrelated "database" issue
present on poll 1, absent on poll 2) through the real `pushWithStableId` production code path.
Reverting `pushWithStableId`'s formula to the pre-fix `${category}:${issues.length}:${title.slice(0,
24)}` fails both tests: the id mismatches `flow:1:Flow data stale` vs `flow:0:Flow data stale`,
and `maybeAlertCriticalIssues` reports a second, spurious new-critical-alert (`1 !== 0`) on the
second poll. Restoring the fix (`${category}:${title}`) passes all 4 new tests plus the existing
17 `admin-incidents*.test.ts` tests unchanged.
