> **kind:** FINDING

## Swing commit budget: existing over-cap position wrongly blocks a same-ticker sibling candidate — FIXED

| **Status** | FIXED |
|---|---|

**File:** `src/lib/swing/swing-portfolio-budget.ts` (`evaluateSwingCommitBudget`)

### Root cause

`evaluateSwingCommitBudget`'s per-position gate is supposed to block a candidate ONLY when the
candidate's **own** risk exceeds `perPositionLossPct` — its own docstring states the invariant
explicitly: *"an existing over-cap position must not block a fresh small one."*

The implementation instead checked ticker-string membership against the dimension's aggregate
`offenders` list:

```ts
const key = candidate.ticker.trim().toUpperCase();
...
case "per_position_loss":
  return dv?.offenders.includes(key) ?? false;
```

`evalDimension`'s `offenders` array is built once over **every** contributing position (the whole
book plus the candidate), keyed only by ticker string:

```ts
for (const p of contributors) {
  const r = risk(p);
  if (constrained && limitUsd != null && r > limitUsd) offenders.push(p.ticker.trim().toUpperCase());
}
```

Two *different* positions can legitimately share one ticker — `swingThesisKey(ticker, direction,
archetype)` (the idempotency gate in `commit.ts`) only prevents re-opening the *identical*
(ticker, direction, archetype) thesis, so a LONG `PULLBACK_CONTINUATION` NVDA and a LONG
`BREAKOUT` NVDA (or a LONG and a SHORT NVDA) can both be open at once. When they collapse to the
same ticker string in `offenders`, `dv.offenders.includes(key)` cannot tell which position is the
actual offender — an EXISTING position on the book being over-cap (e.g. because the operator
retuned `SWING_CAPITAL_USD`/`SWING_PER_POSITION_LOSS_PCT` mid-session via
`resolveProductionPortfolioBudget`'s documented env-override path, making a previously-compliant
position newly non-compliant) silently blocks a brand-new, well-sized candidate on the same
ticker — even though the candidate's own risk is nowhere near the cap.

### Evidence (RED → GREEN)

Added a regression test reproducing the exact scenario: book holds an existing NVDA position at
$3,000 risk (over the $2,000/2% per-position cap under `PRODUCTION_PORTFOLIO_BUDGET`), and a new
$500 NVDA candidate (a different archetype/direction) is evaluated.

- **Before the fix:** `v.blocked === true` — the small candidate was wrongly blocked (`true !==
  false` assertion failure, confirmed via `git stash` isolating the fix).
- **After the fix:** `v.blocked === false`, `blockedDimensions: []` — the candidate clears on its
  own merits.

Full `swing-portfolio-budget.test.ts` (17/17), plus collateral `commit.test.ts` /
`roll-plan.test.ts` / `discovery.test.ts` / `swing-allocation.test.ts` (104/104 total), all pass.
`npx tsc --noEmit` is silent.

### Fix

Compare the candidate's own `candidateRiskUsd` directly against the resolved `limitUsd` for the
`per_position_loss` dimension, instead of looking the candidate's ticker up in the aggregate
`offenders` list:

```ts
case "per_position_loss":
  return dv?.constrained === true && dv.limitUsd != null && candidateRiskUsd > dv.limitUsd;
```

This is a pure per-position comparison (no cross-position interaction needed for this dimension,
unlike the aggregate `portfolio_loss`/`event_exposure`/`overnight` dimensions, which correctly
still block any nonzero-risk contributor once the aggregate is breached). The removed `key`
variable (only used for the buggy lookup) is deleted; no other call site referenced it.

### Blast radius

`evaluateSwingCommitBudget` is the live pre-commit gate consulted by `computeSwingCommitPlan`
(`commit.ts` Gate 1, "ARMED BUDGET" — real money, this is the swing lane's live commit path). No
other call site reimplements this comparison. `evalDimension`'s `offenders` field itself is
unchanged (still correct for its other consumer, the aggregate-dimension advisory display) — only
the per-position *candidate-blocking* decision was wrong.

### Fix rationale

Comparing the candidate's own risk to the limit directly is both simpler and provably correct: it
needs no ticker-identity disambiguation at all, since the per-position dimension's block decision
never depended on any *other* position in the first place — only on whether this one candidate's
own risk exceeds the cap. Kept the `dv?.` optional-chaining defensiveness matching the file's
existing style, though `dv` is always present in practice (all four dimensions are always
evaluated in `evaluatePortfolioBudget`).
