# C-tier/untiered exit-mode A/B measured — shipped RATCHET beats DEFAULT-OFF trim_scale on this population

> **kind:** `FINDING`

## What was measured

Task #59 (`docs/audit/0DTE-RESEARCH.md`'s 2026-08-28 "Follow-up scoped but BLOCKED" note): does
the shipped policy — C-tier and untiered 0DTE plays exit via `ratchet` (`resolveExitModeForTier`,
`src/lib/zerodte/exit-sync.ts`) — actually outperform the DEFAULT-OFF `trim_scale` exit (the E5
⅓@+25%/⅓@+50%/run-the-last-⅓ scale-out already shipped for A/B-tier), or is C/untiered just
inheriting ratchet by default without ever being measured on its own population? That measurement
was blocked until PR #3112 (the admin `tier-export` route) exposed `entry_premium`/`top_strike`/
`expiry` per historical row — the public `/api/market/zerodte/record` route only ever returns
aggregates, so a real historical play could never be re-priced against its own option minute bars.

## Evidence

New script `scripts/audit/tier-exit-mode-ab.mjs` (`npm run ab:tier-exit-mode`), first live run
against production, 90-day window:

- Population (tier `C` or untiered): **111** plays, **111** re-priceable, 1 dropped for missing
  Polygon bars, 99 successfully graded through the exit engine under both modes.
- **RATCHET** (shipped): win rate **45.5%**, avg P&L **+5.5%**. Outcome mix: 43 `runner_close`,
  44 `stopped`, 8 `flat_scratch`, 4 `ratchet`-floor exits.
- **TRIM_SCALE** (the alternative): win rate **38.4%**, avg P&L **−7.3%**. Outcome mix: 29
  `doubled`, 18 `runner_close`, 44 `stopped`, 8 `flat_scratch`.
- **Delta (trim_scale − ratchet): −12.8pp avg P&L, −7.1pp win rate.** trim_scale is measurably
  WORSE on this specific population, the opposite of what its A/B-tier result might suggest.

Both modes are graded through the SAME real minute bars per play and the SAME shipped
`evaluateExitState`/`TRIM_SCALE_RULES` — only the harness (bar-replay loop) is
script-local, copied verbatim from `zerodte-sim.mjs`'s own precedent (never re-implementing the
graded decision logic itself, only the offline bar-replay wrapper around it).

## Interpretation

The 43 `runner_close` rows under ratchet (vs only 18 under trim_scale) are the likely driver:
ratchet lets a runner ride uninterrupted past +50% toward the close far more often for this
population, while trim_scale's earlier ⅓@+25%/⅓@+50% banking locks in smaller gains on names that
would have run further — and the `doubled` bucket (29 rows hitting the trim_scale runner-target)
isn't enough to offset that. This is consistent with C-tier/untiered plays skewing toward names
with more follow-through than the A/B population trim_scale was tuned on, though this script does
not itself test that hypothesis.

## Blast radius

None — this is a read-only measurement script. No gate, exit mode, or `resolveExitModeForTier`
routing was touched. The shipped `ratchet` default for C-tier/untiered is now empirically supported
by this result rather than merely inherited from A/B's own trim_scale preference.

## Fix rationale

N/A — no fix. Per this repo's calibration-first discipline (same as `cortex-oppose-magnitude-ab.mjs`,
`veto-flicker-rate.mjs`): this is evidence, not a switch. A single 90-day/111-play sample is not
enough to declare the question permanently closed — a larger window or a second sampling period
would strengthen it — but it does answer the specific, previously-open question: extending
trim_scale to C/untiered is NOT supported by this measurement, so the shipped ratchet default
should stay as-is pending a larger or repeated sample.

| **Status** | MEASURED — ratchet outperforms trim_scale for C-tier/untiered on this 90-day sample (111 plays, 99 graded); no gate changed |
