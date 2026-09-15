> **kind:** FINDING

## Night Hawk 0DTE — trim_scale thesis-break exit narrative also omitted banked tranches — FIXED

| **Status** | FIXED in `fix/trim-scale-thesis-break-tranche-note` |
|---|---|

### Root cause

Same class of gap as the floor-exit fix shipped earlier today (`fix/trim-scale-floor-exit-tranche-note`,
PR #5037, `docs/audit/findings-staging/2026-09-15-trim-scale-floor-exit-omits-banked-tranches.md`), found
while re-auditing `decideTrimScale` (`src/lib/zerodte/exit-engine.ts`) for other exit paths sharing the
same shape: the `thesis_break` branch — *"Thesis broken (veto) at +25% — exiting the remaining position at
market, not hoping: ..."* — also only closes the REMAINING position (never the whole trade once tranches
have banked), and also never mentioned how many tranches were already banked. A member reading this
sentence for a play where 2/3 already banked profit at their own trigger prices would see only the
final-third P&L and the thesis-break reason, with zero indication real profit was locked in earlier.

Two other exit paths in the same function were checked and are already fine: `trim_scale_runner_target`'s
detail already says *"tagged the target ... after both trims"*, and `trim_scale_running`'s (the
RAISE_FLOOR report, not an exit) already says *"N/2 thirds banked"* — neither needed a change.

### Blast radius

Single call site: the `thesis_break` return inside `decideTrimScale`. To avoid duplicating the
tranche-note logic across two branches, hoisted the shared clause (`bankedTranchesClause`) up to where
`taken`/`thresholds` are already computed, and had both the floor-exit branch (from the earlier PR) and
this one splice it into their own sentence. The floor-exit branch's rendered string is byte-identical to
before (verified — same regex still matches); only the thesis-break branch's string is new.

### Fix rationale

Same principle as the earlier fix: narrative-only, using `taken`/`thresholds.length` already in scope,
appended in parentheses only when `taken > 0`: *"... [wall-trend] wall building against it (2/2 tranches
(33% each) already banked on the way up.)"* No P&L/gate/reason-code change.

### Evidence

RED→GREEN via `git stash`: with `exit-engine.ts` stashed, the new thesis-break regression test (peak +50%,
`trimsTaken: 2`, a veto firing) fails with no tranche mention; restored, it passes. A second test (no
tranche armed) confirms the parenthetical is correctly omitted. Full suite: 14317 pass / 0 fail / 3 skipped
(pre-existing, unrelated) on Node 20. `tsc --noEmit` clean. The original floor-exit tests (from the earlier
PR) still pass unchanged after the hoist-and-share refactor.
