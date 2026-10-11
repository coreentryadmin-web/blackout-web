> **kind:** FINDING

## Helix — dead `ContractPick` type export — FIXED

**Symptom:** `ContractDrilldownDrawer.tsx` exported `export type ContractPick = Pick<FlowAlert,
"ticker" | "strike" | "expiry" | "option_type">;` with a comment claiming it was "kept for
callers that only need the contract identity." Zero references anywhere in `src/` outside
its own definition — not even internally within the same file. No test file covers it.

**Root cause:** Introduced in the repo's original migration commit (`a05cf3245`) — long-
standing dead code, not a recent regression or in-progress scaffolding. The claimed
justification ("kept for callers that only need...") never materialized into a real caller.

**Evidence:** `grep -rn "\bContractPick\b" src/` before the fix: only the definition line.

**Fix:** Removed the type export. `FlowAlert` (the type it derived from) is still imported
and used elsewhere in the same file — untouched.

**Fix rationale:** Pure deletion — a never-adopted convenience export with no caller to
redirect.

**Blast radius:** `src/features/helix/components/ContractDrilldownDrawer.tsx` (one type
export removed) only.

**Regression guard:** None needed — no removed export had production behavior to guard.
