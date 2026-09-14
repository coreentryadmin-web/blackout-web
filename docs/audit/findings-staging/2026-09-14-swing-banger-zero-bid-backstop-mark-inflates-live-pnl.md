> **kind:** FINDING

## Swing/banger live P&L used an unfillable zero-bid "backstop" quote as a real mark, inflating displayed gains by up to 100x+ — FIXED

| **Status** | FIXED (PR, this commit) |
|---|---|

**Root cause:** `midOf` (`src/lib/providers/options-snapshot.ts`) computes `mark = (bid+ask)/2`
whenever `bid != null && ask != null && ask > 0 && bid >= 0 && ask >= bid` — deliberately
accepting `bid === 0` because a genuinely worthless deep-OTM contract legitimately has no real
bid, and `(0 + small_ask)/2` is an honest near-zero valuation in that case. That guard itself is
correct and is intentionally kept in lockstep with `zeroDteMidOf` (`src/lib/zerodte/marks-math.ts`)
per both functions' own cross-referencing comments — **this fix does not touch either of them.**

The actual gap: neither function cross-checks the resulting mid against the contract's own
`last_trade.price`/`session.close`. A market maker's "backstop" ask on a contract nobody is
actually bidding on can sit an order of magnitude above the last real trade, and `midOf` has no
way to distinguish that from a genuine two-sided market — it averages a dead `bid: 0` against
whatever `ask` the provider returns, no matter how divorced from reality.

**Evidence (live reproduction, 2026-09-14 ~13:45 UTC):** swept the live Night Hawk Swings board
(`GET /api/market/nighthawk/horizons?view=swings`) and found 7 of 77 committed positions (all
`archetype: BREAKOUT`, `signalKinds: ["BANGER"]`) reporting absurd `livePnlPct`: PAGS +18650%,
CRSR +10614.3%, EBS/CPRI +7400%, BW +4900%, BAND +1082.5%, ACVA +721.4%. Queried Polygon directly
(not through the app) for the underlying quotes:

```
O:CRSR260918C00015000  last_quote: {bid: 0, ask: 15}  midpoint: 7.5   last_trade.price: 0.07   session.close: 0.07
O:BW260918C00008500    last_quote: {bid: 0, ask: 15}  midpoint: 7.5   last_trade.price: 0.10   session.close: 0.10
O:CPRI260918C00015000  last_quote: {bid: 0, ask: 15}  midpoint: 7.5   last_trade.price: 0.10   session.close: 0.10
```

CRSR's real entry premium was `$0.07` and its real last trade was STILL `$0.07` — the position
was essentially flat — but the app displayed **+10614.3%** because the `$0/$15` backstop quote's
midpoint (`$7.50`) was served as the live mark, a 107x divergence from the last real trade.

**Blast radius:** `fetchOptionsUnifiedSnapshot` (which calls `midOf` via `mapUnifiedSnapshotResult`)
feeds every live-mark consumer on the platform: `banger-live-sync`, `swing-active-refresh`,
`legacy-marks`, `vector/contract-picks/live`, `zerodte/live-marks.ts`,
`zerodte/thesis/contract-attach.ts`, `zerodte/scan.ts`, `vector-pick-sweep.ts`. This finding fixes
**only** the two swing/banger consumption sites (`swing-active-refresh`'s `loadShadowReads` and
`loadOptionQuote`, `banger-live-sync`'s `fetchMarks`) — the highest-severity, most visibly wrong
case (member-facing committed-position P&L) — via a new, purely additive helper rather than
changing `midOf`/`zeroDteMidOf` themselves. Raised on the standing #4076 Claude↔Cursor
collaboration thread (comments 5665071859, 5665084691 — the second corrects an overbroad first
draft of the root-cause once `midOf`'s own doc comment was read) for a second opinion on whether
0DTE/Vector/Legacy warrant the same treatment; not applied here to keep this PR single-issue and
avoid touching engines with their own possibly-compensating gates.

**Fix:** added `reliableMarkFromSnapshot(snap)` (`src/lib/providers/options-snapshot.ts`) — when
`snap.bid === 0` and the doc-priority `mark` exceeds `10x` the contract's own `last`/`dayClose`
reference price, falls through to that reference instead of the backstop-inflated mid; otherwise
(any real bid, or a bid=0 case that isn't wildly divergent — the legitimate deep-OTM shape) returns
`snap.mark` unchanged. `10x` is well above normal bid-ask noise (even a wide illiquid spread is
rarely >2-3x the last print) and well below a genuine intraday move on the same contract. Wired
into the three call sites above in place of the raw `snap.mark` read. 8 new unit tests
(`options-snapshot.test.ts`) cover: null passthrough, a real two-sided market never being
second-guessed regardless of divergence, the CRSR live repro (bid=0/ask=15/last=0.07 → falls
through to 0.07), a no-last/dayClose-fallback path, the legitimate deep-OTM case being preserved,
no-reference-at-all passthrough, and both sides of the 10x boundary.

**Fix ratio:** ~35 lines added (one new exported function + doc comment), ~6 lines changed at the
three call sites, 0 lines removed from `midOf`/`zeroDteMidOf` — additive only, per the "never
fabricate" philosophy this codebase already applies elsewhere (see the `mark ?? entry` laundering
fix cited in `live-plays.ts`'s own comments, FINDINGS 2026-08-06 SEV-1).

**RTH check:** re-pull the live swing horizons board during RTH and confirm PAGS/CRSR/EBS/CPRI/
BW/BAND/ACVA (or whichever BANGER positions are still open) no longer show a 4-digit-percent
`livePnlPct` when their underlying contract's real last trade doesn't support it — cross-check the
displayed mark against a fresh direct Polygon query the same way this finding's evidence was
gathered.
