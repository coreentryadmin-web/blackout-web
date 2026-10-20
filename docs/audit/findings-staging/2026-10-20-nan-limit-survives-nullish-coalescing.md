## 2026-10-20 — [FINDING, P2 Input-validation] A malformed numeric query param survives `?? default` as NaN, silently emptying results at 3 call sites — FIXED

> **kind:** FINDING

**Context.** DISCOVERY-lane input-validation sweep (standing full-lifecycle scope-expansion
mandate). A background sweep agent searched `src/app/api/**/route.ts` outside the 9 owned
lanes for request fields read and used without validating their type/shape. Found 5 genuine
candidates; 3 share an identical root cause and fix shape, folded into this one finding per
the PR write-up policy's blast-radius principle (the other 2 are separate root causes, each
getting its own fix/PR).

**Root cause.** `?? default` only guards an *absent* value (`null`/`undefined`) — it does
nothing for a *malformed but present* one. A non-numeric query-string value (e.g.
`limit=foo`) produces `Number("foo")` = `NaN`, and `NaN` is neither `null` nor `undefined`,
so it sails straight through `??` and poisons everything downstream that assumes a real
number. The codebase already has the correct idiom in `src/app/api/market/flows/route.ts`
(`Math.max(Number(x ?? default) || default, 1)` — the `|| default` catches `NaN` because
`NaN` is falsy) but it wasn't applied uniformly. Three sites were missing it:

1. `src/app/api/market/ticker-search/route.ts:22` — `limit=foo` → `Number("foo")=NaN` →
   `fetchPolygonTickerSearch(q, NaN)` (`polygon-largo.ts`): its own `upstreamLimit =
   Math.min(Math.max(NaN*5,25),50)` is also `NaN` (sent to Polygon as the literal string
   `"NaN"`), and the final `.slice(0, NaN)` silently returns `[]` for a perfectly valid
   ticker query.
2. `src/app/api/market/dark-pool/route.ts:15` — `limit=xyz` → `NaN` →
   `fetchUwDarkPoolRecent(NaN)` (`unusual-whales.ts`): `coerced.slice(0, NaN)` returns `[]`
   even though the cache has real rows (`coerced.length > 0` is true) — the route returns
   `200 {prints:[], count:0}` without even attempting a network round-trip, discarding real
   cached data rather than rejecting the malformed request or falling back to the default.
3. `src/app/api/market/platform/snapshot/route.ts:24` — `flow_limit=bad` → `NaN` → passed to
   `getPlatformSnapshot({flowLimit: NaN})` (`src/lib/platform/index.ts:51`): `opts?.flowLimit
   ?? 50` is the SAME gap one layer deeper (`NaN` isn't null/undefined either), reaching
   `getFlowTapeSummary` → `getFlowTape` → `fetchRecentFlows` (`src/lib/db.ts:3275-3276`),
   whose `params.limit ?? 5000` lets `NaN` through a third time and binds it to a raw SQL
   `LIMIT $N` parameter, which Postgres rejects. The throw is caught by
   `platform/index.ts`'s per-service `.catch(() => { snapshot.flows = null })`, so the
   overall request still returns 200 — but a caller (including Largo's own cross-product
   tool-calling) has no way to tell "no flow data right now" from "you sent a malformed
   flow_limit."

**Fix.** Added `|| default` after the `Number(x ?? default)` at each of the 3 sites,
matching `flows/route.ts`'s existing safe idiom exactly. One-line change per site.

**Blast radius.** Each site's own downstream chain (Polygon upstream call,
`fetchUwDarkPoolRecent`, and the 3-layer `platform/index.ts` → `flow-service.ts` → `db.ts`
chain) is now protected at its single entry point — no change needed further downstream,
since a clean numeric `limit`/`flowLimit` was always the contract those functions expected.

**Evidence of fix.** New/extended tests: `src/app/api/market/ticker-search/route.test.ts`
(new file), `src/app/api/market/dark-pool/route.test.ts` (extended existing file),
`src/app/api/market/platform/snapshot/route.test.ts` (new file) — each a source-inspection
assertion that the `|| default` guard is present. RED→GREEN proven via `git stash` on the 3
edited route files: 6 pass/3 fail pre-fix, 9/9 pass once restored. `tsc --noEmit` clean.

**What was deliberately left unchanged.** Two other genuine findings from the same sweep
(`admin/users/tools/bulk`'s silent-no-op `Math.min`/`Math.max` NaN loop, and
`admin/users`'s uncaught-exception `page`/`limit` pagination params) are different root
causes with different fix shapes — each gets its own separate fix/PR per the one-issue-per-PR
policy, not bundled here.
