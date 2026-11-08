> **kind:** FINDING

## `countRecentErrorEvents` total was the sum of the top-8 error-source GROUPS, not the real window count — FIXED

| | |
|---|---|
| **Area** | `src/lib/error-sink.ts` (shared error sink) / `src/app/api/cron/cron-staleness-watchdog/route.ts` (consumer) |
| **Severity** | P2 — monitoring/alerting correctness: a real error-rate spike could silently under-report its severity or miss its alert threshold |
| **Status** | FIXED |

### Root cause

`countRecentErrorEvents(sinceMinutes)` is the generic "is the app erroring a lot right now"
probe the cron-staleness-watchdog uses for its error-rate spike alert (separate from the
per-source `countAuthFailures`/#7574 bug fixed earlier this session). It ran one SQL query:

```sql
SELECT source, scope, COUNT(*)::text AS count
  FROM error_events
 WHERE created_at > NOW() - ($1 || ' minutes')::interval
 GROUP BY source, scope
 ORDER BY COUNT(*) DESC
 LIMIT 8
```

and then computed the headline `total` as:

```ts
const groups = rows.map((r) => ({ source: r.source, scope: r.scope, count: Number(r.count) }));
const total = groups.reduce((sum, g) => sum + g.count, 0);
```

`total` is the sum of only the **top 8** `(source, scope)` groups the `LIMIT 8` query
returned — never the real count of rows in the window. Any window with **more than 8**
distinct `(source, scope)` combinations silently dropped every group past the 8th from the
total. Concretely: 20 distinct sources erroring 10 times each in the window is 200 real
error events, but the old code only ever summed the top 8 groups (at most 80, and often far
less once ties/ordering are accounted for) — a >50% undercount that gets *worse*, not
better, the more diverse the failure is. This is exactly the "total capped at
sample-query/page LIMIT" bug class already fixed four times this session
(`countAuthFailures` #7574, `summarizeRegimeEvents` #7575, the HELIX/dark-pool Discord EOD
recap #7576, UW dark-pool snapshot pagination #7577) — one layer deeper: here the `LIMIT`
is on an **aggregate breakdown** query, not a raw-row sample, but the same shape applies —
a bounded SQL result was reused as the unbounded total.

### Blast radius

`countRecentErrorEvents`'s `total` field feeds directly into
`classifyErrorSpike(recentErrors.total, errWarn, errCrit)` in
`src/app/api/cron/cron-staleness-watchdog/route.ts` (default thresholds: warn 25, crit 75
over a 15-minute window) — the ops channel's error-rate spike alert. The failure mode this
bug produces is the inverse of what an intuitive "it'll roughly work" read would suggest: a
spike concentrated in ONE source (few distinct groups) was counted correctly, but a spike
spread across MANY distinct failing sources/scopes — arguably the more dangerous shape,
since it suggests a systemic issue rather than one broken endpoint — was the one silently
undercounted, and could undercount enough to never cross `errWarn`/`errCrit` at all. The
same `error_events` table and `error-sink.ts` module are read by `src/lib/bie/discovery.ts`
and `src/lib/bie/diagnostic.ts` too, but those are out of scope for this fix (`src/lib/bie*`
is excluded this round) — they call the same now-fixed `countRecentErrorEvents`, so they
inherit the correct `total` for free with no separate change needed there.

### Evidence (RED → GREEN)

Added `shapeRecentErrorEventsSummary`, a pure split of the shaping logic (mirroring the
`shapeAuthFailureSummary` split `countAuthFailures` already uses for the identical reason),
and a regression test passing an 8-row top-groups sample (count 10 each, sum 80) alongside
a real `COUNT(*)` of 200 — the exact shape a 20-distinct-source spike produces.

- **RED** (`git stash push -- src/lib/error-sink.ts`, keeping only the new test):
  `shapeRecentErrorEventsSummary is not a function` — 3 failing subtests, including the
  exact regression test, confirming the test actually exercises the fix.
- **GREEN** (fix restored): `npx tsx --experimental-test-module-mocks --test
  src/lib/error-sink.test.ts` → 14/14 pass.

### Fix rationale

Same fix shape as `countAuthFailures` (#7574): run a second, unbounded `COUNT(*)` query in
parallel with the existing top-8 breakdown query, and use that real count as `total` — the
breakdown query now only ever feeds `groups` (the Discord/alert preview of which sources are
noisiest), never the headline number. `shapeRecentErrorEventsSummary` is split out exactly
like `shapeAuthFailureSummary` so the "total must come from COUNT(*), never from summing the
bounded sample" invariant is unit-testable without a live Postgres connection, and can't
silently regress back to `groups.reduce(...)` without the regression test catching it.
Nothing in `countRecentErrorEvents`'s public shape (`{ total, groups }`) changed, so its
existing consumers (`cron-staleness-watchdog/route.ts`, `bie/discovery.ts`,
`bie/diagnostic.ts`) needed no changes — the fix is entirely inside the sink.
