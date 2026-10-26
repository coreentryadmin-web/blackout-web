## flow-ingest's single fixed-size UW fetch silently drops alerts when a REST catch-up window exceeds one page — FIXED

> **kind:** FINDING

| | |
|---|---|
| **Area** | `src/lib/providers/flow-ingest.ts`, `src/app/api/cron/flow-ingest/route.ts` |
| **Status** | FIXED |

**Root cause.** `runFlowIngest()` fetched exactly one page (`fetchMarketFlowAlertRows({ limit: 100,
newer_than: cursor })`) per tick. UW's `/api/option-trades/flow-alerts` sorts **newest-first**, and
a `newer_than` filter does not change that — it still returns the top `limit` rows counting down
from "now", not the oldest `limit` rows counting up from the cursor. Confirmed live against
production UW (`UW_API_KEY` available in this sandbox): a `limit=200` fetch with `newer_than` set
~3 hours back returned only the newest ~55 minutes of that window — the ~2 hours between the
cursor and that boundary were silently absent from the response, not merely paginated elsewhere.
With a fixed `limit: 100` and no backfill, any tick where more than 100 new flow alerts landed
since the cursor would have the cursor advance straight to the newest row processed, permanently
skipping every alert strictly between the old cursor and the oldest row actually returned — a
silent, invisible gap in the flow_alerts table every other desk (Helix, Vector, SPX, swing) reads
from.

**Why this is realistic in production.** REST ingestion only runs at all when the UW WebSocket
path is down (`ws_active`/`ws_active_cluster` skip the REST fetch entirely when the socket is
healthy and the PG tape is fresh). A WS outage spanning even 10-20 minutes during a volatile
session (FOMC, opex, an earnings-season burst) can easily produce more than 100 qualifying flow
alerts market-wide, which is exactly the condition under which this bug fires.

**Evidence.** Live UW API calls (read-only, two requests total):
```
GET /api/option-trades/flow-alerts?limit=200&newer_than=2026-10-23T18:00:00.000000Z
  → 200 rows returned, spanning 20:00:35Z .. 20:55:03Z only (not 18:00Z .. 20:55Z)
GET /api/option-trades/flow-alerts?limit=5&older_than=2026-10-23T20:00:35.428501Z
  → returns rows AT that exact timestamp again (older_than boundary is inclusive)
```
This directly reproduces the truncation and confirms the inclusive `older_than` boundary the fix
relies on for overlap-safe backfilling.

**Fix.** `runFlowIngest()` now loops: after a full page (`batch.length === PAGE_LIMIT`, 100), it
re-fetches with `older_than` set to that page's own oldest `created_at`, merging pages until a
short page is returned (gap fully backfilled) or `MAX_BACKFILL_PAGES` (5) is hit, at which point
the result reports `truncated: true` instead of silently losing the remainder — the next tick's
cursor-anchored fetch keeps working through whatever is left. Because `older_than` is inclusive,
adjacent pages overlap by exactly the boundary row(s); an in-process `seenInRun` set (by
`id`/`alert_id`, same key shape as `unusual-whales.ts`'s own `flowRowKey`) avoids a redundant
`persistAndPublishFlowAlert` call for that overlap (the DB's `alert_id` UNIQUE constraint would
also no-op it, but this skips the round trip). `route.ts` now surfaces `truncated` in
`logCronRun`'s payload so a sustained backlog is visible rather than invisible.

**Blast radius.** `src/lib/providers/flow-ingest.ts` (the fetch/backfill loop, `FlowIngestResult`
type) and `src/app/api/cron/flow-ingest/route.ts` (one added field to the existing `logCronRun`
call). No other caller of `fetchMarketFlowAlertRows` is affected — the backfill loop is local to
`runFlowIngest`; the shared fetch function's own signature and behavior are unchanged.

**Fix rationale.** The alternative of raising the single-page `limit` further only pushes the same
blind spot out further rather than closing it (UW's own per-request cap is 200, per
`fetchMarketFlowAlertRows`'s `Math.min(desired, 200)`), and silently fetching unbounded pages risks
starving the shared 2 RPS UW rate-limiter budget member traffic depends on — hence the explicit
`MAX_BACKFILL_PAGES` bound and the `truncated` signal rather than an unbounded loop.

**Tests.** `src/lib/providers/flow-ingest.test.ts` (new) — 3 cases: a short page needs no backfill;
a full page triggers exactly one backfill fetch with the correct `older_than` boundary and dedups
the inclusive-overlap row; a backlog deeper than the cap stops at exactly `MAX_BACKFILL_PAGES`
fetches and reports `truncated: true`. Confirmed RED pre-fix (all 3 fail — only ever 1 fetch call,
`truncated` undefined) via `git stash` of the two source files, GREEN post-fix. Existing
`src/app/api/cron/flow-ingest/route.test.ts` (source-scan regressions for the RTH gate and the
UW-sweep tag) still 3/3 pass, unaffected. `npx tsc --noEmit -p .` clean.
