## Night Hawk Swings — closed-deck roll-chain row paired a wrong contract's strike/expiry/occ with the preserved worst-leg loss — FIXED

> **kind:** `FINDING`

**Symptom:** `closedDeckSourcesFromChains` (`src/lib/swing/closed-plays.ts`) emits one
row per resolved roll chain, reporting the chain-composite's worst (preserved) leg P&L
as `exitPnlPct` — correct, intentional design (`record.ts`'s "never net away a losing
leg" invariant). But the row's `contract` (strike/right/expiry/dte) and `occ` came
unconditionally from the TERMINAL leg's own row (`closedDeckSourceFromRow(terminal)`),
even when the worst graded leg was an EARLIER, different leg entirely. Live repro
(Ask Largo standing-mandate deep-dive, 2026-10-11): AMZN root position 44 (entry
$5.15 → exit $3.73, **-27.67%**, strike 605/expiry 2026-10-16, ROLLED) rolled into
terminal position 48 (entry $5.80 → exit $10.00, **+72.41%**, strike 245/expiry
2026-10-09, CLOSED). The served closed-deck row correctly reported `exitPnlPct: -27.67`
(the preserved worst leg) but paired it with leg 48's own `occ`
(`AMZN261009C00245000`) and strike/expiry (245C, 2026-10-09) — a contract that never
lost 27.67%; that loss belongs to a different, earlier, already-rolled-away contract
(605C, 2026-10-16).

**Root cause:** The 2026-09-15 fix (same function, see the comment immediately above
this one in the file) already recognized and fixed this exact failure shape for
`entryPremium`/`peakPremium`/`troughPremium` — nulling them when the worst leg isn't
the terminal leg, since those fields have no honest per-leg substitute to borrow. It
did not extend the same reasoning to `contract`/`occ`, which — unlike the price-journey
fields — DO have a knowable, correct per-leg substitute: the worst leg's own row
carries its own `contract_strike`/`contract_type`/`contract_expiry`/`contract_occ`,
sitting unused in the same `chain` array already passed into the function.

**Evidence:** Live repro via production (`GET /api/market/swing/record?days=90`,
`records[]` for `rootPositionId: 44`) confirmed the leg-level data directly: leg 44
(roll_seq 0, `realizedPnlPct: -27.67`, grade `entry_premium: 5.15, exit_mark: 3.73`)
vs. leg 48 (roll_seq 1, `realizedPnlPct: 72.41`, grade `entry_premium: 5.80,
exit_mark: 10`) — genuinely different contracts, confirmed by cross-checking
`GET /api/market/nighthawk/horizons?view=swings` for the live committed AMZN
positions' own `contract` fields (strike 605 vs 245, matching the two legs). New
regression test (`src/lib/swing/closed-plays.test.ts`, "resolves the WORST leg's own
contract/occ...") pins the exact failure mode with a synthetic parent/child pair on
genuinely different strikes/expiries/occs — confirmed **RED pre-fix** via `git stash`
(`occ` asserted `O:AMZN261016C00605000`, actual `AMZN261009C00245000` — the terminal
leg's contract), **GREEN post-fix**.

**Fix:** Extracted the strike/right/expiry/dte/occ resolution logic already inside
`closedDeckSourceFromRow` into a reusable pure helper, `contractBundleFromRow` (not
gated on `CLOSED` status, unlike the function it was pulled from, so it also works on
a `ROLLED` parent leg's row). In `closedDeckSourcesFromChains`, when the worst graded
leg (identified by matching the composite's own `worstLegPnlPct` against each raw
row's `realized_pnl_pct`) is NOT the terminal leg, resolve that leg's own contract
bundle and use it for `contract.strike/right/expiry/dte` and `occ` instead of the
terminal's. Falls back to omitting `occ` (nullable) only in the defensive case where
the worst leg's own row can't yield a contract bundle either (malformed/legacy data);
`contract` itself stays non-optional per its type, so the terminal's bundle is kept
in that edge case rather than left absent — the same trade-off the type already makes.

**Fix rationale:** Correcting the identity is strictly better than omitting it here,
unlike the entry/peak/trough case the 2026-09-15 fix handled — the worst leg's own
contract fields are directly available on the same already-fetched `chain` rows, no
new fetch required. `mid`/`delta`/`gamma`/`theta`/`vega`/`iv` (greeks) are left from
the terminal leg unchanged — they were already hardcoded `null` (gamma/theta/vega/iv)
or low-stakes/secondary display details (mid/delta) for a closed position's card, out
of scope for this fix.

**Blast radius:** `src/lib/swing/closed-plays.ts`'s `closedDeckSourcesFromChains` and
`closedDeckSourceFromRow` (refactored to share the new helper, behavior-preserving on
its own success path — confirmed by the full existing 22-test suite still passing
unchanged). No other caller of either function.

**Regression guard:** `src/lib/swing/closed-plays.test.ts` — new test pins the exact
failure mode (genuinely different parent/child strike/expiry/occ) and verified RED
pre-fix / GREEN post-fix via `git stash`. Full `src/lib/swing/*.test.ts` suite:
1672/1672 pass post-fix. `npx tsc --noEmit`: clean.
