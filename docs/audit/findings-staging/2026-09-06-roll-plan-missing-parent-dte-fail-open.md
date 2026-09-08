> **kind:** `FINDING`

## Roll plan accepted a child contract when parent DTE was unknown — fail-open on the time-buy gate — FIXED

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Pri** | P2 (real-capital safety — roll could open without verifying the child buys time) |
| **Area** | Night Hawk Swings — `roll-plan.ts` `buildRollChild` |
| **PR** | (pending) |

### Symptom

`buildRollChild`'s "child must be further out than parent DTE (+buffer)" guard only ran when
`reads.dte` was a finite number. When `reads.dte` was `null`/`NaN`, the check was skipped and the
function fell through to accept whatever `rankSwingContracts` picked — the only gate in the function
that failed open instead of closed. Every other missing input (`no_sub_lane`, `no_underlying_spot`,
`no_chain`, `no_liquid_child_contract`, `unknown_child_premium`) already blocked explicitly.

### Fix

Return `{ blocked: ["no_parent_dte"] }` when `reads.dte` is not finite, then run the
`child_not_further_out` comparison unconditionally.

### Evidence

`npx tsx --test src/lib/swing/roll-plan.test.ts` — new case `DEFER: missing parent DTE fails closed`.
`git stash` on `roll-plan.ts` alone: RED (plan returned with child). GREEN post-fix: plan is `null`.
