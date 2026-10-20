## 2026-10-20 — [FINDING, P1 Night Hawk 0DTE] Every single-name 0DTE position was permanently excluded from the live quote lane — FIXED

> **kind:** FINDING

**Context.** Member live-book audit directive on today's open 0DTE book: "Verify quote
freshness, executable exit prices, stop execution... don't dismiss this as normal chop."

**Root cause.** `toActivePlay` (`src/lib/zerodte/live-marks.ts`) — the function that decides
which ledger rows the ~1s live-marks lane (real bid/ask/greeks/executable P&L, WS-first +
REST fallback) actually tracks — required the tracked OCC's expiry to be **EXACTLY equal**
to the row's own `session_date`:
```js
if (occExpiry != null && occExpiry !== r.session_date) return null;
```
That premise ("0DTE's whole premise is same-day expiry") is only true for underlyings with
DAILY option listings — SPY/QQQ/IWM/SPX/NDX. Every single-name 0DTE play (RIOT, NBIS, HUT,
OUST, SMR, BTDR, CBRS, RARE, SBET, ASST, KORU, BB, ...) is deliberately committed against the
nearest AVAILABLE expiry, up to `ZERODTE_MAX_DTE` (4) calendar days out — `board.ts`'s own
`SETUP_MAX_DTE`, explicitly widened 1→4 on 2026-08-06 for exactly this reason. The strict
equality check silently excluded **every single-name 0DTE row, permanently, from this lane**:
`getActivePlays`/`boundActivePlays` never returned them, so the poller never quoted them, and
`attachLiveMarkMeta` (`zerodte-service.ts`) always fell through to its fail-soft default —
`bid: null, ask: null, mark_source: null, mark_as_of: null, live_pnl_pct_exec: null` — for the
entire single-name population, every session, with no error anywhere.

**Live evidence.** A board poll during RTH today showed 0/12 open single-name rows ever
carrying a bid/ask, across 4 repeated polls spanning several minutes (ruling out a one-tick
cold-start). In the SAME window, the lane's own dedicated `/api/market/zerodte/marks` route
showed real, <1s-fresh bid/ask/mid/greeks for genuinely-tracked (swing-merged) contracts
(WRBY/CELH/DKNG/etc.) — proving the lane itself works; this guard simply never let a
single-name 0DTE row register with it.

**Consequence.** `live_pnl_pct_exec` (the executable, sell-into-the-bid P&L the exit engine's
own design treats as "the honest exit-side number") was structurally unavailable for exactly
the population an audit most needs to verify — the names sitting at the deepest drawdowns.
`last_mark`/`live_pnl_pct` kept moving (the legacy SYNC lane fallback still works), so the raw
P&L number itself was not necessarily wrong, but it could never be cross-checked against a
real, fresh two-sided NBBO quote for any single-name 0DTE play.

**Fix.** Changed the guard to accept any `occExpiry` within `[session_date, session_date +
ZERODTE_MAX_DTE]` — still excludes a genuinely-expired row (`occExpiry < session_date`, the
real 2026-09-11 "zombie row" case the original check existed to catch) and an implausibly-far
OCC (`occExpiry` beyond the window), but no longer conflates "not literally today" with
"wrong." Mirrors the semantics `src/lib/swing/live-marks-active.ts`'s own `occAlreadyExpired`
guard already uses correctly (`expiry < today`, never strict equality) — swing never had this
bug.

**Blast radius.** Single call site (`toActivePlay`), consumed by `getActivePlays`/
`boundActivePlays` (the ~1s poller's own active-set fetch) and therefore by `attachLiveMarkMeta`
(the board's `bid`/`ask`/`mark_source`/`live_pnl_pct_exec` fields), the SSE/REST `/marks`
payload, and `runZeroDteMarkTick`'s own exit-engine evaluation (which only acts on a `mark`
sourced from this same lane within `ZERODTE_MARK_STALE_MS`) — all three now get real quotes
for the single-name population for the first time.

**Evidence of fix.** `src/lib/zerodte/live-marks.test.ts`: the pre-existing zombie-row test
(2026-09-11, `occExpiry` a week in the past) still passes unchanged (dte<0 is still
excluded). Two new tests: a 3-DTE single-name OCC (RIOT, no daily listing) is now tracked
(RED on pre-fix code, confirmed via `git stash` on just the source file: `not ok`, 35 pass/1
fail); an OCC 10 days out (past `ZERODTE_MAX_DTE`) is still excluded, unchanged. Full file:
36/36 pass (was 34). `tsc --noEmit` clean.

**What was deliberately left unchanged.** The lane's cap (`ZERODTE_LIVE_CONTRACT_CAP`),
WS-first/REST-fallback mechanics, and staleness thresholds (`ZERODTE_MARK_STALE_MS`/
`LATCH_MAX_MARK_AGE_MS`) are untouched — this fix only widens WHICH rows qualify to be
tracked at all, strictly additive (more real coverage, nothing removed).
