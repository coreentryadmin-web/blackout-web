# Night Hawk Swings — WATCH-stage PUT plays showed a POSITIVE delta, same as a call

> **kind:** FINDING

## Summary
`GET /api/market/nighthawk/horizons?view=swings` served a live SHORT/PUT WATCH candidate (TSLA, 365P, 5DTE) with `contract.delta: 0.61` — positive. Every other PUT on the board (the three committed positions, PLTR/GOOG/MRVL) correctly carried a negative delta. A positive delta on a put contradicts standard options convention (puts are always in [-1, 0]) and the opposite of what the same field shows once a position is actually committed — any downstream consumer reading `contract.delta` for sign (hedging math, directional-exposure math, Largo's narrative) would get this one backwards.

## Root cause
`ChainContract.delta` (`src/lib/horizon-fanout.ts`) is documented and deliberately an **absolute magnitude** — "calls positive, puts' magnitude" — because `contract-ranker.ts`'s band-matching (`inBand = withDelta.filter((c) => c.delta >= bandLo && c.delta <= bandHi)` with positive `bandLo`/`bandHi`) and `thesisFit`'s delta-closeness term both need sign-agnostic comparison to work for puts at all; a signed delta would make a well-matched put fail every band check. That convention is correct *inside* the ranker.

`src/lib/horizon-plays.ts`'s `produceHorizonPlays` (`contract: pick.contract`) passed this same unsigned `ChainContract` straight through as the play's own exposed `contract` field — the one the member/Largo-facing board actually renders. For a **committed** position, this never surfaces: once persisted, the board re-reads the position via `fetchOpenSwingPositions`/`live-plays.ts`, whose `contractFromRow` explicitly prefers a live-fetched, correctly-signed `quote.delta` over the commit-pinned value ("LIVE delta wins over row.contract_delta... the latter is PINNED AT COMMIT"). A **WATCH**-stage play is never committed, so it never goes through that re-signing path — it carries the ranker's raw magnitude forever, which is why only the WATCH-lane put showed the wrong sign while every committed put was correct.

## Fix
`src/lib/horizon-plays.ts`: when assigning a play's `contract` field, re-sign `delta` to negative for `right === "P"` (`{ ...pick.contract, delta: -Math.abs(pick.contract.delta) }`), leaving `pick.contract` itself (and every ranker-internal comparison that ran before this point) untouched. This is the single choke point every WATCH — and freshly-produced, pre-persistence COMMIT — play's contract passes through, so the fix covers both without touching `contract-ranker.ts`'s own internal unsigned convention (which must stay unsigned for band-matching to work for puts at all).

## Validation
- RED: added `SHORT/PUT plays carry a NEGATIVE delta, not the ranker's internal absolute magnitude` to `src/lib/horizon-plays.test.ts` — confirmed it fails against the pre-fix source (13 tests, 1 fail) by temporarily reverting just the source file.
- GREEN: same test passes after the fix (13/13), across all three horizons (ZERO_DTE/SWING/LEAPS), and confirms CALL deltas stay positive (no regression on the correct half of the convention).
- `npx tsc --noEmit` clean.
- Full regression pass: `horizon-plays.test.ts`, `horizon-fanout.test.ts`, `swing/discovery.test.ts`, `swing/play-brief-resolve.test.ts`, `swing/contract-ranker.test.ts` — 115/115 pass, no other consumer broke.

## Blast radius
`produceHorizonPlays` is the shared play-producer for all three Night Hawk horizons (0DTE/SWING/LEAPS), though the live 0DTE board currently sources from a separate, proven engine (`getZeroDteBoardPayload`) rather than this function — so in production today this fix's real effect is scoped to Swing (and, once it ships, LEAPS) WATCH-stage put contracts. No change to `ChainContract`'s own type or `contract-ranker.ts`'s internal band-matching logic.

| **Status** | FIXED — this PR. |
