# Banger Exit Trail-Sweep Optimization Grid — 2026-09-27

> **kind:** REPORT — data only. **No production behavior changed.** No candidate is recommended or
> shipped. Native swing untouched.

## Scope

Follow-up to the head-to-head validation (PR #5517). This sweeps a third axis — the runner's
trailing-stop percentage — that PR #5517 held fixed at production's own real value.

- **Partial trigger**: 100%, 125%, 150%, 175%, 200% (5 levels)
- **Partial fraction**: 33%, 50%, 67% (3 levels)
- **Runner trailing stop**: 40%, 50%, 60%, 70% of peak (4 levels)
- **Hard stop**: fixed at −60% pre-partial, unchanged, in every cell
- **Grid size**: 5 × 3 × 4 = **60 configurations**, one of which (trigger=100%, fraction=50%,
  trail=50%) is the **exact current production rule** and appears as the control in every table.

Data source: `GET /api/admin/banger/closed-export?days=270`, n = 1,310 closed positions, same
population and window as PR #5517.

## Methodology (extends, does not replace, PR #5517's reconstruction)

The partial-trigger/fraction axis reuses PR #5517's exact `syntheticFullReturnPct` reconstruction
unchanged. The new trail axis required a further reconstruction, since Banger has no per-tick
history and production has only ever run one trail level (50%) — full derivation, proof, and
disclosed limitations are in `scripts/audit/lib/banger-exit-trail-grid-eval.mjs`'s header. Summary:

- **The control cell is exact, not approximate.** When the tested config is literally production's
  own rule (100%/50%/50%), the tool returns `current` directly — verified: the control shows a
  **literal zero delta on every metric**, not a rounding artifact.
- **For every other cell**, the runner's hypothetical exit level is reconstructed from `peak_premium`
  (a true, complete running max on these closed rows) under a disclosed single-monotonic-decline
  assumption, floored at the real recorded outcome when the tested trail is tighter than what
  actually happened (no evidence in the data that price fell further than where the real position
  closed).
- **A real bug was caught and fixed while building this**, via the same discipline as PR #5517: a
  first draft made an *untriggered* candidate (a higher trigger never reached) inherit production's
  own real blended outcome (`current`) instead of the raw, no-partial-ever return
  (`syntheticFullReturnPct`) — silently erasing every "winner flips to loser" case, since it assumed
  a safety-net partial the candidate never actually takes. Caught because it reproduced **zero**
  winners flipped across all 60 configs, which contradicted PR #5517's own already-validated finding
  (93 flipped at trigger=200%/fraction=67%). Fixed, then **re-verified the exact 93/16.5% figure
  reproduces** at the equivalent cell in this grid (trigger=200%, fraction=67%, any trail level —
  trail cannot affect this count, since it only governs already-triggered rows) — a real,
  independent cross-check against prior validated work, not just a passing test.

## Control (exact production rule)

| trigger | fraction | trail | n | expectancy | PF | median | win rate | max DD (pts) | winners flipped | large winners degraded |
|---|---|---|---|---|---|---|---|---|---|---|
| 100% | 50% | 50% | 1,310 | +2.6% | 1.1 | −60.0% | 43.1% | −9,680.8 | 0/565 (0.0%) | 0/394 (0.0%) |

## Full 60-configuration grid

Delivered as `banger-trail-grid-full.csv` (61 rows incl. header) — every config's full-population
metrics, early-half/late-half OOS split, and incremental delta vs. the control, for every requested
metric (expectancy, profit factor, max drawdown, median return, win rate, winners-flipped count/rate,
large-winner-degradation count/rate).

Headline shape, not a recommendation: expectancy and profit factor both increase monotonically with
looser partial fractions (33% > 50% > 67%) and looser trails (70% > 60% > 50% > 40%) at every fixed
trigger. Winners-flipped and large-winner-degradation rates increase monotonically with the trigger
level (0% at trigger=100%, rising to 7.3% / 11.7% / 15.4% / 16.5% at 125/150/175/200%) and are
**invariant to trail level** (trail only governs already-triggered rows; flip/degradation counts are
set entirely by whether the position ever reaches the tested trigger at all).

## Pareto frontier

Objectives: maximize expectancy, minimize |max drawdown|, minimize winners-flipped rate. Delivered
as `banger-trail-grid-pareto-frontier.csv`.

**1 of 60 configurations is non-dominated:**

| trigger | fraction | trail | expectancy | max DD (pts) | winners flipped | PF | win rate |
|---|---|---|---|---|---|---|---|
| 100% | 33% | 70% | +97.4% | −2,125.2 | 0.0% | 3.9 | 43.2% |

This single point dominates every other cell in the grid on all three axes simultaneously: it keeps
production's own trigger (100%), so the untriggered population — and therefore the winners-flipped
count — is byte-identical to the control (0 flips, 0 degraded), while a smaller partial fraction
(33% vs. control's 50%) and a much looser trail (70% vs. control's 50%) let the runner capture far
more of the peak. Every other tested cell either has a higher trigger (introducing flips/degradation
that this cell avoids entirely) or a lower expectancy/looser-drawdown combination than this one at
the same trigger.

## Early-half vs. late-half OOS

Included per-config in the full CSV (`early_*` / `late_*` columns). The frontier point's own split:
early-half expectancy +107.4%, late-half +87.4% — both well above the control's own early (+4.3%)
and late (+0.8%) halves, in the same direction in both halves.

## Files delivered

- `banger-trail-grid-full.csv` — all 60 configurations, full metrics + OOS split + vs.-control deltas.
- `banger-trail-grid-pareto-frontier.csv` — the 1 non-dominated configuration, same columns.

## No recommendation

Per instruction: this is data only. No configuration is recommended, and no production behavior has
changed. Native swing remains untouched, still accumulating closed trades.
