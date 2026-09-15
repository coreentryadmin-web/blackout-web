> **kind:** FINDING

## `buildLegacyOptionMarkRow`'s WS branch had no backstop-quote divergence guard — a `bid:0` market-maker quote arriving over WebSocket could fabricate a wildly wrong Legacy option mark, bypassing the identical guard already applied to the REST path — FIXED

| **Status** | FIXED (this commit) |
|---|---|

**Root cause:** on 2026-09-14 a cross-lane fix wired a bid=0 "backstop-quote" divergence guard
(`reliableMarkFromSnapshot`, `options-snapshot.ts`) into `buildLegacyOptionMarkRow`'s REST-snapshot
branch, after the swing/banger lane found that a market-maker's backstop `ask` on a contract with
no real bid can average into a mid an order of magnitude away from the contract's real value (live
repro: CRSR 260918C00015000, `bid:0/ask:15` → mid $7.50 while the real last trade was $0.07 — a
107x divergence). That fix's own comment explicitly named `legacy-marks` as sharing the exposure
via `fetchOptionsUnifiedSnapshot`.

What it missed: `buildLegacyOptionMarkRow` reads a mark from **two** sources —
`ws?.mark ?? snapMark ?? ...` — and only `snapMark` (the REST path) went through the guard. The WS
mark (`ws.mark`) is computed by `handleQuote` (`src/lib/ws/options-socket.ts`) via the *identical*
`midOf(bp, ap)` bid/ask-midpoint logic the REST fix was written to distrust — a bid:0/ask-only
backstop quote arriving over the WebSocket feed produces the exact same fabricated mid, and because
`ws?.mark` is checked FIRST in the `??` chain, a bad WS mark would win outright and never even reach
the REST-side guard that already existed one line below it.

**Evidence:** confirmed via direct source trace (this is a structural code-review finding, not a
live-reproduced anomaly — no production incident was needed to establish the gap, since the two
branches are visibly asymmetric in the same function). Wrote a regression test reproducing the
exact CRSR-shaped scenario over the WS path (`ws: {mark: 7.5, bid: 0, ask: 15, last: 0.07}`) and
confirmed pre-fix it returns `mark: 7.5` (the fabricated backstop mid) — RED, proven via git-stash
— identical failure shape to the REST bug the 2026-09-14 fix addressed.

**Blast radius:** both callers of `buildLegacyOptionMarkRow` — the public `/api/market/nighthawk/legacy-marks`
route and `fetchLegacyOptionMarksServer` (used by Legacy's server-side live-sync and EOD grading) —
inherit the fix identically, since both flow through the same shared row-builder. Any Legacy play
whose WS quote briefly carries a bid:0 backstop ask (thin/far-dated contracts, the exact liquidity
profile Legacy's small-cap picks tend to have) was exposed.

**Fix:**
1. Extracted the comparison core of `reliableMarkFromSnapshot` into a new generic export,
   `reliableMarkFromQuote(mark, bid, reference)` (`options-snapshot.ts`) — takes a plain
   `{mark, bid, reference}` triple instead of a full `OptionSnapshot`, so a caller with a different
   quote shape (the WS mark stream has no `dayClose` to fall back to, only `last`) can apply the
   identical rule without constructing a fake snapshot object. `reliableMarkFromSnapshot` now
   delegates to it (`reliableMarkFromQuote(snap.mark, snap.bid, snap.last ?? snap.dayClose)`) —
   byte-identical behavior, proven by the full existing `reliableMarkFromSnapshot` test suite
   passing unchanged.
2. Extended `getLiveOptionMarkSync`'s return type (`src/lib/ws/options-socket.ts`) to include
   `last` alongside the existing `mark`/`bid`/`ask`/`ts` — purely additive, so every other caller
   (`vector/contract-picks/live/route.ts`, `vector-pick-sweep.ts`) is unaffected.
3. `buildLegacyOptionMarkRow` now computes `wsMark = ws ? reliableMarkFromQuote(ws.mark ?? null, ws.bid ?? null, ws.last ?? null) : null`
   and uses `wsMark` (not the raw `ws.mark`) in the priority chain — the same guard the REST branch
   already had, now applied symmetrically to both sources.

**Fix rationale — why extract a generic function instead of duplicating the check inline:** the
exact same divergence rule (bid=0 → compare mark against a reference price, fall through past 10x
divergence) now needs to run against two different quote shapes. Duplicating the four-line check
inline in `legacy-option-mark-row.ts` would create a second copy that could drift from
`reliableMarkFromSnapshot`'s own tuning (the `ZERO_BID_MID_DIVERGENCE_MULTIPLE` constant) the next
time either is touched. Extracting the shared core keeps both call sites provably identical and
lets the WS-side reuse the constant and every existing edge-case decision the REST guard already
made (null reference passes through, reference≤0 passes through, exact-10x boundary is kept).

**Test:** `src/lib/providers/options-snapshot.test.ts` — 5 new tests for `reliableMarkFromQuote`
directly (null mark, bid>0 never second-guessed, bid=0 backstop falls through, no reference passes
through, reference≤0 passes through) — same numbers as the existing `reliableMarkFromSnapshot`
tests, now exercised via the generic signature. `src/features/nighthawk/lib/legacy-option-mark-row.test.ts` —
3 new tests: the CRSR-shaped WS backstop repro (falls through to 0.07, not 7.5), a real two-sided
WS market never second-guessed, and a bid=0 WS quote with no `last` at all passing through
unchanged. RED→GREEN proved via `git stash` on the three production files: pre-fix, the WS-backstop
test fails at `mark: 7.5` (actual) vs `0.07` (expected), and the two new `reliableMarkFromQuote`
tests fail with `reliableMarkFromQuote is not a function`; post-fix, all 45 tests across both files
pass. `npx tsc --noEmit` clean; full existing `reliableMarkFromSnapshot` suite (8 tests) unchanged
and still passing, confirming the refactor preserved REST-path behavior exactly.
