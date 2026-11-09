# 2026-11-09: Night Hawk 0DTE BREAKOUT discovery conflates a thrown upstream fetch with a genuinely empty market

> **kind:** `FINDING`

**Status.** FIXED — this PR.

## Summary

`discoverBreakoutSetups()` (`src/lib/zerodte/breakout-discovery.ts`) fetches the whole-market
grouped-daily snapshot it screens for BREAKOUT/BREAKDOWN candidates via
`fetchDailyMarketSummary(today).catch(() => null)`. `polygonGet` (`src/lib/providers/polygon.ts`)
throws on ANY non-2xx response — a rate limit, a network failure, or (confirmed live this cycle) a
provider-side 4xx/5xx — and the bare `.catch(() => null)` swallowed that throw into the identical
`summary === null` state a genuinely-empty-but-successful 200 response also produces. Both paths
then fell through to the same `results.length === 0` check and returned the identical
`{ status: "skip_empty_market", setups: [] }` outcome, which `laneStatusFromBreakoutOutcome`
(`discovery-health.ts`) maps to `discovery_health.BREAKOUT.status: "empty_market"` on the live
board. From outside, a dead upstream and a genuinely quiet market read as byte-identical payloads —
exactly the absence-vs-failure conflation `docs/audit/LARGO-PRODUCT-CONTRACT.md`'s absence
principle exists to forbid, and the same shape WS-19 (the sibling staleness guard three lines above
this one in the same file) already fixed for a STALE-but-non-empty snapshot. The thrown-fetch case
was the one WS-19 did not cover.

### Live evidence

A live authenticated `GET /api/market/zerodte/board` poll during active RTH
(`session.heat.state: "RTH"`, `heat_pct: 100`) returned
`discovery_health.BREAKOUT = {"status":"empty_market","setups":0}` with the whole board's
`setups: []` and `ledger: []`, reproduced across multiple polls spanning OPENING_DRIVE into RTH.

Direct reproduction of the exact upstream call `fetchDailyMarketSummary` makes, against the real
production `POLYGON_API_KEY`/`POLYGON_API_BASE` (`api.massive.com`):
`GET /v2/aggs/grouped/locale/us/market/stocks/2026-11-09?adjusted=true&include_otc=false` →
**HTTP 403** `{"status":"NOT_AUTHORIZED","message":"Attempted to request today's data before end
of day. Please upgrade your plan at https://polygon.io/pricing"}` — a same-day/"before end of day"
plan restriction, distinct from the already-documented Benzinga/real-time-snapshot entitlement
losses in `CLAUDE.md` (those only ever applied to past-date grouped-daily or the `/v3/snapshot`
family; this fires on grouped-daily for TODAY specifically, which `breakout-discovery.ts`'s own
file-header comment explicitly assumes works: "TODAY's grouped-daily = the LIVE incomplete session
bar during RTH"). A control call for a past settled date (2026-11-06) on the identical key returned
HTTP 200 with 12,573 real rows, ruling out a dead key or a network-wide issue.

**Independently re-verified from this session** (own repro, not just the evidence handed in):
issuing the identical same-day grouped-daily call against the real `POLYGON_API_KEY`/
`POLYGON_API_BASE` from this sandbox returned **HTTP 429** ("You've exceeded the maximum requests
per minute, please wait or upgrade your subscription") rather than the 403 above — a *different*
non-2xx status, but the same root-cause category: `polygonGet` throws on it identically, and
pre-fix, `discoverBreakoutSetups` would have swallowed it into the same `skip_empty_market` outcome
regardless of which non-2xx status caused the throw. This incidentally demonstrates the bug is
general to *any* thrown fetch failure (rate limit, entitlement 403, network error, 5xx), not
narrowly tied to the one 403 message first observed — the fix below does not special-case any
particular status code or message, it only distinguishes "the fetch succeeded with zero rows" from
"the fetch threw," whatever the throw's cause.

`git log --oneline --since="2026-11-09 00:00" -- src/lib/zerodte/breakout-discovery.ts
src/lib/providers/polygon.ts` showed zero commits today touching either file before this fix, and
no existing `FINDINGS.md`/`findings-staging`/`CLAUDE.md` entry documented this same-day grouped-
daily restriction.

## Root cause

```ts
// before
const summary = await fetchSummary(today).catch(() => null);
const results = summary?.results ?? [];
if (results.length === 0) {
  return { status: "skip_empty_market", setups: [] }; // ambiguous: throw, or genuine zero rows?
}
```

`.catch(() => null)` discards the rejection reason entirely before the empty-check ever runs, so a
thrown `Error("Polygon /v2/aggs/grouped/... → 403")` and a resolved `{ results: [] }` are
indistinguishable by the time `discoverBreakoutSetups` decides what outcome to report. Nothing
downstream — not `scan.ts`, not `discovery-health.ts`, not the live board payload — had any way to
tell them apart, because the distinguishing information was thrown away one line above where it
would have mattered.

This was never caught by a test: `breakout-discovery.test.ts` had three scenarios (stale snapshot →
`data_unavailable`, fresh-but-empty → `ok`, fresh-with-movers → `ok`) but none exercised
`fetchSummary` actually rejecting — the exact gap this fix closes.

## Evidence (RED → GREEN)

RED (pre-fix, via `git checkout origin/main -- <source files>` isolating only the two source-file
changes while keeping the new regression tests in place):

```
not ok 6 - discoverBreakoutSetups: grouped-daily fetch THROWS (e.g. a provider 403) → skip_fetch_failed, never skip_empty_market
    expected: 'skip_fetch_failed'
    actual:   'skip_empty_market'
not ok 7 - discoverBreakoutSetups: grouped-daily fetch rejecting with a non-Error value still produces a skip_fetch_failed outcome
    expected: 'skip_fetch_failed'
    actual:   'skip_empty_market'
# tests 28, pass 26, fail 2
```

GREEN (post-fix, source files restored):

```
# tests 28, pass 28, fail 0
```

Also ran the full `src/lib/zerodte/*.test.ts` directory (1791 tests, 7 suites) post-fix:
**1790 pass / 0 fail / 1 skipped (pre-existing skip, unrelated)**. `npx tsc --noEmit` (Node
20.20.2): clean.

## Fix

`discoverBreakoutSetups` now awaits `fetchSummary(today)` inside its own `try/catch`, BEFORE any
empty-check can run, and on a throw returns a new, distinct outcome:
`{ status: "skip_fetch_failed", setups: [], reason: <upstream error message> }`. A successful
response that genuinely has zero rows still returns `skip_empty_market` exactly as before — that
path is unchanged.

`laneStatusFromBreakoutOutcome` (`discovery-health.ts`) gained an explicit
`case "skip_fetch_failed": return "failed"` — reusing the existing `"failed"` `DiscoveryLaneStatus`
(the same status the OUTER `scan.ts` try/catch already reports when `discoverBreakoutSetups` itself
throws unexpectedly, via `reason: "threw"`), rather than inventing a brand-new lane-status enum
member. This was a deliberate choice, not a shortcut: the module's own header comment already
documents that an outcome status it doesn't explicitly list falls through its `default` branch to
`"failed"` precisely so a new upstream status "lands on an absence a reader notices" rather than
being silently forwarded — `skip_fetch_failed` is exactly the case that comment anticipates, and
listing it explicitly (instead of relying on the `default` fallthrough) keeps the mapping
documented and covered by the "maps every known outcome status" test rather than an accident of
the catch-all. Because `scan.ts` already forwards `reason` generically
(`...("reason" in breakoutOutcome && breakoutOutcome.reason ? { reason: breakoutOutcome.reason } : {})`),
no change was needed there — the real upstream error message (e.g. the literal 403/429 body) now
reaches `discovery_health.BREAKOUT.reason` automatically, which is strictly more informative than
the outer catch's generic `"threw"`.

`anyLaneDegraded` already treats `"failed"` as a degraded lane (pre-existing, tested) — this fix
does not change what gets flagged as degraded, only what the operator sees when they ask WHY. It
also does not change scoring, candidate selection, or which setups get built: a thrown fetch still
results in zero BREAKOUT setups either way, exactly as before. The only change is disclosure.

### What was deliberately left unchanged

The underlying Polygon/Massive same-day grouped-daily entitlement restriction (and the separate
429 rate-limit this session's own re-verification attempt hit) is **not fixable from this
codebase** — it is a plan-tier/billing matter on the upstream provider, the same category of issue
as the already-documented Benzinga/real-time-snapshot entitlement losses in `CLAUDE.md`, which
explicitly says those need the operator to check/renew the plan on Massive.com, never fixed from
code. This PR does not attempt to work around, retry past, or route around that restriction in any
way — it only makes the existing fail-closed behavior (BREAKOUT contributes zero setups, flow-only
board continues) honestly disclosed instead of silently misreported as "the market has nothing
today."

## Blast radius

One file's IO orchestration (`breakout-discovery.ts`) and its lane-status mapping
(`discovery-health.ts`). No other consumer of `BreakoutDiscoveryOutcome.status` or
`laneStatusFromBreakoutOutcome` exists outside these two files and their own test files (checked via
repo-wide grep) — `scan.ts`'s forwarding code already handles the new status generically via the
`"reason" in breakoutOutcome` pattern, so it required no changes. The sibling `MOMENTUM` discovery
lane (`momentum-signal-discovery.ts`) has its own, narrower outcome type (`"ok" | "skip_off_hours"`
only — it does not call `fetchDailyMarketSummary` at all) and is unaffected. `PIN` discovery
(`pin-discovery.ts`) calls `fetchGexHeatmap`/`resolveTickerChainRows` per-ticker, not
`fetchDailyMarketSummary` at all, and does not share this pattern.

**The identical `fetchDailyMarketSummary(...).catch(() => null)` shape exists at several OTHER call
sites, found while checking blast radius — deliberately left untouched in this PR**:
`src/features/nighthawk/lib/market-wide.ts`, `src/lib/bie/market-breadth.ts`,
`src/lib/largo/run-tool.ts`, `src/features/spx/lib/spx-desk.ts`, plus three call sites in
`src/app/api/cron/swing-discovery/route.ts` and one in `src/app/api/cron/banger-discovery/route.ts`
(the latter two don't even wrap in a `.catch`, so a throw there propagates rather than silently
reads as empty — a different-shaped risk, not this one). Each is a SEPARATE consumer with its own
caller-side handling and its own blast radius to audit on its own terms (several are POST-CLOSE
cron jobs reading a settled prior session, not the live same-day RTH read this PR's confirmed 403
hits, so they may not be exposed to the same-day restriction at all — unverified either way, out of
scope here). Named here rather than fixed, per CLAUDE.md's "keep the PR small, one issue per
branch/PR" policy and the task's own explicit scope boundary (BREAKOUT discovery only) — a natural
follow-up finding, not folded into this one.
