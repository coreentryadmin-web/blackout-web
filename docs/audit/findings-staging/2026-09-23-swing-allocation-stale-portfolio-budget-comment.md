## swing-allocation.ts's portfolioBudget doc comment falsely claimed the whole budget mechanism was unused live

> **kind:** `FINDING`

| Field | Value |
| --- | --- |
| **Status** | FIXED |
| **Area** | Night Hawk Swings — `src/lib/swing/swing-allocation.ts` (doc comment only, no behavior change) |
| **Severity** | P4 (misleading documentation, not a runtime bug) |
| **Found by** | Night Hawk Swings audit lane, Ask Largo standing mandate — fresh read of `swing-portfolio-budget.ts` |

### Root cause

`SwingAllocationResult.portfolioBudget`'s doc comment (`swing-allocation.ts`) read:

> "It arms only when the operator supplies real capital + loss limits + enforce:true; even then
> nothing in the live path consults it yet."

That was true when written but stopped being true once `commit.ts`'s Gate 1 armed — `commit.ts`'s
own file header explicitly documents a whole-portfolio "ARMED BUDGET" gate, "go-live 2026-07-24",
calling `evaluateSwingCommitBudget` with the real `PRODUCTION_PORTFOLIO_BUDGET` (2%/6%/3%/4% of a
$100k reference account, `enforce:true`) as one of three gates every real commit candidate must
clear. `swing-portfolio-budget.ts`'s own file header independently confirms the same armed constant
and go-live date. A reader trusting the `swing-allocation.ts` comment alone would conclude the whole
portfolio-budget feature is inert — a real, live, money-blocking gate elsewhere in the same commit
path — the exact kind of staleness trap this repo's own audit discipline (CLAUDE.md) repeatedly
warns about.

### Evidence

- `commit.ts:1-13` (file header): documents Gate 1 "ARMED BUDGET" as go-live 2026-07-24.
- `commit.ts:466-471`: calls `evaluateSwingCommitBudget(runningBook, candBudget, budget)` where
  `budget` traces to `resolveProductionPortfolioBudget()` (the real armed constant, env-overridable).
- `commit.ts:479-483` (Gate 2, `allocateSwingBook`): calls with only `(candidates, existing, caps)`
  — no `budget` argument — so `allocateSwingBook`'s own `budget` parameter falls back to its
  `DEFAULT_PORTFOLIO_BUDGET` default. This confirms the narrow claim (THIS field, from THIS call
  site, is always a no-op) is correct — only the broader claim ("nothing in the live path consults
  it") was false, because it ignores the separate Gate 1 call.

### Blast radius

Comment-only — no behavior, test, or output changes anywhere. The risk was purely to a future
reader (human or agent) trusting the comment's broader claim and concluding the portfolio-budget
gate doesn't need auditing/monitoring, when it's actually live and blocking real commits.

### Fix

Rewrote the doc comment to: (1) scope the "always a no-op" claim precisely to this field/call site
(Gate 2's `allocateSwingBook`, which never receives a real budget), (2) explicitly state the
mechanism as a whole IS live and enforced via the separate Gate 1 in `commit.ts`, and (3) point to
both `swing-portfolio-budget.ts`'s armed constant and `commit.ts`'s Gate 1 for where it actually
blocks — so a future reader gets the accurate, complete picture instead of a narrower claim that
reads as a broader (and false) one.

### Fix rationale

Comment-only fix, no code change needed or warranted — the actual gating logic is correct and
already tested (`commit.test.ts`'s "an ARMED budget..." tests already cover Gate 1's real behavior).
`tsc --noEmit` clean; `swing-allocation.test.ts` + `commit.test.ts` (54 tests) pass unchanged.
