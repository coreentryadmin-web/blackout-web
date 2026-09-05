> **kind:** FINDING

# Swing BUY verdict contradicted commit gates (G-S6/G-S14) — FIXED

| **Status** | FIXED in PR #3808 |
|------------|-------------------|
| **Pri** | P1 |
| **Area** | swing / nighthawk command-deck |

## Symptom

`swingEntryVerdict()` mapped `COMMIT_NOW` → `actionLabel: "BUY"` from entry mechanics alone, while V2
`computeSwingCommitPlan` enforced G-S6 confluence and G-S14 Cortex blocks. Members could see **BUY** on
names the backend would refuse to open.

## Root cause

`terminalPlayFromHorizon` called `swingEntryVerdict` with serving/entry observables only — no
`commitGateBlockedBy` from the commit plan.

## Fix

1. Stamp `commitGateBlockedBy` on `HorizonPlay` rows at discovery from `plan.decisions`.
2. `swingEntryVerdict`: when `COMMIT_NOW` but gates block → `SKIP` + `WAIT` + honest `gateBlocks`.
3. Cortex swing horizon: `vectorHorizonForCortexCommit("swing")` → `monthly` (covers 5–15 DTE; weekly ≤7 under-covered).

## Evidence

- `src/lib/swing/entry-verdict.test.ts` — G-S6/G-S14 block cases
- `src/features/nighthawk/command-deck/adapters.test.ts` — gated COMMIT_NOW adapter case
- `src/lib/nighthawk/cortex/fetch.test.ts` — swing → monthly
