## 2026-10-20 — [FINDING, P3 Night Hawk 0DTE] Contract selection: Greeks threaded through + shadow quality diagnostic — FIXED

> **kind:** `FINDING`

| **Status** | FIXED (shadow diagnostic only — never gates a commit) |
|---|---|

**Context.** Member audit directive, point 2 of the original 6-point brief: "Choose the right
contract. Compare available expirations and strikes using live bid/ask, spread, liquidity, delta,
gamma, theta, and premium... don't pick cheap contracts just because they could show a huge
percentage gain." Checked directly: `buildContractPlan` (plan.ts) already uses bid/ask/spread/
liquidity (G-9/G-21) — but never delta/gamma/theta, even though `OptionSnapshot`
(providers/options-snapshot.ts) already FETCHES all four for every live quote. The data existed;
it was discarded before reaching contract selection.

### What changed

- `ContractGreeks` type (plan.ts): the four real greeks, additive/nullable.
- `evaluateContractGreeksQuality(input)`: pure, SHADOW-ONLY diagnostic (never a gate). Flags
  `low_delta` (|delta| below `GREEKS_LOW_DELTA_FLOOR=0.15` — a contract too far OTM to carry real
  directional exposure) and `high_theta_decay` (theta, as a % of the contract's own mark per day,
  above `GREEKS_HIGH_THETA_DECAY_PCT=15` — "don't pick cheap contracts just because they could show
  a huge percentage gain": a contract bleeding >15%/day of its own price needs the underlying to
  move fast just to break even). Both thresholds are STARTING, UNCALIBRATED conventions (same
  discipline as RVOL's own classification constants) — not derived from this codebase's own
  outcome data yet.
- `buildContractPlan` takes an optional `greeks` input and returns `greeks`/`greeks_quality` on
  the plan — omitted entirely (not null-filled) when the caller has no snapshot, same "absence is
  not a measured zero" convention as every other conditional field in this file.
- `scan.ts`: threads `snap.delta/gamma/theta/vega` into `buildContractPlan`'s call, and attaches
  `s.plan.greeks_quality` additively onto `entry_context.shadow_signals.contract_greeks` at
  commit — persisted, joinable against the row's own graded outcome, never gating.

### Why shadow-only, not a live gate yet

Per the standing instruction ("test proposed filter changes in shadow mode before changing live
alerts") and the same discipline this session already applied to RVOL: a brand-new filter
dimension with uncalibrated thresholds has no business blocking a real commit before real paired
(reading, outcome) data justifies it. This PR makes that data start accumulating. The natural
graduation path (documented in the module, same shape as RVOL's own): once a real sample shows
`low_delta`/`high_theta_decay` setups actually underperform, a SEPARATE, explicitly-reviewed PR
can promote this to an actual gate.

### Deliberately NOT done here

- Did not change `applyLiquidStrikeFallback`'s strike-selection walk to prefer higher |delta|
  among liquid candidates — that would be a real (if soft) selection-behavior change, out of scope
  for a shadow-first pass; a future PR can revisit once this shadow data exists.
- Did not touch Legacy's `pickChainContract` (deterministic-edition.ts) — a different product
  (next-day digest), not the live 0DTE board this audit targets.

### Tests

9 new tests in `plan.test.ts` (healthy contract flags neither concern, low-delta flags, short-put
judged on |delta| not raw sign, high-theta-decay flags, exact-boundary strict-inequality cases,
missing/non-finite inputs degrade to unmeasured never fabricated, `buildContractPlan` threading
with/without greeks supplied). RED→GREEN proven (reverted to pre-change `plan.ts`, confirmed 9
failures; restored, confirmed `plan.test.ts`+`scan.test.ts`+`board.test.ts`+`exit-sync.test.ts`
241/241 pass). `npx tsc --noEmit`: clean. All runs on the real Node 20 binary.

### CROSS-PR ORDERING NOTE (flagged in-code, per CLAUDE.md's own standing discipline)

A separate, independently authored PR in this same session (RVOL shadow wiring, #6289) ALSO
writes a `shadow_signals: {...}` spread into the SAME `entry_context` object literal in `scan.ts`.
Plain object spreads don't deep-merge — if both PRs merge without reconciliation, whichever lands
second silently overwrites the first's `shadow_signals` key at runtime (no git conflict guaranteed,
since the two insertions sit at different lines). Flagged in both this finding and an in-code
comment; whichever of the two PRs merges second must be rebased to combine both spreads into one
before merging, not merged blind.
