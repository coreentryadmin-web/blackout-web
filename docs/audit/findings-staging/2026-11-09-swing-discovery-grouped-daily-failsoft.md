# 2026-11-09: swing-discovery crashes its entire scan tick on a thrown same-day grouped-daily fetch

> **kind:** `FINDING`

**Status.** FIXED — this PR.

## Summary

`GET /api/admin/cron-health` showed `swing-discovery` at `runs_24h: {"ok":0,"failed":48,"skipped":22}`
over a full trailing-24h window on 2026-11-09, `last_message`: the raw thrown error
`"Polygon /v2/aggs/grouped/locale/us/market/stocks/2026-11-09 → 403"`.

Independently reproduced against the real production `POLYGON_API_KEY`/`POLYGON_API_BASE`:

```
GET /v2/aggs/grouped/locale/us/market/stocks/2026-11-09 → 403
{"status":"NOT_AUTHORIZED","message":"Attempted to request today's data before end of day.
Please upgrade your plan at https://polygon.io/pricing"}

GET /v2/aggs/grouped/locale/us/market/stocks/2026-11-06 (past settled date, same key) → 200
{"queryCount":12573,"resultsCount":12573,...}
```

A past date on the identical key returns 200 — ruling out a dead key or an entitlement/billing
loss (the already-documented Benzinga/real-time-snapshot entitlement losses in `CLAUDE.md` are a
*different* failure mode). This specific restriction — same-day grouped-daily blocked on this
Polygon/Massive plan tier until the provider finalizes "end of day" — is the identical root cause
the sibling 0DTE lane diagnosed and fixed the same day for `breakout-discovery.ts` (see
`docs/audit/findings-staging/2026-11-09-zerodte-breakout-fetch-failure-mislabeled-empty.md`), whose
blast-radius section explicitly named `src/app/api/cron/swing-discovery/route.ts` (three call
sites) as a separate, unaudited consumer of the identical `fetchDailyMarketSummary(...)` call,
"out of scope" for that PR. This is that natural follow-up, scoped to the swing-discovery lane.

## Root cause

`polygonGet` (`src/lib/providers/polygon.ts`) throws on any non-2xx response. In
`src/app/api/cron/swing-discovery/route.ts`'s `buildDiscoveryDeps`, `fetchGroupedDaily` awaited
`fetchDailyMarketSummary(to)` with no try/catch — the ONE direct, unguarded call site in the file.
A thrown same-day restriction propagated out of this dep and crashed the whole scan tick,
including the FLOW/POSITIONING/CATALYST origins that don't even read grouped-daily.

This dep is also the fallback `discovery.ts` itself calls when `fetchIntradayStructureBars()`
throws (`await deps.fetchIntradayStructureBars().catch(() => deps.fetchGroupedDaily())`) — so
without this fix, that fallback chain failed completely rather than degrading, since both call
sites hit the same underlying restriction on the same date.

The sibling call site inside `fetchBangerTickers` was NOT independently broken: it is already
routed through `fetchTier0OriginTickers` (`src/lib/swing/v2/tier0-origin-fetch.ts`), which already
catches a thrown fetch and reports `fetchError` gracefully (confirmed by its own existing test,
"thrown fetch sets fetchError and empty tickers") — so BANGER origin already degraded safely before
this fix; only the direct/fallback-chain `fetchGroupedDaily` call needed the fix.

## Evidence (RED → GREEN)

RED (pre-fix, via `git stash` isolating the source-file change while keeping the new test):

```
not ok 7 - swing-discovery's fetchGroupedDaily fails soft (returns []) instead of crashing the
whole scan on a thrown Polygon grouped-daily fetch
  error: 'the grouped-daily fetch must be wrapped in a try block'
# tests 7, pass 6, fail 1
```

GREEN (post-fix, source restored): `# tests 7, pass 7, fail 0`.

Also ran sibling suites: `src/lib/swing/discovery.test.ts` + `src/lib/swing/v2/tier0-origin-fetch.test.ts`
(36/36 pass, confirming `screenBreakoutMovers([], ...)` and `fetchTier0OriginTickers` both already
handle an empty/degraded grouped-daily input gracefully — no downstream change needed). `npx tsc
--noEmit`: clean. Full `npm test`: pending in this PR's CI run.

## Fix

`fetchGroupedDaily` now wraps `fetchDailyMarketSummary(to)` in its own try/catch, logging via
`console.error` (same style as this file's existing `fetchChainRows` fail-soft dep) and returning
`[]` on a throw — degrading the STRUCTURE/BANGER origins to "no movers this tick," identical to how
a genuinely-empty-but-successful grouped-daily response is already treated, rather than crashing
the entire scan. Mirrors this file's own established fail-soft convention (`fetchPositioningTickers`
/`fetchCatalystTickers`/`fetchChainRows`, all already labeled fail-soft) and the same-day decision
the sibling 0DTE fix made the same day: the underlying Polygon/Massive plan-tier restriction is not
fixable from this codebase (a provider plan-tier matter, not a bug), so this fix only makes the
existing failure degrade honestly instead of taking down origins that don't depend on it.

### What was deliberately left unchanged

- `fetchBangerTickers`'s own call to `fetchDailyMarketSummary(to)` — already fail-soft via
  `fetchTier0OriginTickers`, confirmed by existing tests; touching it would be redundant.
- `fetchIntradayStructureBars`'s initial `fetchDailyMarketSummary(to)` call — its own throw is
  already caught by the discovery.ts call-site fallback (`.catch(() => deps.fetchGroupedDaily())`);
  fixing `fetchGroupedDaily` itself closes that fallback chain without touching this dep directly.
- The underlying Polygon/Massive same-day grouped-daily plan restriction itself — not fixable from
  code, same category as the already-documented entitlement losses in `CLAUDE.md`.
- `src/features/nighthawk/lib/market-wide.ts`, `src/lib/bie/market-breadth.ts`,
  `src/lib/largo/run-tool.ts`, `src/features/spx/lib/spx-desk.ts`, and
  `src/app/api/cron/banger-discovery/route.ts` — the other call sites the sibling 0DTE PR's blast-
  radius section named as sharing the identical `fetchDailyMarketSummary(...)` pattern, each a
  separate consumer with its own caller-side handling to audit on its own terms, out of scope here
  (this PR is scoped to the swing-discovery lane only, per the standing one-issue-per-PR policy).

## Blast radius

One dep inside one file's IO wiring (`src/app/api/cron/swing-discovery/route.ts`). No other
consumer of `fetchGroupedDaily` exists outside `discovery.ts`'s own `SwingDiscoveryDeps` interface
contract (checked via repo-wide grep for the dep name). Scoring, candidate selection, and which
setups get built are unchanged either way — a thrown fetch still results in zero STRUCTURE/BANGER
contribution this tick, exactly as before; the only change is that the OTHER, independent origins
(FLOW/POSITIONING/CATALYST/VECTOR) now survive the same tick instead of being crashed along with it.
