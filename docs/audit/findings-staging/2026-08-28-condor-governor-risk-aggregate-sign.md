> **kind:** FINDING

## Governor's session premium-at-risk aggregate summed a condor's net_credit (income) instead of max_loss (risk) — understated exposure by up to ~9-10x — FIXED

| **Status** | Fixed in PR (fix/condor-governor-risk-aggregate) |
|---|---|

**Symptom:** None live-reported — found during a deep audit of iron condor selection quality and
gate calibration, checking whether position sizing/risk aggregation respects the condor's
asymmetric payoff (many small wins, occasional large loss).

**Root cause:** `scan.ts`'s ledger-row builder stamps a committed condor row's `entry_premium` as
`s.condor_plan.net_credit / 100` — the credit RECEIVED for selling the spread (a 2026-08-26 fix
that made condor rows visible to the governor at all, after `entry_premium` was previously always
null for condors). `governor.ts`'s `aggregatePremiumAtRisk` sums `entry_premium` across every open
ledger row to build the session-wide risk figure `GOVERNOR_MAX_PREMIUM_AT_RISK` gates on.

For a directional play, `entry_premium` (premium paid) IS the capital at risk. For a condor,
`net_credit` is deliberately the SMALL side of the trade — `condor.ts` floors `credit_to_risk` at
just 10% of `gross_wing_risk` — so the aggregate was summing a number that can be **~9-10x smaller**
than the condor's actual defined-risk exposure (`max_loss = gross_wing_risk − net_credit`). This
directly contradicts `iron-condor.ts`'s own header warning ("profitability needs the credit priced
right + a breach stop + small size") — the one place meant to size against the tail was sizing
against the wrong number.

**Why this wasn't simply "use max_loss instead of net_credit" as `entry_premium`:** `entry_premium`
is also load-bearing for condor P&L display — `marks-math.ts`'s `condorSellerPnlPct(entryCredit,
mark)` computes seller-framed live P&L as `(entry − mark)/entry`, which requires the CREDIT
(income) as the denominator, not the max loss. Changing `entry_premium`'s meaning would have broken
the live P&L badge.

**Fix:** `aggregatePremiumAtRisk` now reads a condor row's real defined risk from
`entry_context.condor.max_loss` (already pinned at commit, just never read for this purpose) when
`entry_context.play_type === "CONDOR"`, and falls back to `entry_premium` for every other row type
unchanged. `entry_premium` itself is untouched — condor P&L display is unaffected.

**Currently inert, not a live incident:** `GOVERNOR_ENFORCE_PREMIUM_BUDGET` defaults to `false`
(measure-only) and no position sizing (`position-sizing.ts`, fractional-Kelly, explicitly
"STANDALONE + UNWIRED") is connected to any play type yet — every committed play, condor included,
is implicitly one unit. So nothing was actually mis-gated live. This fix matters because it will
silently under-budget real exposure the instant either the budget flag is flipped on or Kelly
sizing gets wired to condors — better to have the number right before either happens.

**Blast radius:**
- `src/lib/zerodte/governor.ts` — `GovernorLedgerRow` type widened with `entry_context` (matches
  `ZeroDteSetupLogRow`); new `riskContribution` helper; `aggregatePremiumAtRisk` now calls it
  instead of reading `entry_premium` directly.
- `src/lib/zerodte/governor.test.ts` — 3 new tests: condor contributes `max_loss` not
  `net_credit`; directional rows unaffected; a legacy condor row with no `max_loss` pinned
  contributes 0 (never a fabricated number).

**Evidence of correctness:** `governor.test.ts`: 59/59 pass. Full `src/lib/zerodte/*.test.ts` +
`src/lib/zerodte/thesis/*.test.ts`: 1244/1244 pass (1 pre-existing skip). `npx tsc --noEmit`
clean. Node 20.
