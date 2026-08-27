> **kind:** `FINDING`

## Vector contract picks: a bid-only-quoted contract was invisible at every liquidity tier — FIXED

| **Status** | FIXED |
|---|---|

**Root cause.** `contractPremium()` in `src/features/vector/lib/vector-play-candidates.ts` computed
a contract's premium as: mid if both bid and ask are live, else `ask` if only the ask is live, else
`null`. There was no branch for "only the bid is live" — a real, common state for a thin or
recently-crossed market where the ask has gone stale/dark before the bid does. That `null` return
happens inside `pickContractNearTarget`'s per-row scan, at the very first gate (`if (premium == null)
continue;`), before OI/premium-cap bucketing — so the contract was dropped before it could even
reach the `anyQuoted` catch-all bucket that's supposed to be the last-resort "show *something*"
tier. A real, high-conviction play could therefore render **zero** picks for a ticker/side that
genuinely had a live, executable, bid-only-quoted contract.

**Why it wasn't caught earlier.** All existing tests constructed rows with both `callAsk`/`callBid`
(or `putAsk`/`putBid`) set, so the missing-ask branch was never exercised. The bug is silent by
construction — a dropped contract just means one fewer candidate in the DTE-window scan, which
looks identical to "no contract existed near that strike," not "a contract existed but was
discarded."

**Blast radius.** `contractPremium` is the single gate for every contract candidate considered by
`pickContractNearTarget` (weekly/monthly windows, all roles: primary-long/short, fade-dip/rip,
gex-king-pin, magnet-mean, flow-whale). It is not called by `pickChainContract` (the 0DTE picker in
`deterministic-edition.ts`), which has its own independent premium logic — not touched by this fix,
and worth checking separately (see the sibling finding on 0DTE `targetStrike` handling).

**Fix.** `contractPremium` now falls back to `bid` when only the bid is live, mirroring the existing
ask-only fallback. Mid-price is still preferred whenever both sides are quoted (unchanged), and the
existing wide-spread rejection (`(ask-bid)/mid > 1.0`) still applies when both sides are present.
Added test coverage: bid-only quote is picked, both-sides-missing still returns null, plus three
previously-uncovered empty-input paths (empty chain rows, null chain, null context) all correctly
return `[]` — `src/features/vector/lib/vector-play-candidates.test.ts`.

**What was deliberately left unchanged.** The wide-spread rejection threshold, the OI/premium-cap
bucketing (`strict`/`relaxedPremium`/`relaxedOi`/`anyQuoted`), and `pickChainContract`'s separate
0DTE premium logic — none of those are implicated by this specific gap.
