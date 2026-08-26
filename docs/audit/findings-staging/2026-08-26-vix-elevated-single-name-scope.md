> **kind:** `FINDING`

## G-4 elevated-VIX floor wrongly re-imposed SPY-tape judgment on single names — FIXED

| **Status** | FIXED |
|---|---|

**Root cause.** G-1 (tape alignment) is explicitly scoped to index/ETF tickers only
(`isIndexEtfG1 = INDEX_ETF_TICKERS.has(...)`, `gates.ts`) — its own comment states "single-name
stocks move on their own catalysts... independently of SPY direction... single names bypass G-1
entirely." But the elevated-VIX (17-20) score-floor branch a few lines below computed
`tapeAlignedOrFlat` from `input.bias` vs `input.direction` **unconditionally**, with no
index/ETF scoping at all — so a single name reaching G-4 with a disagreeing (or stale/null) SPY
bias was silently held to the stricter 75-score floor instead of the standard 65, re-imposing
almost exactly the SPY-tape constraint G-1 was written to exempt it from. The branch's own
comment even claimed it was "effectively unreachable in normal flow" — true only for index ETFs;
single names reach it constantly.

**Evidence.** Confirmed via close reading: `gates.ts`'s G-1 block is gated
`if (!isCondor && isIndexEtfG1)`; the elevated-VIX branch a few lines later has no equivalent
`isIndexEtfG1` check on its `tapeAlignedOrFlat` computation. Every existing elevated-VIX test for
a single name (`gates.test.ts`, NVDA cases) used `bias: "flat"`, which read as aligned under
BOTH the buggy and fixed logic — so the bug shipped with zero test coverage of the actual
diverging case (a single name with a *disagreeing* bias). The parallel "hardened G-4"
calibration mirror in `computeGateCalibration` had the identical unscoped `aligned` computation.

**Fix.** Scoped both computations to match G-1's own `isIndexEtfG1`/`INDEX_ETF_TICKERS` check:
a non-index/ETF ticker now always reads as tape-aligned (standard 65 floor) regardless of
`input.bias`, exactly mirroring G-1's exemption; index/ETF behavior is unchanged bit-for-bit
(same null/flat/aligned/disagreeing handling as before).

**Blast radius.** Two call sites shared the same unscoped comparison: the live gate
(`evaluateZeroDteGates`'s elevated-VIX branch, which actually blocks commits) and
`computeGateCalibration`'s "hardened G-4" mirror (evidence/logging only, not enforced — but used
to reason about whether to promote the hardened variant, so it needed the same fix for the
calibration data itself to be trustworthy).

**Fix rationale.** Did not touch the 75-floor logic for index ETFs at all (that's the F-1
evidence-backed constraint this gate exists to enforce, and it correctly gates the correlated
instrument class the evidence was measured on). Did not touch G-1 itself. The regression test
pins both branches: `evaluateZeroDteGates` commits an NVDA long against a disagreeing SPY tape at
score 70/VIX 18 (previously blocked), while the identical scenario on QQQ still blocks via G-1's
own `tape_alignment` code (confirming the fix doesn't loosen anything for the instrument class
G-4's elevated floor actually protects). Confirmed both new tests fail against the pre-fix code
and pass post-fix.
