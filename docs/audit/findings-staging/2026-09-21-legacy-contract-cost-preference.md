## Night Hawk Legacy — contract selection defaults to full ATM regardless of underlying price, so an expensive stock's pick can cost 10-50x a cheap stock's in the same book — FIXED (opt-in cost preference, delta-floor guarded)

> **kind:** `FINDING`

| | |
|---|---|
| **Area** | `src/features/nighthawk/lib/deterministic-edition.ts` (`pickChainContract`, all 4 Legacy call sites), `constants.ts` |
| **Status** | FIXED |
| **Severity** | P2 — member-facing product quality, not a correctness bug (every published contract was legitimate and under the hard premium cap) |
| **Found via** | operator directly asking why one night's book had a $2,488 MU contract alongside three sub-$120 contracts (BMNR/ETHA/MARA) |

### Root cause

`pickChainContract` doesn't pick "the most affordable eligible contract" — it picks whichever
strike on the chain is closest to spot (i.e. ATM), then only checks that its premium clears the
hard `MAX_OPTION_PREMIUM_PER_SHARE = $35/share` ceiling. That ceiling exists (PR-N15) so a strong
candidate is never dropped outright on an expensive underlying — it was never meant to be an
affordability target. Nothing in the function optimizes for dollar cost.

For a cheap stock ($13-$26), the ATM strike is naturally cheap. For an expensive one ($1,000+),
ATM premium scales roughly linearly with the underlying's own price (Black-Scholes ATM
approximation ≈ 0.4 × S × IV × √T), so the exact same "closest to spot" logic produces a wildly
more expensive contract for no reason related to setup quality, liquidity, or conviction — purely
because the stock itself costs more.

### Evidence

Live MU option chain pull, 2026-09-21, spot $1017.75, Sep-25 expiry (the exact contract the real
edition published that night, `MU $1020 CALL @ $24.88` = $2,488/contract):

| strike | Δ | mid | $/contract |
|---|---|---|---|
| 1020 (ATM, actual pick) | 0.502 | $24.88 | $2,488 |
| 1060 | 0.279 | $11.15 | $1,115 |
| 1090 | 0.159 | $5.57 | $557 |
| 1100 | 0.132 | $4.45 | $445 |
| 1150 | 0.048 | $1.46 | $146 |

Same night, BMNR/ETHA/MARA's own ATM strikes cost $111/$52/$71 per contract — 20-50x less than
MU's ATM pick, purely a function of stock price, not setup quality.

Delta floor was chosen from this same data: 0.15Δ still sits at a genuinely directional ~$550-650
on MU, while the $100-150/contract range other tickers sit at natively only shows up below ~0.06Δ
on MU — real lottery-ticket territory, not a comparable contract.

### Fix

Added a new, strictly opt-in **preference** tier (never a filter — never excludes a ticker):
`pickChainContract` gained a 5th optional parameter, `preferAffordable`. When true, it first tries
a subset of the already-strict (liquid + under the hard $35/share cap) pool filtered to
`premium ≤ PREFERRED_OPTION_PREMIUM_PER_SHARE ($8)` AND `|delta| ≥ MIN_PREFERRED_CONTRACT_DELTA
(0.15)`, picking the nearest-to-spot strike within that subset. If nothing clears both bars
(including when the chain row has no delta at all, e.g. some UW-sourced rows), it falls straight
through to the exact, unchanged nearest-to-spot ladder that existed before this fix.

All 4 Legacy call sites in `deterministic-edition.ts` (main synthesis loop, the diversity-hedge
swap, the forced-contrarian re-score, and `buildRescuePlays`) now pass `preferAffordable: true`.
`pickChainContract` is also called from Vector (`vector-play-candidates.ts`,
`vector-dte-horizon.ts`) — those call sites are untouched and don't pass the new parameter, so
they are structurally unaffected (the parameter defaults to `undefined`/falsy).

### Blast radius

- `pickChainContract`'s default behavior (no 5th arg) is byte-identical to before — proven by a
  dedicated regression test plus every pre-existing test in the file passing unmodified.
- Only Night Hawk Legacy's 4 call sites opted in. Vector and any other consumer of the shared
  function are unaffected by construction (new trailing optional parameter, not a signature
  change to any existing parameter).
- A ticker whose ATM strike is *already* inside the preferred band (the common case for a cheap
  stock) picks the exact same strike as before — the preference tier's nearest-to-spot member IS
  the ATM strike in that case.

### Fix rationale — why a delta floor, not just a lower cost cap

Swing's own `HORIZONS` config (`src/lib/horizons.ts`) documents exactly this trade-off already
having been made and reversed once: it explicitly replaced a "0.35Δ / [0.25,0.50] cheap OTM
banger" stance with a higher 0.50-0.75Δ stance because a multi-session directional thesis needs an
instrument that tracks the underlying, not a low-delta lotto. Simply minimizing premium for an
expensive underlying would eventually force a strike so far OTM it stops being a real directional
bet — the delta floor is what keeps "cheaper" from becoming "worse trade."

### Tests

7 new tests in `deterministic-edition.test.ts`: default behavior unchanged (regression), the
preferred pick fires and lands on the nearest strike clearing both bars, the delta floor correctly
excludes a cheaper-but-too-low-delta strike, a no-delta-anywhere chain is a total no-op (matches
real UW-sourced data), an already-affordable ATM strike is unaffected, a chain with no gap between
"too pricey" and "too low-delta" correctly falls through to the unchanged ladder, and one
end-to-end `buildDeterministicEditionPlays` test proving the real call site wiring works and a
cheap ticker in the same book is untouched. Full `src/features/nighthawk/**` suite: **1876/1876
pass**. `tsc --noEmit`: clean. `next lint`: no warnings.

### What's still open

`PREFERRED_OPTION_PREMIUM_PER_SHARE ($8)` and `MIN_PREFERRED_CONTRACT_DELTA (0.15)` are reasoned,
evidence-grounded defaults from one live chain pull, not backtested/calibrated constants — if
member feedback or forward-grading data suggests they should move, that's a future, separate,
evidence-driven change, not something to re-derive from this PR's own write-up.
