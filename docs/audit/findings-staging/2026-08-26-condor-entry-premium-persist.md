> **kind:** `FINDING`

## A committed condor's entry_premium was never persisted — governor blind to open condor risk — PARTIALLY FIXED

| **Status** | PARTIALLY FIXED — see "left open" below |
|---|---|

**Root cause.** Every ledger row's `entry_premium` (`scan.ts`'s commit-time row builder) was
computed via `resolveLedgerEntryPremium(s.plan?.entry_max, s.top_strike_avg_fill, s.plan?.mark)`.
A committed condor row always has `s.plan === null` (no single-leg plan — condor.ts:489's
`buildCondorSetup` also sets `top_strike_avg_fill: null`), so this always resolved to `null` for
every condor, permanently: the column is COALESCE-pinned first-write-wins (never rewritten on
refresh ticks).

**Impact.** `aggregatePremiumAtRisk` (`governor.ts`) sums `entry_premium` across every open
(non-CLOSED) ledger row to build the session premium-at-risk budget the G-5 governor gate checks.
A condor's real risk (`net_credit`) was therefore silently excluded from that aggregate for the
entire time any condor was open — the governor had zero visibility into open condor exposure. This
is a distinct, deeper bug than the already-fixed "G-5 governor premium-budget computed against a
stale null plan" (#2916) — that fix addressed the GATE's read of `s.plan` at commit time; this is
the LEDGER PERSISTENCE layer that feeds the ongoing aggregate, and it was never touched by #2916.

**Fix.** `scan.ts`'s commit-time row builder now special-cases `s.play_type === "CONDOR"`:
`entry_premium = s.condor_plan.net_credit / 100`. The division matters —
`condor_plan.net_credit`'s own doc comment states it's priced "$×100-per-contract"
(computed as `(shortMids − longMids) × 100`), while `entry_premium` is per-share throughout the
rest of the ledger (a directional row's entry_premium looks like `0.57`, not `57`) — dividing by
100 keeps the governor's aggregate summing apples to apples instead of overstating open condor
risk 100×.

**LEFT OPEN — this does NOT restore live condor P&L display.** `condorSellerPnlPct(entryCredit,
mark)` (`marks-math.ts`) still needs a live `mark`, and the mark-fetch path
(`syncLedgerLiveState`, `scan.ts`) keys strictly off a single-leg `plan_json.occ`, which a condor
row never has — there is no multi-leg (4-leg) mark-fetch path anywhere in
`scan.ts`/`live-marks.ts`. Building one (fetch all 4 legs' live bid/ask, recompute the net
decay value, reconcile units against this fix's per-share convention) is a new feature, not a
one-line correctness fix, and was judged out of scope for a same-day bug-fix PR. A committed
condor's live status is therefore still only ever `HOLD` or `CLOSED (time_stop)` on the desk —
an intraday range breach is invisible until the next day's `gradeZeroDteLedger` back-grades it.
This entire live-condor-marking gap is flagged here as a real, scoped follow-on item, not silently
left undocumented.

**Regression test.** `scan.test.ts`: "persistZeroDteScan: a committed CONDOR row persists
entry_premium from net_credit (was permanently null)" — a `play_type: "CONDOR"` setup with
`net_credit: 80` ($80/contract) asserts the upserted row's `entry_premium === 0.8`. Confirmed
failing against the pre-fix code (`entry_premium` was `null`) and passing post-fix.
