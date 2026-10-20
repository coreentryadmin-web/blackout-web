> **kind:** FINDING

## Swing play-brief: every single request 503'd with "Invalid time value" (production)

| **Status** | FIXED — PR TBD |
|---|---|

**Impact:** 100% of `GET /api/market/swing/play-brief` requests on production returned `503
{"available":false,"degraded":true,"unavailable":{"reason":"Invalid time value",...}}` — verified
live across ~25 real committed/watch positions (NVDA, TSLA, SMMT, RNG, WRBY, CELH, DKNG, W, ANF,
TSLL, SOXS, MRNA, LABD, BHC, ODD, ENPH, KGC, AEM, DASH, KORU, WDC), every ticker, both `COMMIT` and
`WATCH` statuses — not ticker-specific, not intermittent. This is Ask Largo's entire swing
play-brief surface, a paying-member-facing feature, fully down.

**Discovered:** immediately after the ECS deploy-deadlock fix (PR #6302) finally let a large
backlog of merged-but-undeployed commits reach production for the first time tonight
(2026-10-20 ~04:39 UTC). The bug itself was already latent on `main` — the deploy stall just hid
it, because the error-shape fix that surfaces the real exception message (PR #6284, replacing a
bare `{available:false,degraded:true}` 503 with a proper `unavailable.reason` field) was stuck in
the same undeployed backlog as the bug it exposes, so both shipped together.

## Root cause

`src/lib/swing/play-brief-adapter.ts`'s `adaptSwingBriefToLargo()` called a (now-removed)
`formatAsOfET(asOf)` helper that assumed `asOf` was a raw ISO-8601 instant (its own doc comment
said so: `@param isoString ISO 8601 timestamp`) and re-parsed it with `new Date(isoString)` before
reformatting to the Largo C1 "YYYY-MM-DD HH:mm ET" shape.

That assumption was false. `asOf` here is `SwingPlayBriefResult.asOf`
(`src/lib/swing/play-brief.ts:1822,1856`), which is always `SwingPlayBriefContext.asOf`
(`src/lib/swing/play-brief-context.ts:345`: `etStamp(nowMs) ?? new Date(nowMs).toISOString()`).
`etStamp()` (`src/lib/largo/temporal/bar-session-date.ts`) returns the human-readable Largo C1
stamp directly — `"YYYY-MM-DD HH:mm ET"` — and since `nowMs` (`Date.now()`) is always a valid
positive number, the ISO fallback never fires in practice. So `asOf` arrives at the adapter
**already** in the exact format the contract (`ProductReadMeta.as_of`,
`src/lib/largo/contract/product-read.ts`) requires.

`formatAsOfET`'s `new Date("2026-10-20 00:41 ET")` produces an `Invalid Date` (confirmed live:
`getTime()` is `NaN`), and `Intl.DateTimeFormat.prototype.formatToParts()` on an `Invalid Date`
throws `RangeError: Invalid time value` — uncaught here, surfacing through the route's catch-all
(`src/app/api/market/swing/play-brief/route.ts:118-139`) as the 503 with that exact message. Since
`asOf` is computed once per request (not per-ticker, not per-position), this fires identically on
every single call regardless of the underlying position's own data quality — exactly matching the
observed 100%-of-requests pattern.

**Why tests didn't catch it:** `play-brief-adapter.test.ts`'s `fixtureCtx()` hand-wrote
`asOf: "2026-09-07T02:59:00.000Z"` (a raw ISO string) instead of the real `"YYYY-MM-DD HH:mm ET"`
shape `loadSwingPlayBriefContext` actually produces — a fixture that happened to match what the
buggy code expected, not what a real caller ever sends.

## Fix

`src/lib/swing/play-brief-adapter.ts`: removed `formatAsOfET` entirely (dead/wrong, single
caller) and pass `asOf` straight through as `as_of` — it is already C1-compliant by construction.

`src/lib/swing/play-brief-adapter.test.ts`: fixed `fixtureCtx()`'s default `asOf` to the real
ET-stamp shape (`"2026-09-07 02:59 ET"`), and added a dedicated regression test asserting
`adaptSwingBriefToLargo` doesn't throw on the real shape and that `as_of` passes through verbatim,
validated against the contract's own `contractViolations()` checker (zero violations).

**RED→GREEN proven**: `git stash` on `play-brief-adapter.ts` alone (keeping the fixed test file)
reproduced the exact live `RangeError: Invalid time value` on all 3 tests in the file; restored,
3/3 pass. Broader `play-brief*.test.ts` suite: 621/621 pass. `npx tsc --noEmit`: clean.

## Blast radius

`adaptSwingBriefToLargo` has exactly one caller
(`src/app/api/market/swing/play-brief/route.ts`) — no other consumer depended on the broken
re-formatting behavior. `src/lib/largo/swing-play-brief-read.ts` (the Largo tool wrapper) calls the
HTTP route, not the adapter directly, so it inherits the fix automatically once deployed.

## Market-open validation

Once deployed, re-check `GET /api/market/swing/play-brief` for several real committed positions —
should return `200 {"available":true,...}` with a valid `as_of: "YYYY-MM-DD HH:mm ET"` field at the
top level, not a 503.
