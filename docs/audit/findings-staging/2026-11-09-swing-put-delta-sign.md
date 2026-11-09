# Swing PUT contracts showed a positive (wrong-signed) delta for every CLOSED position and for new roll-child legs, even after the 2026-11-08 WATCH-path fix

> **kind:** `FINDING`

### Summary
`ChainContract.delta` is deliberately an ABSOLUTE MAGNITUDE (`horizon-fanout.ts`: "Absolute delta
in [0,1] (calls positive, puts' magnitude)"; `contract-ranker.ts` repeats the same convention) so
the contract ranker can band-match `|delta|` regardless of call/put. That abs value is pinned
verbatim into the ledger's `contract_delta` column at commit and at every roll — the ranker never
re-signs it. On 2026-11-08 a fix landed in `horizon-plays.ts`'s `produceHorizonPlays` to re-sign
delta to negative for puts, but ONLY at that one chokepoint (WATCH candidates and freshly-produced
COMMIT candidates). It never touched:
- `closed-plays.ts`'s `contractBundleFromRow` — the ONLY path serving every CLOSED/ROLLED swing
  position's contract — read `row.contract_delta` back verbatim. A closed position has no
  live-quote concept at all, so this was permanently wrong, not a timing race.
- `live-plays.ts`'s `contractFromRow` — the fallback leg (used whenever the latest active-refresh
  tick didn't land a live quote) likewise never re-signed `row.contract_delta`.
- `roll-plan.ts`'s `buildRollChild` — every NEW roll-child leg pinned going forward, even after
  the 2026-11-08 fix, since the roll pipeline never routes through `produceHorizonPlays` at all.

Downstream, the sign is treated as meaningful: `play-brief.ts` renders `Δ ${sign(g.delta)}...`
(Ask Largo's own Greeks line), and `PlayTerminal.tsx` explicitly colors a negative delta red with
its own comment "a negative delta (a put's directional delta) still renders red" — so a
wrong-signed PUT delta rendered in the same neutral, non-red style as a bullish call's delta, both
on the member board and in Ask Largo's own narrated brief.

### Evidence
Live-pulled 2026-11-09 from `GET /api/market/swing/record?days=90`: every one of the 12 CLOSED
SHORT/PUT swing positions in the 90-day `closedDeck` showed a POSITIVE `contract.delta`
(GOOG#71 0.56, CG#25 0.55, MSTR#33 0.60, INTC#30 0.58, GLW#22 0.58, AMZN#27 0.58, RKLB#23 0.61,
IBIT#8 0.59, PYPL#24 0.67, NOW#21 0.59, IGV#16 0.58, INTC#15 0.54 — all `right:"P"`,
`direction:"SHORT"`). For comparison, the 3 currently-COMMIT SHORT/PUT positions correctly showed
NEGATIVE delta (-0.49/-0.59/-0.98) ONLY because they currently happen to carry a live two-sided
quote that overrides via `live-plays.ts`'s `quote?.delta` branch — all three were committed
BEFORE the 2026-11-08 fix, so the underlying pinned `contract_delta` is still the wrong abs value,
simply masked by the live quote right now.

### Fix
Applied the identical re-sign used by the 2026-11-08 fix at the three remaining choke points,
matching each site's own `right`/`contract_type` variable already in scope:
- `closed-plays.ts` `contractBundleFromRow`: re-sign at read time — a pure display-layer fix, no
  DB backfill needed, correcting every already-closed historical row too.
- `live-plays.ts` `contractFromRow`: re-sign only the fallback operand (`quote?.delta` is already
  a genuine signed live read).
- `roll-plan.ts` `buildRollChild`: fix at the true pin site so new roll children are never wrong
  to begin with.

### Evidence detail
- RED: 3/127 fail pre-fix (one new test per touched file). GREEN: 127/127 post-fix.
- Full `src/lib/swing/*.test.ts` + `src/lib/horizon-plays.test.ts`: 2308/2308 pass.
- `npx tsc --noEmit` clean.

### Blast radius
Three call sites across `closed-plays.ts`, `live-plays.ts`, `roll-plan.ts`. No change to
`horizon-plays.ts` (already fixed 2026-11-08) or to `contract-ranker.ts`/`horizon-fanout.ts`'s
absolute-magnitude convention itself, which is intentional and correct for ranking.

| **Status** | FIXED — this PR. |
