## 2026-10-20 — [FINDING, P2 Night Hawk 0DTE] Loss-side early de-risk A/B — MEASURED, candidate does NOT clearly improve outcomes, no gate changed

> **kind:** FINDING

**Context.** Member live-book audit directive, today's open 0DTE book: "Investigate why
we're closing winners around +8% while holding numerous positions down 20-34%... don't
dismiss this as normal chop simply because the -50% stop hasn't triggered... Test proposed
improvements on separate historical sessions with realistic costs before changing production
rules."

**The real asymmetry (read directly from `src/lib/zerodte/exit-engine.ts`, not inferred).**
The shipped profit-management ladder (ratchet OR trim_scale, per-row frozen
`exit_policy_at_commit`) actively de-risks WINNERS early and often — the ratchet arms a floor
off a peak as low as +5%; trim_scale banks a third of the position at a peak of only
+15-20% (range) to +40% (trend). There is NO symmetric mechanism on the LOSS side. A losing
position's only protections are the -50% hard stop, a thesis-break (evidence-based: a Cortex
veto or >=2 clustered opposing readings exceeding the entry's own committed score margin —
not a P&L trigger), or `flat_theta_bleed` (only fires if the play stayed inside the ±10% band
the whole time — unreachable once a position has moved past -10%, exactly the population
sitting at -20% to -34% live). Live evidence, today's book: RIOT -30-36%, OUST -33-38%, NBIS
-27-36%, HUT -20-26%, BTDR -23-35%, SMR -30%, CBRS/RARE/SBET/KORU -16-26% — all thesis
`intact`/`MINOR` rung, no veto fired, all well inside the -50% stop — a real, structural
"nothing between -10% and -50% can touch a loser" gap, not a data glitch.

**The candidate tested.** A LOSS-side tranche, symmetric in spirit to the existing profit
ladder, layered ONLY onto the still-fully-open loser population (never touches a row that
already banked a profit tranche, never touches the winner side): once peak-to-current
drawdown reaches a trigger threshold AND the position has aged past a minimum, exit the whole
remainder immediately.

**Method.** `scripts/audit/zerodte-loss-side-exit-ab.mjs` — real historical committed
population (`GET /api/admin/zerodte/tier-export`, 45-day window), each row's REAL contract
minute bars (Polygon), replayed under its OWN frozen `exit_policy_at_commit` using the REAL,
imported `exit-engine.ts` functions (`ratchetFloorPct`/`trimTranchesArmed`/
`trimScaleFloorPct`/`ratchetTargetReached`/`TRIM_SCALE_RULES`) — never reimplemented — with
real point-in-time NBBO entry/exit quotes and the same $100-multiplier-correct fee model this
toolkit's sibling real-cost scripts already fee-bug-fixed. Thesis-break/`flat_theta_bleed` are
NOT replayed (no point-in-time Cortex evidence exists to reconstruct them from historical bars
alone — same disclosed simplification `swing-early-trim-ab.mjs` uses). Chronological
TRAIN/VALIDATION split, held out.

**Result (first live run, 45-day window, n=29 graded per half, capped; 4 candidate
thresholds: -15%/age>=10min, -20%/age>=15min, -25%/age>=15min, -30%/age>=20min).**

| half | all 4 thresholds' mean_delta (candidate − baseline) |
|---|---|
| TRAIN | -2.48pp .. -0.08pp (all negative) |
| VALIDATION (held out) | -3.39pp .. -2.37pp (all negative, larger) |

No single threshold's 95% CI clears zero in either half (every cell INCONCLUSIVE by the
strict statistical bar), but the DIRECTION is consistent across all 8 cells: the candidate
underperforms the shipped baseline every time, and the effect is LARGER in the held-out
validation half, not smaller. **This is the opposite of a confirming result.**

**Interpretation.** A naive, context-free P&L-triggered early loss cut is not supported by
real data — likely the same mechanism E5 (`docs/audit/0DTE-RESEARCH.md`) already measured
for the profit side: 0DTE intraday moves are noisy enough that a fixed threshold cuts real
chop that would have mean-reverted before the actual time-stop, the same way a tight trailing
stop on the profit side was shown to scratch real runners. This is a coherent, now-measured
justification for why the existing design relies on EVIDENCE (thesis-break) rather than raw
P&L to cut a loser — evidence can distinguish a real breakdown from noise; a bare threshold
cannot.

| **Status** | MEASURED — no gate/exit rule changed. The asymmetry is real and documented on both sides (E5: profit side costs EV; this: a naive loss-side fix doesn't clearly help either). A smarter, evidence-weighted loss-side candidate remains open and unmeasured; this run only rules out the simplest P&L-threshold shape. Re-run with a larger population before treating the direction as final. |

Full write-up: `docs/audit/0DTE-RESEARCH.md`, "Loss-side early de-risk A/B" section (inserted
after E5's follow-ups).
