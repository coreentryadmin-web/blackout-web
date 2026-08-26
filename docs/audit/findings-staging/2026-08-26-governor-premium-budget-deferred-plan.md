> **kind:** `FINDING`

## G-5 premium-budget check computed against a permanently-stale plan=null 0 in thesis-first mode — FIXED

| **Status** | FIXED |
|---|---|

**Root cause.** `attachGateVerdicts` (`scan.ts`) calls `evaluateZeroDteGovernor` (G-5,
`governor.ts`) with `entry_premium: input.plan?.entry_max ?? input.plan?.mark ?? null`. Under
thesis-first (`ZERODTE_THESIS_FIRST=1`), `input.plan` is still `null` at that point — contract
plans attach afterward (`attachThesisContractPlans`/`attachContractPlans`) — so the candidate's
OWN contribution to the session premium-at-risk budget was permanently computed against `0`, for
the entire life of that gate verdict. #2911 fixed the identical "deferred, never reconciled"
shape for G-8/G-9 (`refreshPlanQualityGateBlocks`, run after plan attach) but did not touch G-5 —
found while reviewing that fix for other order-dependency hazards.

**Why this shipped invisibly.** `GOVERNOR_ENFORCE_PREMIUM_BUDGET` defaults `false` — the premium
budget is currently a MEASURE-only path (`premiumBudgetReason` computes the reason string
regardless, but `evaluateZeroDteGovernor` only pushes the block when the flag is on), so no live
commit has ever actually been blocked by this. It would misfire the instant the flag is flipped
on (a one-line env change, no code deploy) — every thesis-first commit would silently under-count
its own premium against the cap.

**Scope check:** `gamma_regime` (G-5's other budget check, `governor_gamma_budget`) is NOT
similarly stale — it comes from discovery/positioning data already on the setup before gates run,
not from the deferred plan — so only the premium-budget check needed a refresh.

**Fix.** Added `refreshGovernorPremiumBudgetBlocks(gate, entryPremium, premiumAtRisk, enforce?)`
(`gates.ts`), mirroring `refreshPlanQualityGateBlocks`: strips any stale
`governor_premium_budget` block and recomputes it from the REAL post-attach premium. Threaded
`governorPremiumAtRisk` out of `attachGateVerdicts`'s return value (previously `Promise<void>`,
now `Promise<{ governorPremiumAtRisk: number }>`) so `scan.ts`'s thesis-first refresh loop can
call it right after `refreshPlanQualityGateBlocks`, using the same real
`s.plan?.entry_max ?? s.plan?.mark`.

**Fix rationale.** `enforce` is an optional test-only override (defaults to the real
`GOVERNOR_ENFORCE_PREMIUM_BUDGET` env flag) — the flag is read once at module load
(`envFlag`), so a unit test cannot flip it at runtime; the default preserves the exact
production behavior (dormant today) while letting the regression test exercise the
would-block-if-enabled path directly. Left the flag itself untouched — flipping it on is a
calibration decision for the ledger to graduate, not something this fix should force.

**Regression test.** `gates.test.ts`: "refreshGovernorPremiumBudgetBlocks: recomputes the budget
using the REAL post-attach premium, not the stale plan=null 0" — confirms a null (stale)
entry_premium does NOT block a near-cap budget, a real post-attach premium DOES block it when
`enforce: true`, and the current production default (`enforce: false`, i.e. the real flag) never
blocks either way — pinning today's dormant behavior while proving the reconciliation logic is
correct for whenever the flag graduates.
