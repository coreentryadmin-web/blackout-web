> **kind:** FINDING

## `vector-alerts` cron re-queried `vector_alert_rules` once per (user, ticker) pair — N+1 — FIXED

| **Status** | Fixed |
|---|---|

**Found:** 2026-10-20, DISCOVERY-lane N+1 query / missing-index sweep, via a background Explore-
agent audit of non-owned-lane data paths.

**Root cause:** `src/app/api/cron/vector-alerts/route.ts` already ran one bulk query
(`SELECT DISTINCT user_id, ticker FROM vector_alert_rules WHERE enabled = true`) to get every
`(user, ticker)` pair needing evaluation this tick. The per-pair evaluation loop then re-queried
the full rule rows **again, once per pair**:
```sql
SELECT id, ticker, kind, tolerance_pct, enabled
  FROM vector_alert_rules
 WHERE user_id = $1 AND ticker = $2 AND enabled = true
```
Every column this second query needed (`id`, `ticker`, `kind`, `tolerance_pct`, `enabled`, plus
`user_id`) could have been selected in the first bulk query and grouped in memory by
`(user_id, ticker)` — there was never a reason to re-query per pair. The sibling
`helix-alert-notify.ts` does the equivalent lookup correctly (one query per ticker, reused across
every matching rule); this route itself does its ticker-level context fetch correctly (one fetch
per distinct ticker, shared across users) but regressed to per-pair querying specifically for the
rule rows.

**Live impact:** with N members having enabled Vector alert rules on a given tick, the loop fired
N sequential DB round-trips instead of 1 — at N=200 pairs and ~5-15ms/round-trip, roughly 1-3
extra seconds of serialized DB latency added to a cron that also fans out `sendWebPush` calls and
is registered to run every 1-2 minutes during RTH once activated. Currently gated inert by default
(`VECTOR_ALERTS_PUSH` + VAPID unset in production), so today's live blast radius is zero — but the
code pattern was a real, fixable N+1 regardless of current activation state, and would start
costing real DB round-trips the moment this cron is turned on.

**Fix:** the bulk query now selects every column the loop needs (`user_id, id, ticker, kind,
tolerance_pct, enabled`) in one pass. Rows are grouped into a `Map<string, VectorAlertRuleRow[]>`
keyed by `` `${user_id}:${ticker}` `` while building the distinct-pairs list, and the per-pair loop
looks up its rules from that map instead of calling `dbQuery` again. `VectorAlertRuleRow` (the
shared type, also used by the per-user `/api/vector/alerts/rules` route which intentionally omits
`user_id`) is left unchanged — the bulk query's row type is a local intersection
(`VectorAlertRuleRow & { user_id: string }`) rather than a shared-type change.

**Blast radius:** single route. No change to `VectorAlertRuleRow`, `rowToAlertRule`, or any other
consumer of the shared rule-row type.

**Test:** `src/app/api/cron/vector-alerts/route.test.ts` — new regression test asserting the
per-pair loop's body contains no `dbQuery` call, and that the bulk query selects `user_id`.
RED→GREEN proven via `git stash` on `route.ts` alone (fails without the fix, passes with it).
Combined with `lib.test.ts`: 5/5 clean. Repo-wide `npx tsc --noEmit` clean.
