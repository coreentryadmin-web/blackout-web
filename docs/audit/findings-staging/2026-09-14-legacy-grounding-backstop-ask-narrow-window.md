> **kind:** FINDING

## The backstop-quote-ask fix (#4986) missed its own MORE common path — narrow-ATM-window contracts were still exposed — FIXED

| **Status** | FIXED (PR fix/legacy-grounding-backstop-ask-narrow-window) |
|---|---|

**Root cause.** Earlier today, PR #4986 fixed `rowFromOptionSnapshot` (the mapper behind
`augmentChainsWithExactContracts`, which fetches an exact per-contract snapshot for a play's
selected option) so a `bid:0` backstop-quote ask could no longer overwrite the published
`entry_premium` via `groundPlay`'s `sideAsk` check. That PR's own write-up flagged, but did not
fix, a second call site carrying the identical exposure: `pivotPolygonContracts` — the function
behind the PRIMARY, narrow-ATM±12%-window chain fetch (`resolveTickerChainRows` →
`fetchPolygonAtmChainAllExpiries`/`fetchPolygonAtmOptionsChain`).

This turns out to be the **more common path, not a secondary one**. `augmentChainsWithExactContracts`
only runs for a contract NOT already present in the narrow window — most of a play's selected
contracts (front-5-expiries, ATM±12%) land inside it and never reach the code #4986 fixed at all.
For those, `groundPlay`'s `matched` rows come straight from `pivotPolygonContracts`, which reads
Polygon's raw `last_quote.bid`/`last_quote.ask` — the same NBBO-shaped quote data
`fetchOptionsUnifiedSnapshot` reads — with an existing fallback that only engages when
`ask <= 0` (pure absence). It had no divergence check for a `bid:0` backstop ask that is
POSITIVE but fabricated (the exact CRSR-shaped case #4986 fixed elsewhere: `bid:0, ask:15` vs a
real `last_trade`/`day.close` of `$0.07`), so that raw, unguarded ask flowed straight through to
`ChainStrikeRow.call_ask`/`put_ask` and from there into `groundPlay`'s `entry_premium` overwrite,
completely unprotected by this morning's fix.

**Evidence.** New regression tests reproduce the identical CRSR-shaped fixture through
`pivotPolygonContracts` (exported for direct testing, matching the file's existing convention)
and confirm the guarded value now matches the honest `last_trade`/`day.close` reference. RED
confirmed two ways: unexported function, then exported-but-unguarded showing the exact wrong
value (`15 !== 0.07`).

**Blast radius.** Contained to `pivotPolygonContracts`. `pivotUwRows` (the UW fallback path, used
only when Polygon has no configured key or returns nothing) still has no `last`/`dayClose` fields
in its input shape at all, so it remains structurally unable to carry this guard — unchanged,
consistent with #4986's own disclosure.

**Fix rationale.** Hoisted the existing `lastTrade`/`dayClose` reads (previously computed only
inside the `ask <= 0` branch) so both fallback branches can share them, then added an `else if`
branch applying the exact same `ZERO_BID_MID_DIVERGENCE_MULTIPLE` (10x) threshold used by both of
today's earlier fixes: when `bid <= 0` (this function's own established "no real bid" convention,
matching its existing `ask <= 0` branch) and the ask exceeds the reference by more than 10x,
replace it with the honest reference instead. A real two-sided market, or a contract with no
reference at all, is left untouched exactly as before.

**Severity/impact.** High, and larger in reach than #4986 itself — this is the path MOST of
Legacy's published option premiums actually go through, not the minority "contract fell outside
the narrow window" path.

**Test evidence.** 4 new tests in `option-chain-prompt.test.ts`: the CRSR-shaped repro, a real
two-sided market left untouched, a bid:0 ask within the 10x band left untouched, and the existing
`ask<=0` after-hours fallback confirmed byte-for-byte unchanged. RED confirmed two ways as above.
GREEN post-fix: 16/16 in this file. `npx tsc --noEmit` clean. Full `npm test` run dispatched
separately; see the PR for the exact pass count.
