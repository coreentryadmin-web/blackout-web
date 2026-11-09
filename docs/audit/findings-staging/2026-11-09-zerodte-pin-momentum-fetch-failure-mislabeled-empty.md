# 2026-11-09: Night Hawk 0DTE PIN and MOMENTUM discovery conflate a thrown upstream fetch with a genuinely empty market

> **kind:** `FINDING`

**Status.** FIXED — this PR.

## Summary

This is the PIN/MOMENTUM half of a gap `breakout-discovery.ts`'s `skip_fetch_failed` fixed for
BREAKOUT discovery earlier the same day (PR #7786, commit `80beb87c4`). That PR's own blast-radius
section looked at PIN and MOMENTUM and concluded they "don't share THIS PATTERN" — narrowly true
(neither calls the single whole-market `fetchDailyMarketSummary(...).catch(() => null)` BREAKOUT
calls), but a live audit the same day found both share the identical **broader** defect through
their own, different per-ticker IO calls, and it was never flagged as a follow-up the way several
other `fetchDailyMarketSummary` call sites explicitly were.

`discoverPinSetups()` (`src/lib/zerodte/pin-discovery.ts`) wraps its two per-ticker IO calls —
`fetchGexHeatmap(ticker).catch(() => null)` and `resolveTickerChainRows(ticker).catch(() => null)`
— in bare `.catch()`s, inside an outer per-ticker `try { ... } catch { return null; }`.
`discoverMomentumSetups()` (`src/lib/zerodte/momentum-signal-discovery.ts`) does the same for its
three per-ticker calls: `fetchMinuteBars(...).catch(() => [])`, `computeRvolShadow(...).catch(()
=> null)`, and `resolveChain(...).catch(() => null)`. In both files, a THROWN fetch for a ticker
resolves to the exact same per-ticker outcome ("not a clean pin" / "NO_SETUP") as a genuinely quiet,
fully-fetched ticker — and because the function never throws past its own try/catch even when
EVERY ticker's fetch fails, a universe-wide outage is indistinguishable from "nothing in the market
qualified today." `scan.ts` then reports `discovery_health.PIN`/`.MOMENTUM = {status: "ok",
setups: 0}` either way — the exact absence-vs-failure conflation
`docs/audit/LARGO-PRODUCT-CONTRACT.md`'s absence principle forbids, and the same shape BREAKOUT's
`skip_fetch_failed` fixed hours earlier for its own single whole-market fetch.

### Live evidence

A live authenticated `GET /api/market/zerodte/board` poll during active RTH (`session.heat.state:
"RTH"`, `as_of 2026-11-09T20:04:54Z`) returned `discovery_health = {"BREAKOUT":{"status":"failed",
...},"PIN":{"status":"ok","setups":0},"MOMENTUM":{"status":"ok","setups":0}}`. In the SAME window,
`GET /api/market/gex-heatmap?ticker=SPY|SPX|AAPL` — the exact upstream PIN discovery reads
per-ticker — all three returned `available:false`, empty gex/vex/dex/charm cells, "No
options-chain data for this ticker — dealer gamma profile unavailable." The real upstream read PIN
depends on was genuinely failing across an index root, an ETF, and a mega-cap name (representative
of all three tiers of PIN's ~30-name universe) during active RTH, yet PIN's board health still read
`{"status":"ok","setups":0}` rather than `"failed"`. This is almost certainly the already-documented,
still-open Polygon/Massive real-time-snapshot entitlement outage (`CLAUDE.md`) acting as the
proximate trigger — the reportable code defect is that PIN/MOMENTUM's health reporting had NO path
to ever disclose that trigger (or any other universe-wide upstream failure/rate-limit) as anything
other than a genuine quiet-market zero.

## Root cause

```ts
// pin-discovery.ts, before (per ticker, inside Promise.all)
const hm = await fetchGexHeatmap(ticker).catch(() => null);
const pos = gexPositioningFromHeatmap(ticker, hm);
if (!hm || !pos || !(pos.spot > 0)) return null; // throw or genuine miss -- indistinguishable
...
const chain = await resolveTickerChainRows(ticker).catch(() => null);
if (!chain || !(chain.spot > 0) || chain.rows.length === 0) return null; // same conflation
```

```ts
// momentum-signal-discovery.ts, before (per ticker)
const [rawBars, rvolShadow] = await Promise.all([
  fetchMinuteBars(sym, today, today).catch(() => []),
  computeRvolShadow(ticker, nowMs).catch(() => null),
]);
// a throw on either call silently degrades to the SAME inputs a genuinely flat ticker produces
```

Both `.catch()`s discard the rejection reason before any caller could ever see it, and — unlike
BREAKOUT's single whole-market fetch — these are PER-TICKER calls inside a `Promise.all`, so the
function never throws out to its outer try/catch (`scan.ts`'s own `catch (err) {
discoveryHealth.PIN = { status: "failed", ... } }`) even when every ticker in the universe fails
identically. Neither `pin-discovery.ts` nor `momentum-signal-discovery.ts` had a test file covering
a thrown per-ticker fetch (PIN had no test file at all before this PR).

## Evidence (RED → GREEN)

RED (pre-fix, via plain file-copy restore of the three touched source files — `pin-discovery.ts`,
`momentum-signal-discovery.ts`, `scan.ts` — with the new/updated regression tests kept in place;
not `git stash`, per this sandbox's documented shared-git-working-directory risk):

```
# src/lib/zerodte/pin-discovery.test.ts   (all 9 tests reference the new discriminated outcome)
# tests 9, pass 0, fail 9   (discoverPinSetups still returned a bare array -- `out.status` undefined)

# src/lib/zerodte/momentum-signal-discovery.test.ts
not ok 14 - ...UNIVERSE'S ONLY ticker IS a 100% fetch failure -- skip_fetch_failed, never a fabricated ok
not ok 18 - ...every evaluated ticker's minute-bar fetch THROWS -> skip_fetch_failed, never ok
not ok 19 - ...a non-Error minute-bar rejection still produces skip_fetch_failed
not ok 22 - MOMENTUM_FETCH_FAILURE_RATE_THRESHOLD is 0.9
not ok 23 - ...chain fetch THROWS for every entry candidate -> skip_fetch_failed
not ok 24 - ...computeRvolShadow THROWS (bars fine) for every evaluated name -> skip_fetch_failed too
# tests 24, pass 18, fail 6
```

GREEN (post-fix, source files restored):

```
# pin-discovery.test.ts:               tests 9,  pass 9,  fail 0
# momentum-signal-discovery.test.ts:    tests 24, pass 24, fail 0
```

Also ran the full `src/lib/zerodte/*.test.ts` directory (121 files) post-fix: **1807 pass / 0 fail
/ 1 skipped** (pre-existing skip, unrelated — same count the sibling BREAKOUT fix's PR recorded for
its own full-suite run that day). `npx tsc --noEmit` (Node 20.20.2): clean.

## Fix

Both discovery functions now track, per ticker, whether EITHER of their IO calls actually **threw**
(never whether it merely resolved with no usable data), inside the same per-ticker try/catch that
already existed:

- `pin-discovery.ts`: a new injectable `PinDiscoveryDeps` seam (`fetchHeatmap`/`resolveChain`,
  mirroring `BreakoutDiscoveryDeps`/`MomentumDiscoveryDeps`) wraps `fetchGexHeatmap` and
  `resolveTickerChainRows` in explicit nested `try/catch`es instead of `.catch(() => null)`. The
  function's return type changed from a bare `EnrichedZeroDteSetup[]` to a discriminated
  `PinDiscoveryOutcome` (`status: "ok" | "skip_fetch_failed"`).
- `momentum-signal-discovery.ts`: the classification phase's `Promise.all([fetchMinuteBars(...)
  .catch(...), computeRvolShadow(...).catch(...)])` became `Promise.allSettled([...])` (keeping the
  same concurrency) so a rejection can be told apart from a resolved empty value; the chain-fetch
  phase's `resolveChain(...).catch(() => null)` became an explicit `try/catch`. Its existing
  `MomentumDiscoveryOutcome.status` gained a third member, `"skip_fetch_failed"`.

After the per-ticker loop, each file aggregates `fetchFailures / universe.length` and compares
against a new exported threshold (`PIN_FETCH_FAILURE_RATE_THRESHOLD` /
`MOMENTUM_FETCH_FAILURE_RATE_THRESHOLD`, both `0.9`). **A HIGH bar deliberately**, because unlike
BREAKOUT's single whole-market call, these are per-ticker loops over ~10-30 names where a lone
flaky name is ordinary and must never flip the whole lane — only a real, near-universal outage
(90%+ of the evaluated universe's own fetches throwing) does. At or above the threshold, the
function returns `skip_fetch_failed` with the last thrown error's message as `reason`, instead of
a genuine `ok` zero.

`scan.ts`'s PIN/MOMENTUM wiring was updated to read the new `status`/`reason` and map
`skip_fetch_failed` to `discovery_health.<LANE> = { status: "failed", setups: 0, reason }` —
checked FIRST, before PIN's existing `pinWindowStatus`-derived off-hours check (the two can never
actually co-occur, since an off-hours return happens before the per-ticker loop ever runs, but
ordering the fetch-failure check first keeps the precedence explicit). This reuses the same
`"failed"` `DiscoveryLaneStatus` BREAKOUT's fix (and the outer `scan.ts` try/catch) already use —
no new lane-status enum member, matching that fix's own reasoning for the identical choice.

A chain-fetch throw for a ticker that already threw during heatmap/bar fetch is never
double-counted: in PIN, chain fetch only runs after a clean regime is found (which requires the
heatmap fetch to have succeeded), and in MOMENTUM, a ticker that threw during classification has
`best: null` and so can never become an entry candidate reaching the chain-fetch phase — each
ticker contributes at most one failure to the aggregate.

### What was deliberately left unchanged

Neither file's actual setup-discovery logic, scoring, universe selection, or any other behavior
changed — only the failure-vs-emptiness disclosure path was added. A successful fetch that
genuinely finds nothing still reports `ok` with `setups: 0`, exactly as before (regression-tested
explicitly in both files). The underlying Polygon/Massive real-time-snapshot entitlement outage
this PR's live evidence points at is **not fixable from this codebase** — same category as the
already-documented Benzinga/snapshot entitlement losses in `CLAUDE.md`, which need the operator to
check/renew the plan on Massive.com. This PR only makes the existing fail-closed behavior (PIN/
MOMENTUM contribute zero setups, flow-only board continues) honestly disclosed instead of silently
misreported as "nothing is pinned/developing today."

## Blast radius

Three files: `pin-discovery.ts`, `momentum-signal-discovery.ts`, and their shared caller
`scan.ts`'s PIN/MOMENTUM wiring blocks. `pin-window.ts`'s doc comment (which explains WHY
`pinWindowStatus` is exported) was updated to describe the new `status` field accurately rather
than only the pre-existing bare-array framing. No other consumer of `discoverPinSetups`/
`discoverMomentumSetups` exists outside `scan.ts` and these files' own tests (checked via
repo-wide grep). `discovery-health.ts` itself required no change — PIN/MOMENTUM build their health
objects inline in `scan.ts` rather than through `laneStatusFromBreakoutOutcome` (that mapping
function is BREAKOUT-specific), so no new case needed adding there.

One pre-existing test in `momentum-signal-discovery.test.ts` ("a resolveChain throw is swallowed —
best-effort, one bad ticker never sinks the pass") asserted `status: "ok"` against a
**one-ticker** universe where that one ticker's chain fetch throws — with a universe of size 1, a
single throw IS 100% of the universe failing, which is exactly the case this fix exists to flag,
not silently report as a clean zero. Updated to use a three-ticker universe for its original point
(a per-ticker IO failure never crashes the pass or fabricates a setup), and added a new sibling test
asserting the one-ticker case now correctly reports `skip_fetch_failed` — the previous assertion
described the pre-fix bug, not a semantic this fix was meant to preserve.

BREAKOUT discovery (`breakout-discovery.ts`) and its own `skip_fetch_failed` are untouched by this
PR.
