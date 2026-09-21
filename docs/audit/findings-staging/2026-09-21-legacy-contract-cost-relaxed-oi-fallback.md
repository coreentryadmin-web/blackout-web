## 2026-09-21 — [FINDING, P2] Legacy contract-cost preference was a silent no-op on any underlying where affordable and deeply-liquid strikes don't overlap — FIXED

> **kind:** `FINDING`

| | |
|---|---|
| **Area** | Night Hawk Legacy — `pickChainContract` (`src/features/nighthawk/lib/deterministic-edition.ts`) |
| **Severity** | P2 (product quality — live member complaint, not a data-correctness defect) |
| **Status** | FIXED |

### Root cause

The cost-preference tier shipped earlier the same day (2026-09-21, PR `fix/legacy-contract-cost-preference`) only ever searched the `strict` candidate pool — contracts that clear BOTH the hard premium cap (`MAX_OPTION_PREMIUM_PER_SHARE=35`) AND the full liquidity floor (`tieredMinOi(spot)`: 500 OI for any underlying at or above $200, 200 for $50-$200, 100 below). On an underlying where the cheap, delta-qualifying strikes exist but sit just under that liquidity bar, the preference tier had nothing in `strict` to select from and silently fell through to the unchanged ordinary "nearest to spot" (ATM) ladder — the exact expensive behavior the earlier fix was built to avoid, with zero indication anything had gone wrong.

This was not a hypothetical: the operator flagged live contracts still over $10/share the very next trading day after the first fix shipped and deployed.

### Evidence

The next edition built after the earlier fix deployed (published 2026-09-21T21:38:20Z, for 2026-09-22) picked:

| Ticker | Spot | Picked strike | Premium | Real cheaper alternative in the SAME live chain |
|---|---|---|---|---|
| ALAB | $303.25 | $340C (ATM-ish) | **$30.23/share** | $430C: $7.03/share, 0.183Δ, **75 OI** (tieredMinOi=500) |
| TWLO | $243.84 | $270C (ATM) | **$12.75/share** | $290C: $6.10/share, 0.289Δ, **248 OI** (tieredMinOi=500) |
| META | $variable | $775C | $7.58/share | (already under the $8 preference — unaffected, confirms the mechanism works when liquidity isn't the blocker) |

Both "real cheaper alternative" rows are live, quoted, non-zero-OI contracts pulled directly from Polygon (`/v3/snapshot/options/{ticker}`) at the time of investigation — genuinely tradeable, just short of the 500-OI bar built for index-class names like SPY/QQQ. Confirmed both underlyings' spot is `>= $200`, so `tieredMinOi` was the real, active 500 floor in both cases — not a data-fetch gap.

### Fix

Added a second pass to the `preferAffordable` tier in `pickChainContract`: when nothing in the `strict` pool clears the preferred cost + delta bars, search the `relaxedOi` pool (contracts already under the hard premium cap, computed by the same existing bucketing) for candidates that ALSO clear the preferred cost + delta bars AND a new, lower `PREFERRED_OPTION_RELAXED_MIN_OI = 50` floor — well above the OI=0 phantom-quote strikes observed on the same two live chains, comfortably below both evidenced real candidates (75, 248).

Order of precedence, strictly preserved:
1. Strict-pool affordable (unchanged from the earlier fix — deep liquidity + cost + delta).
2. Relaxed-pool affordable (new — real liquidity (oi>=50) + cost + delta).
3. Unchanged ordinary ladder (strict → relaxedPremium → relaxedOi → anyQuoted → shortDated), exactly as before either fix existed.

Never excludes a ticker; never changes the ordinary (non-`preferAffordable`) pick in any way; Vector's own `pickChainContract` calls never pass `preferAffordable`, so this is a Legacy-only behavior change (confirmed: Vector's `vector-play-candidates.test.ts`/`vector-dte-horizon.test.ts` pass unmodified).

### Tests

Added to `deterministic-edition.test.ts`:
- Relaxed-OI candidate (oi=75, between the new 50 floor and the real 500 tiered floor) IS picked when nothing in `strict` qualifies.
- Without `preferAffordable`, the same thin candidate is never reached — zero regression on the ordinary ladder.
- A genuinely too-thin candidate (oi=3) still falls through to the unchanged ordinary ladder — the relaxed floor is a real floor, not a rubber stamp.
- A real `strict`-pool affordable candidate still wins over a nearer but thinner `relaxedOi` one — liquidity safety is never traded away when a real liquid option exists.

Full suite: 15159/15159 pass (3 pre-existing skips), `tsc --noEmit` clean, Vector's own contract-selection tests pass byte-for-byte unmodified.
